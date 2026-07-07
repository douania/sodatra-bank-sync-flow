/**
 * RPC payload contract for the 0U structured CSV import write path
 * (E-2B-RUNTIME-RPC-CONTRACT).
 *
 * PREPARATORY MODULE ONLY: it builds and validates a SAFE, deterministic
 * payload for the `pre_ingest_structured_bank_statement` RPC — it NEVER sends
 * it. The actual Supabase call is lot E-2C, after the Supabase generated types
 * are regenerated from an applied migration (or a typed facade is decided by
 * the CTO). Until then this module has zero dependency on the Supabase client.
 *
 * Doctrine E-2 (acted):
 *  - the 0U RPCs execute under a REAL Supabase Auth identity (`authenticated`
 *    role); deposit is allowed to admin/manager by the RPC's internal checks;
 *  - promotion, needs_review approval, rejection, conflict resolution and
 *    supersede stay reserved to a human admin;
 *  - the platform service role deliberately has no EXECUTE on the 0U RPCs and
 *    no technical account may ever replace `auth.uid()` as the actor identity.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - no Supabase import, no RPC client call, no network, no DB write;
 *  - browser-safe: no Node-only import;
 *  - never accepts raw CSV text/bytes, full account numbers or IBAN-like
 *    values: forbidden keys are refused wherever they appear (deep scan), and
 *    unredacted-looking file names or unmasked-looking account labels are
 *    refused fail-closed;
 *  - mirrors the fail-closed gates of the RPC (migration
 *    20260703120000_structured_csv_import_v1.sql) so a payload the database
 *    would reject is refused BEFORE it could ever reach the network:
 *    branch gates (attempt-only vs staged), whitelisted jsonb keys, strict
 *    DD/MM/YYYY dates (D1/D2 round-trip), strict amounts (max 2 decimals,
 *    max 16 integer digits, no exponent/NaN/Infinity), reason bounded to
 *    200 chars, mandatory identity components for staged deposits, strict
 *    masked account pattern, debit/credit line coherence
 *    (lines_staging_one_amount), line_hash uniqueness per statement and
 *    period date ordering.
 *
 * Every builder returns a controlled result — it never throws for a bad
 * input: `{ success: false, errors }` carries every violated gate.
 */

import type {
  BankAccountStatement,
  BankAccountStatementLine
} from '@/types/bankAccountStatement';

// ---------------------------------------------------------------------------
// RPC name registry (0U). Wiring is E-2C; role gates live INSIDE each RPC.
// ---------------------------------------------------------------------------

export const PRE_INGEST_STRUCTURED_BANK_STATEMENT_RPC_NAME =
  'pre_ingest_structured_bank_statement' as const;

/**
 * All 0U RPC names, for the future E-2C wiring. Deposit accepts admin/manager;
 * every decision RPC below the first entry is enforced admin-only (or the
 * dedicated escalation flow) INSIDE the RPC itself — never client-side only.
 */
export const STRUCTURED_BANK_STATEMENT_RPC_NAMES = Object.freeze([
  'pre_ingest_structured_bank_statement',
  'promote_structured_bank_statement_import',
  'approve_structured_bank_statement_needs_review_promotion',
  'reject_structured_bank_statement_import',
  'resolve_structured_bank_statement_conflict_keep_existing',
  'request_structured_bank_statement_manager_escalation',
  'supersede_structured_bank_statement_import'
] as const);

// ---------------------------------------------------------------------------
// Whitelists and blocklist — mirrors of the migration's own constants.
// ---------------------------------------------------------------------------

/** Mirror of the RPC's `v_stmt_allowed` whitelist (anti-smuggling). */
export const STRUCTURED_BANK_STATEMENT_RPC_STATEMENT_ALLOWED_KEYS = Object.freeze([
  'currency',
  'period_start_date',
  'period_end_date',
  'statement_date',
  'opening_balance',
  'total_debits',
  'total_credits',
  'closing_balance',
  'calculated_closing',
  'discrepancy',
  'line_count'
] as const);

/** Mirror of the RPC's `v_line_allowed` whitelist (anti-smuggling). */
export const STRUCTURED_BANK_STATEMENT_RPC_LINE_ALLOWED_KEYS = Object.freeze([
  'source_line_index',
  'transaction_date',
  'value_date',
  'description_sanitized',
  'debit_amount',
  'credit_amount',
  'signed_amount',
  'running_balance',
  'direction',
  'currency',
  'line_hash'
] as const);

/**
 * Keys that must NEVER appear anywhere in an outgoing payload (nor in the
 * caller input). Matching is exact on a normalized form (lowercased,
 * non-alphanumerics stripped), so `raw_csv` and `rawCsv` are both blocked
 * while the authorized `raw_text_hash` / `account_number_masked` — which only
 * CONTAIN a blocked substring — are not.
 */
export const STRUCTURED_BANK_STATEMENT_FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
  'raw_csv',
  'raw_text',
  'raw_bytes',
  'raw_content',
  'file_content',
  'account_number',
  'iban'
] as const);

const FORBIDDEN_KEYS_NORMALIZED: ReadonlySet<string> = new Set(
  STRUCTURED_BANK_STATEMENT_FORBIDDEN_PAYLOAD_KEYS.map((key) => normalizeKeyForBlocklist(key))
);

// ---------------------------------------------------------------------------
// Payload types — strict snake_case mapping of the RPC parameters.
// ---------------------------------------------------------------------------

export type PreIngestStructuredBankStatementRequestedStatus =
  | 'rejected'
  | 'failed'
  | 'ingestion_ready'
  | 'needs_review';

export type PreIngestStructuredBankStatementParserStatus =
  | 'valid'
  | 'needs_review'
  | 'invalid'
  | 'unsupported';

/** `p_statement` jsonb shape — keys are exactly the RPC statement whitelist. */
export interface PreIngestStructuredBankStatementRpcStatementJson {
  currency: string;
  period_start_date: string;
  period_end_date: string;
  statement_date: string | null;
  opening_balance: number;
  total_debits: number;
  total_credits: number;
  closing_balance: number;
  calculated_closing: number;
  discrepancy: number;
  line_count: number;
}

/** One `p_lines[]` jsonb element — keys are exactly the RPC line whitelist. */
export interface PreIngestStructuredBankStatementRpcLineJson {
  source_line_index: number;
  transaction_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
  line_hash: string;
}

/**
 * Full parameter object for `pre_ingest_structured_bank_statement`, one key
 * per RPC parameter, always all present (explicit null over missing key) so
 * the outgoing shape is deterministic and reviewable.
 */
export interface PreIngestStructuredBankStatementRpcPayload {
  p_requested_status: PreIngestStructuredBankStatementRequestedStatus;
  p_source_format: string;
  p_bank: string;
  p_source_file_name_redacted: string | null;
  p_account_fingerprint: string | null;
  p_account_number_masked: string | null;
  p_raw_text_hash: string | null;
  p_import_id: string | null;
  p_parser_validation_status: PreIngestStructuredBankStatementParserStatus | null;
  p_rejected_reason: string | null;
  p_errors_count: number;
  p_warnings_count: number;
  p_runtime_version: string | null;
  p_parser_version: string | null;
  p_statement: PreIngestStructuredBankStatementRpcStatementJson | null;
  p_lines: PreIngestStructuredBankStatementRpcLineJson[] | null;
}

// ---------------------------------------------------------------------------
// Builder input — camelCase runtime values, mapped here to snake_case.
// ---------------------------------------------------------------------------

interface PreIngestCommonInput {
  sourceFormat: string;
  bank: 'BDK' | 'ORA' | string;
  /**
   * Already-redacted display name. Refused fail-closed when it still looks
   * sensitive (path separators, 8+ consecutive digits, IBAN-like run) — the
   * heuristic is deliberately conservative; omit the name when unsure.
   */
  sourceFileNameRedacted?: string;
  /**
   * Strict masked label, mirror of the tables' CHECK `^[*]+[0-9]{0,4}$`
   * (asterisks then at most 4 digits); anything else is refused fail-closed.
   */
  accountNumberMasked?: string;
  errorsCount?: number;
  warningsCount?: number;
  runtimeVersion?: string;
  parserVersion?: string;
}

/** rejected / failed: attempt + audit events only, no statement payload. */
export interface PreIngestStructuredBankStatementAttemptOnlyInput extends PreIngestCommonInput {
  requestedStatus: 'rejected' | 'failed';
  /** Human-safe reason, never CSV content; non-empty, max 200 chars. */
  rejectedReason: string;
  parserValidationStatus?: PreIngestStructuredBankStatementParserStatus;
  accountFingerprint?: string;
  /** Optional traceability; when present must be a 64-char lowercase hex. */
  rawTextHash?: string;
  /** Optional traceability; when present must be a 64-char lowercase hex. */
  importId?: string;
}

/** ingestion_ready / needs_review: staged deposit with statement + lines. */
export interface PreIngestStructuredBankStatementStagedInput extends PreIngestCommonInput {
  requestedStatus: 'ingestion_ready' | 'needs_review';
  /** Must match the requestedStatus gate AND the statement's own status. */
  parserValidationStatus: 'valid' | 'needs_review';
  /** Mandatory, fail-closed — never derived from the masked number. */
  accountFingerprint: string;
  rawTextHash: string;
  importId: string;
  /**
   * The enriched statement produced by the pre-ingestion layer (0I): its
   * `lines` become `p_lines` and every line must already carry a `lineHash`.
   */
  statement: BankAccountStatement;
}

export type BuildPreIngestStructuredBankStatementRpcPayloadInput =
  | PreIngestStructuredBankStatementAttemptOnlyInput
  | PreIngestStructuredBankStatementStagedInput;

export type PreIngestStructuredBankStatementRpcPayloadBuildResult =
  | {
      success: true;
      rpcName: typeof PRE_INGEST_STRUCTURED_BANK_STATEMENT_RPC_NAME;
      payload: PreIngestStructuredBankStatementRpcPayload;
    }
  | {
      success: false;
      errors: string[];
    };

// ---------------------------------------------------------------------------
// Strict formats — mirrors of the migration's parse helpers.
// ---------------------------------------------------------------------------

// Mirror of structured_csv_parse_date_strict (D1/D2): DD/MM/YYYY + round-trip.
const STRICT_DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;

// Mirror of structured_csv_parse_amount_strict: optional sign, 1-16 integer
// digits, at most 2 decimals, no exponent/NaN/Infinity. Tested against the
// number's canonical string form, so float dust (0.30000000000000004) is
// refused here exactly as the RPC would refuse it.
const STRICT_AMOUNT_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

// Redaction heuristics (fail-closed, conservative): path separators, 8+
// consecutive digits (full-account-like) or an IBAN-like run are refused.
const PATH_SEPARATOR_PATTERN = /[\\/]/;
const LONG_DIGIT_RUN_PATTERN = /\d{8,}/;
const IBAN_LIKE_PATTERN = /[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,}/;

// Mirror of the tables' CHECK on account_number_masked: only asterisks, then
// at most 4 trailing digits. Anything else (letters, digit prefixes, 5+
// digits, IBAN-like values) cannot match and is refused fail-closed.
const ACCOUNT_NUMBER_MASKED_PATTERN = /^[*]+[0-9]{0,4}$/;

const MAX_SAFE_REASON_LENGTH = 200; // mirror of structured_csv_assert_safe_reason
const MAX_SAFE_FILE_NAME_LENGTH = 200; // conservative client-side bound

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the full `pre_ingest_structured_bank_statement` parameter object.
 *
 * Deterministic and side-effect free: same input, same payload. Returns a
 * controlled error result (never throws) when any RPC gate mirrored here would
 * fail, when a forbidden key is smuggled anywhere in the input, or when a
 * value still looks unredacted/unmasked.
 */
export function buildPreIngestStructuredBankStatementRpcPayload(
  input: BuildPreIngestStructuredBankStatementRpcPayloadInput
): PreIngestStructuredBankStatementRpcPayloadBuildResult {
  const errors: string[] = [];

  // Anti-smuggling first: a forbidden key anywhere in the caller input is an
  // immediate, controlled rejection — even if the mapping below would have
  // dropped it anyway.
  const forbiddenInInput = findForbiddenStructuredBankStatementPayloadKeys(input);
  for (const path of forbiddenInInput) {
    errors.push(`forbidden key in input at ${path}: raw CSV content, full account numbers and IBANs are never accepted.`);
  }

  const sourceFormat = trimToUndefined(input.sourceFormat);
  if (sourceFormat === undefined) {
    errors.push('sourceFormat is required and must be non-empty.');
  }
  const bank = trimToUndefined(input.bank);
  if (bank === undefined) {
    errors.push('bank is required and must be non-empty.');
  }

  if (
    input.requestedStatus !== 'rejected' &&
    input.requestedStatus !== 'failed' &&
    input.requestedStatus !== 'ingestion_ready' &&
    input.requestedStatus !== 'needs_review'
  ) {
    errors.push(
      `requestedStatus must be one of rejected|failed|ingestion_ready|needs_review, received "${String(
        (input as { requestedStatus?: unknown }).requestedStatus
      )}".`
    );
    return { success: false, errors };
  }

  const sourceFileNameRedacted = validateSourceFileNameRedacted(input.sourceFileNameRedacted, errors);
  const accountNumberMasked = validateAccountNumberMasked(input.accountNumberMasked, errors);
  const errorsCount = validateCount(input.errorsCount, 'errorsCount', errors);
  const warningsCount = validateCount(input.warningsCount, 'warningsCount', errors);
  const runtimeVersion = trimToUndefined(input.runtimeVersion) ?? null;
  const parserVersion = trimToUndefined(input.parserVersion) ?? null;

  let payload: PreIngestStructuredBankStatementRpcPayload;

  if (input.requestedStatus === 'rejected' || input.requestedStatus === 'failed') {
    payload = buildAttemptOnlyPayload(
      input,
      {
        sourceFormat: sourceFormat ?? '',
        bank: bank ?? '',
        sourceFileNameRedacted,
        accountNumberMasked,
        errorsCount,
        warningsCount,
        runtimeVersion,
        parserVersion
      },
      errors
    );
  } else {
    payload = buildStagedPayload(
      input,
      {
        sourceFormat: sourceFormat ?? '',
        bank: bank ?? '',
        sourceFileNameRedacted,
        accountNumberMasked,
        errorsCount,
        warningsCount,
        runtimeVersion,
        parserVersion
      },
      errors
    );
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Belt and braces: the outgoing payload itself is scanned once more. With
  // the explicit field picking above this can only fire on a coding defect —
  // fail closed rather than send.
  const forbiddenInPayload = findForbiddenStructuredBankStatementPayloadKeys(payload);
  if (forbiddenInPayload.length > 0) {
    return {
      success: false,
      errors: forbiddenInPayload.map(
        (path) => `forbidden key in built payload at ${path}; refusing to expose it.`
      )
    };
  }

  return {
    success: true,
    rpcName: PRE_INGEST_STRUCTURED_BANK_STATEMENT_RPC_NAME,
    payload
  };
}

/**
 * Deep scan for forbidden keys. Exact match on the normalized key (lowercase,
 * non-alphanumerics stripped), never a substring match: `raw_text_hash` and
 * `account_number_masked` stay authorized while `raw_text` / `rawText` /
 * `account_number` / `iban` are refused wherever they hide. Returns the paths
 * of every hit ("$" is the root).
 */
export function findForbiddenStructuredBankStatementPayloadKeys(
  value: unknown,
  path = '$'
): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      hits.push(...findForbiddenStructuredBankStatementPayloadKeys(value[index], `${path}[${index}]`));
    }
    return hits;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS_NORMALIZED.has(normalizeKeyForBlocklist(key))) {
        hits.push(`${path}.${key}`);
      }
      hits.push(...findForbiddenStructuredBankStatementPayloadKeys(child, `${path}.${key}`));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Branch builders
// ---------------------------------------------------------------------------

interface ValidatedCommonFields {
  sourceFormat: string;
  bank: string;
  sourceFileNameRedacted: string | null;
  accountNumberMasked: string | null;
  errorsCount: number;
  warningsCount: number;
  runtimeVersion: string | null;
  parserVersion: string | null;
}

function buildAttemptOnlyPayload(
  input: PreIngestStructuredBankStatementAttemptOnlyInput,
  common: ValidatedCommonFields,
  errors: string[]
): PreIngestStructuredBankStatementRpcPayload {
  // Mirror STRUCTURED_CSV_REJECT_NO_PAYLOAD: a runtime caller bypassing the
  // TypeScript union must not smuggle a statement into an attempt-only deposit.
  const runtimeInput = input as unknown as Record<string, unknown>;
  if (runtimeInput.statement !== undefined || runtimeInput.lines !== undefined) {
    errors.push('rejected/failed deposits must not carry a statement or lines (attempt-only).');
  }

  // Mirror structured_csv_assert_safe_reason: non-empty, bounded, human-safe.
  const rejectedReason = typeof input.rejectedReason === 'string' ? input.rejectedReason : '';
  if (rejectedReason.trim() === '') {
    errors.push('rejectedReason is required for rejected/failed deposits and must be non-empty.');
  } else if (rejectedReason.length > MAX_SAFE_REASON_LENGTH) {
    errors.push(`rejectedReason must not exceed ${MAX_SAFE_REASON_LENGTH} characters (never CSV content).`);
  }

  const parserValidationStatus = validateOptionalParserStatus(input.parserValidationStatus, errors);
  const rawTextHash = validateOptionalSha256Hex(input.rawTextHash, 'rawTextHash', errors);
  const importId = validateOptionalSha256Hex(input.importId, 'importId', errors);
  const accountFingerprint = trimToUndefined(input.accountFingerprint) ?? null;

  return {
    p_requested_status: input.requestedStatus,
    p_source_format: common.sourceFormat,
    p_bank: common.bank,
    p_source_file_name_redacted: common.sourceFileNameRedacted,
    p_account_fingerprint: accountFingerprint,
    p_account_number_masked: common.accountNumberMasked,
    p_raw_text_hash: rawTextHash,
    p_import_id: importId,
    p_parser_validation_status: parserValidationStatus,
    p_rejected_reason: rejectedReason,
    p_errors_count: common.errorsCount,
    p_warnings_count: common.warningsCount,
    p_runtime_version: common.runtimeVersion,
    p_parser_version: common.parserVersion,
    p_statement: null,
    p_lines: null
  };
}

function buildStagedPayload(
  input: PreIngestStructuredBankStatementStagedInput,
  common: ValidatedCommonFields,
  errors: string[]
): PreIngestStructuredBankStatementRpcPayload {
  // Mirror STRUCTURED_CSV_REASON_FORBIDDEN.
  const runtimeInput = input as unknown as Record<string, unknown>;
  if (runtimeInput.rejectedReason !== undefined) {
    errors.push('staged deposits (ingestion_ready/needs_review) must not carry a rejectedReason.');
  }

  // Mirror STRUCTURED_CSV_GATE_VALID / STRUCTURED_CSV_GATE_REVIEW.
  if (input.requestedStatus === 'ingestion_ready' && input.parserValidationStatus !== 'valid') {
    errors.push('ingestion_ready requires parserValidationStatus "valid" (fail-closed).');
  }
  if (input.requestedStatus === 'needs_review' && input.parserValidationStatus !== 'needs_review') {
    errors.push('needs_review requires parserValidationStatus "needs_review" (fail-closed).');
  }

  // Mirror STRUCTURED_CSV_R4_FINGERPRINT and STRUCTURED_CSV_IDENTITY_REQUIRED,
  // hardened client-side to the exact 64-hex shape our helpers produce.
  const accountFingerprint = trimToUndefined(input.accountFingerprint);
  if (accountFingerprint === undefined) {
    errors.push('accountFingerprint is mandatory for staged deposits; no fallback on the masked account number.');
  }
  const rawTextHash = validateRequiredSha256Hex(input.rawTextHash, 'rawTextHash', errors);
  const importId = validateRequiredSha256Hex(input.importId, 'importId', errors);

  const statement = input.statement;
  if (statement === undefined || statement === null || typeof statement !== 'object') {
    errors.push('statement is required for staged deposits.');
    return placeholderStagedPayload(input, common);
  }

  // Coherence gate: the parser status sent to the RPC must be the one the
  // statement actually carries — a mismatch means the caller is bypassing the
  // pre-ingestion result.
  if (statement.validation?.status !== input.parserValidationStatus) {
    errors.push(
      `parserValidationStatus "${input.parserValidationStatus}" does not match the statement's own ` +
        `validation status "${String(statement.validation?.status)}".`
    );
  }

  const currency = trimToUndefined(statement.currency);
  if (currency === undefined) {
    errors.push('statement.currency is required and must be non-empty.');
  }
  const periodStartDate = validateRequiredStrictDate(statement.periodStartDate, 'statement.periodStartDate', errors);
  const periodEndDate = validateRequiredStrictDate(statement.periodEndDate, 'statement.periodEndDate', errors);
  const statementDate = validateOptionalStrictDate(statement.statementDate, 'statement.statementDate', errors);

  // Mirror of the staging CHECK (period_end_date >= period_start_date): only
  // evaluated once both dates passed the strict DD/MM/YYYY validation.
  if (
    periodStartDate !== null &&
    periodEndDate !== null &&
    compareStrictDdMmYyyy(periodEndDate, periodStartDate) < 0
  ) {
    errors.push(
      'statement.periodEndDate must not be earlier than statement.periodStartDate (fail-closed).'
    );
  }

  const openingBalance = validateRequiredAmount(statement.openingBalance, 'statement.openingBalance', errors);
  const totalDebits = validateRequiredAmount(statement.totalDebits, 'statement.totalDebits', errors);
  const totalCredits = validateRequiredAmount(statement.totalCredits, 'statement.totalCredits', errors);
  const closingBalance = validateRequiredAmount(statement.closingBalance, 'statement.closingBalance', errors);
  const calculatedClosing = validateRequiredAmount(
    statement.validation?.calculatedClosing,
    'statement.validation.calculatedClosing',
    errors
  );
  const discrepancy = validateRequiredAmount(
    statement.validation?.discrepancy,
    'statement.validation.discrepancy',
    errors
  );

  const lines = Array.isArray(statement.lines) ? statement.lines : undefined;
  if (lines === undefined) {
    errors.push('statement.lines must be an array for staged deposits.');
    return placeholderStagedPayload(input, common);
  }

  // Mirror of lines_staging_unique_per_statement: two lines carrying the same
  // line_hash inside one deposit would violate UNIQUE (staging_statement_id,
  // line_hash). Absent/invalid hashes are reported per line by the mapper.
  const seenLineHashes = new Map<string, number>();
  for (let index = 0; index < lines.length; index++) {
    const candidate = lines[index];
    const lineHash = candidate === null || typeof candidate !== 'object'
      ? undefined
      : trimToUndefined(candidate.lineHash);
    if (lineHash === undefined) {
      continue;
    }
    const firstIndex = seenLineHashes.get(lineHash);
    if (firstIndex !== undefined) {
      errors.push(
        `statement.lines[${index}].lineHash duplicates statement.lines[${firstIndex}].lineHash ` +
          '(line_hash must be unique within one statement).'
      );
    } else {
      seenLineHashes.set(lineHash, index);
    }
  }

  const mappedLines: PreIngestStructuredBankStatementRpcLineJson[] = [];
  for (let index = 0; index < lines.length; index++) {
    const mapped = mapStatementLine(lines[index], index, currency ?? '', errors);
    if (mapped !== undefined) {
      mappedLines.push(mapped);
    }
  }

  if (errors.length > 0) {
    return placeholderStagedPayload(input, common);
  }

  return {
    p_requested_status: input.requestedStatus,
    p_source_format: common.sourceFormat,
    p_bank: common.bank,
    p_source_file_name_redacted: common.sourceFileNameRedacted,
    p_account_fingerprint: accountFingerprint as string,
    p_account_number_masked: common.accountNumberMasked,
    p_raw_text_hash: rawTextHash as string,
    p_import_id: importId as string,
    p_parser_validation_status: input.parserValidationStatus,
    p_rejected_reason: null,
    p_errors_count: common.errorsCount,
    p_warnings_count: common.warningsCount,
    p_runtime_version: common.runtimeVersion,
    p_parser_version: common.parserVersion,
    p_statement: {
      currency: currency as string,
      period_start_date: periodStartDate as string,
      period_end_date: periodEndDate as string,
      statement_date: statementDate,
      opening_balance: openingBalance as number,
      total_debits: totalDebits as number,
      total_credits: totalCredits as number,
      closing_balance: closingBalance as number,
      calculated_closing: calculatedClosing as number,
      discrepancy: discrepancy as number,
      // Mirror STRUCTURED_CSV_LINE_COUNT: declared count IS the mapped count.
      line_count: mappedLines.length
    },
    p_lines: mappedLines
  };
}

function mapStatementLine(
  line: BankAccountStatementLine,
  index: number,
  statementCurrency: string,
  errors: string[]
): PreIngestStructuredBankStatementRpcLineJson | undefined {
  const label = `statement.lines[${index}]`;

  if (line === null || typeof line !== 'object') {
    errors.push(`${label} must be an object.`);
    return undefined;
  }

  // Fail-closed idempotency gate: every staged line must already carry the
  // 64-hex lineHash computed by the pre-ingestion layer.
  const lineHash = trimToUndefined(line.lineHash);
  if (lineHash === undefined || !SHA256_HEX_PATTERN.test(lineHash)) {
    errors.push(`${label}.lineHash is required and must be a 64-char lowercase hex SHA-256.`);
  }

  if (line.direction !== 'debit' && line.direction !== 'credit') {
    errors.push(`${label}.direction must be "debit" or "credit", received "${String(line.direction)}".`);
  }

  const descriptionSanitized = trimToUndefined(line.descriptionSanitized);
  if (descriptionSanitized === undefined) {
    errors.push(`${label}.descriptionSanitized is required and must be non-empty.`);
  }

  const transactionDate = validateRequiredStrictDate(line.transactionDate, `${label}.transactionDate`, errors);
  const valueDate = validateOptionalStrictDate(line.valueDate, `${label}.valueDate`, errors);

  const signedAmount = validateRequiredAmount(line.signedAmount, `${label}.signedAmount`, errors);
  const debitAmount = validateOptionalAmount(line.debitAmount, `${label}.debitAmount`, errors);
  const creditAmount = validateOptionalAmount(line.creditAmount, `${label}.creditAmount`, errors);
  const runningBalance = validateOptionalAmount(line.runningBalance, `${label}.runningBalance`, errors);

  // Mirror of lines_staging_one_amount (hardened PR #77): the amount carried
  // by the direction is mandatory and exclusive, the sign of signedAmount is
  // structural, its magnitude must equal the carried amount, and a zero
  // amount is refused. The sign/magnitude checks only run once the involved
  // amounts passed the strict format validation above.
  if (line.direction === 'debit') {
    if (line.debitAmount === undefined) {
      errors.push(`${label}: a debit line requires debitAmount (lines_staging_one_amount mirror).`);
    }
    if (line.creditAmount !== undefined) {
      errors.push(`${label}: a debit line must not carry creditAmount (lines_staging_one_amount mirror).`);
    }
    if (signedAmount !== null && debitAmount !== null && line.creditAmount === undefined) {
      if (!(signedAmount < 0)) {
        errors.push(`${label}: a debit line requires signedAmount < 0 (zero is refused).`);
      } else if (Math.abs(signedAmount) !== debitAmount) {
        errors.push(`${label}: abs(signedAmount) must equal debitAmount (lines_staging_one_amount mirror).`);
      }
    }
  } else if (line.direction === 'credit') {
    if (line.creditAmount === undefined) {
      errors.push(`${label}: a credit line requires creditAmount (lines_staging_one_amount mirror).`);
    }
    if (line.debitAmount !== undefined) {
      errors.push(`${label}: a credit line must not carry debitAmount (lines_staging_one_amount mirror).`);
    }
    if (signedAmount !== null && creditAmount !== null && line.debitAmount === undefined) {
      if (!(signedAmount > 0)) {
        errors.push(`${label}: a credit line requires signedAmount > 0 (zero is refused).`);
      } else if (signedAmount !== creditAmount) {
        errors.push(`${label}: signedAmount must equal creditAmount (lines_staging_one_amount mirror).`);
      }
    }
  }

  if (!Number.isInteger(line.sourceLineIndex) || line.sourceLineIndex < 0) {
    errors.push(`${label}.sourceLineIndex must be an integer >= 0.`);
  }

  const lineCurrency = trimToUndefined(line.currency) ?? statementCurrency;
  if (lineCurrency === '') {
    errors.push(`${label}.currency could not be resolved (line and statement currency are both empty).`);
  }

  if (errors.length > 0) {
    return undefined;
  }

  return {
    source_line_index: line.sourceLineIndex,
    transaction_date: transactionDate as string,
    value_date: valueDate,
    description_sanitized: descriptionSanitized as string,
    debit_amount: debitAmount,
    credit_amount: creditAmount,
    signed_amount: signedAmount as number,
    running_balance: runningBalance,
    direction: line.direction as 'debit' | 'credit',
    currency: lineCurrency,
    line_hash: lineHash as string
  };
}

// Placeholder returned on the error path of the staged branch: the caller
// always receives `success: false` in that case, so this payload is never
// exposed; it only keeps the function's return type total.
function placeholderStagedPayload(
  input: PreIngestStructuredBankStatementStagedInput,
  common: ValidatedCommonFields
): PreIngestStructuredBankStatementRpcPayload {
  return {
    p_requested_status: input.requestedStatus,
    p_source_format: common.sourceFormat,
    p_bank: common.bank,
    p_source_file_name_redacted: common.sourceFileNameRedacted,
    p_account_fingerprint: null,
    p_account_number_masked: common.accountNumberMasked,
    p_raw_text_hash: null,
    p_import_id: null,
    p_parser_validation_status: input.parserValidationStatus ?? null,
    p_rejected_reason: null,
    p_errors_count: common.errorsCount,
    p_warnings_count: common.warningsCount,
    p_runtime_version: common.runtimeVersion,
    p_parser_version: common.parserVersion,
    p_statement: null,
    p_lines: null
  };
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

function validateSourceFileNameRedacted(value: string | undefined, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined) {
    return null; // the RPC parameter is nullable; absent is the safe default.
  }
  if (trimmed.length > MAX_SAFE_FILE_NAME_LENGTH) {
    errors.push(`sourceFileNameRedacted must not exceed ${MAX_SAFE_FILE_NAME_LENGTH} characters.`);
    return null;
  }
  if (PATH_SEPARATOR_PATTERN.test(trimmed)) {
    errors.push('sourceFileNameRedacted must not contain path separators; pass a bare, redacted file name.');
    return null;
  }
  if (LONG_DIGIT_RUN_PATTERN.test(trimmed) || IBAN_LIKE_PATTERN.test(trimmed)) {
    errors.push(
      'sourceFileNameRedacted still looks sensitive (long digit run or IBAN-like value); ' +
        'redact it upstream or omit it (fail-closed).'
    );
    return null;
  }
  return trimmed;
}

function validateAccountNumberMasked(value: string | undefined, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined) {
    return null;
  }
  if (!ACCOUNT_NUMBER_MASKED_PATTERN.test(trimmed)) {
    errors.push(
      'accountNumberMasked must match the strict masked pattern (asterisks then at most ' +
        '4 digits), mirror of the migration CHECK; anything else is refused (fail-closed).'
    );
    return null;
  }
  return trimmed;
}

function validateCount(value: number | undefined, label: string, errors: string[]): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be an integer >= 0, received "${String(value)}".`);
    return 0;
  }
  return value;
}

function validateOptionalParserStatus(
  value: PreIngestStructuredBankStatementParserStatus | undefined,
  errors: string[]
): PreIngestStructuredBankStatementParserStatus | null {
  if (value === undefined) {
    return null;
  }
  if (value !== 'valid' && value !== 'needs_review' && value !== 'invalid' && value !== 'unsupported') {
    errors.push(
      `parserValidationStatus must be one of valid|needs_review|invalid|unsupported, received "${String(value)}".`
    );
    return null;
  }
  return value;
}

function validateRequiredSha256Hex(value: string | undefined, label: string, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined || !SHA256_HEX_PATTERN.test(trimmed)) {
    errors.push(`${label} is required and must be a 64-char lowercase hex SHA-256.`);
    return null;
  }
  return trimmed;
}

function validateOptionalSha256Hex(value: string | undefined, label: string, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined) {
    return null;
  }
  if (!SHA256_HEX_PATTERN.test(trimmed)) {
    errors.push(`${label}, when provided, must be a 64-char lowercase hex SHA-256.`);
    return null;
  }
  return trimmed;
}

function validateRequiredStrictDate(value: string | undefined, label: string, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined || !isStrictDdMmYyyyDate(trimmed)) {
    errors.push(`${label} is required and must be a real DD/MM/YYYY date (fail-closed, D1/D2).`);
    return null;
  }
  return trimmed;
}

function validateOptionalStrictDate(value: string | undefined, label: string, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined) {
    return null;
  }
  if (!isStrictDdMmYyyyDate(trimmed)) {
    errors.push(`${label}, when provided, must be a real DD/MM/YYYY date (fail-closed, D1/D2).`);
    return null;
  }
  return trimmed;
}

function validateRequiredAmount(value: number | undefined, label: string, errors: string[]): number | null {
  if (value === undefined || !isStrictAmount(value)) {
    errors.push(`${label} is required and must be a finite amount with at most 2 decimals and 16 integer digits.`);
    return null;
  }
  return value === 0 ? 0 : value; // collapse negative zero
}

function validateOptionalAmount(value: number | undefined, label: string, errors: string[]): number | null {
  if (value === undefined) {
    return null;
  }
  if (!isStrictAmount(value)) {
    errors.push(`${label}, when provided, must be a finite amount with at most 2 decimals and 16 integer digits.`);
    return null;
  }
  return value === 0 ? 0 : value;
}

function isStrictAmount(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && STRICT_AMOUNT_PATTERN.test(String(value));
}

function isStrictDdMmYyyyDate(value: string): boolean {
  if (!STRICT_DATE_PATTERN.test(value)) {
    return false;
  }
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(3, 5));
  const year = Number(value.slice(6, 10));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  // Round-trip mirror of D2: the reconstructed date must carry the exact same
  // components (rejects 31/02/2026 and any silently-corrected value).
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

// Chronological comparison of two ALREADY-VALIDATED strict DD/MM/YYYY dates:
// the YYYYMMDD reordering makes plain string comparison chronological.
function compareStrictDdMmYyyy(a: string, b: string): number {
  const keyA = a.slice(6, 10) + a.slice(3, 5) + a.slice(0, 2);
  const keyB = b.slice(6, 10) + b.slice(3, 5) + b.slice(0, 2);
  if (keyA < keyB) {
    return -1;
  }
  return keyA > keyB ? 1 : 0;
}

function normalizeKeyForBlocklist(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
