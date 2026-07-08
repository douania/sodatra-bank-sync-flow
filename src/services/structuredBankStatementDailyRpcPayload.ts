/**
 * RPC payload contract for the FUTURE daily-unit write path
 * (DAILY-RPC-V2-PAYLOAD-0G).
 *
 * PREPARATORY MODULE ONLY: it builds and validates a SAFE, deterministic
 * payload for the future `pre_ingest_daily_statement_units` RPC — it NEVER
 * sends it. No migration exists yet for this contract: the SQL twin is a
 * future lot (0H), the actual Supabase call a later one. Until then this
 * module has zero dependency on the Supabase client and zero network access.
 *
 * Doctrine CTO (0F acted):
 *  - one export attempt carries N daily units; the canonical unit is
 *    (bank, accountFingerprint, currency, accountingDate) hashed into the
 *    period-independent dayUnitId (0E);
 *  - rawTextHash, sourceFileNameRedacted and exportPeriodStart/End are
 *    TRACEABILITY ONLY: they ride on p_attempt and never feed any identity;
 *  - p_lines is FLAT, joined to p_units by day_unit_id; every coherence gate
 *    (orphan line, line_count, accounting_date, currency) is enforced here
 *    fail-closed, and the day_content_hash of every unit is RECOMPUTED from
 *    the lines instead of trusting any caller-provided value;
 *  - ORA: a non-closed day is never promotable — units at/after the trusted
 *    exportReferenceDate are marked 'provisional'; an ORA deposit WITHOUT an
 *    exportReferenceDate holds its last accounting day provisional
 *    (fail-closed), never silently promotable;
 *  - backfill (BIS): dedicated mode with a mandatory grant reference; the
 *    daily mode keeps the 0C period cap. Nothing is lifted DB-side here —
 *    this lot only shapes and gates the payload.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - no Supabase import, no RPC client call, no network, no DB write, no UI;
 *  - NODE-ONLY: the day_content_hash recomputation imports the Node 0H helper
 *    (node:crypto); this module must NEVER be imported from a page/component
 *    or any browser-bundled chain. The hash itself has a browser twin for a
 *    future browser composition lot;
 *  - never accepts raw CSV text/bytes, full account numbers or IBAN-like
 *    values: forbidden keys are refused wherever they appear (deep scan), and
 *    unredacted-looking file names or unmasked-looking account labels are
 *    refused fail-closed;
 *  - every builder returns a controlled result — it never throws for a bad
 *    input: `{ success: false, errors }` carries every violated gate.
 */

import { buildStructuredBankStatementDayContentHash } from './structuredBankStatementCsvIdempotencyKeys';
import { deriveStructuredBankStatementDailyAggregates } from './structuredBankStatementDailyAggregates';
import type {
  StructuredBankStatementDailyLine,
  StructuredBankStatementDailyUnit
} from './structuredBankStatementDailyIdentity';
import { MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS } from './structuredBankStatementCsvPreIngestion';

// ---------------------------------------------------------------------------
// RPC name registry (v2). Wiring is a future lot; no RPC exists yet.
// ---------------------------------------------------------------------------

export const PRE_INGEST_DAILY_STATEMENT_UNITS_RPC_NAME =
  'pre_ingest_daily_statement_units' as const;

// ---------------------------------------------------------------------------
// Whitelists and blocklist — the future migration (0H) must mirror them.
// ---------------------------------------------------------------------------

/** `p_attempt` jsonb whitelist (anti-smuggling, future SQL mirror). */
export const DAILY_STATEMENT_RPC_ATTEMPT_ALLOWED_KEYS = Object.freeze([
  'requested_mode',
  'source_format',
  'bank',
  'currency',
  'account_fingerprint',
  'account_number_masked',
  'source_file_name_redacted',
  'raw_text_hash',
  'export_period_start',
  'export_period_end',
  'statement_date',
  'export_reference_date',
  'parser_validation_status',
  'errors_count',
  'warnings_count',
  'runtime_version',
  'parser_version'
] as const);

/** One `p_units[]` element whitelist (anti-smuggling, future SQL mirror). */
export const DAILY_STATEMENT_RPC_UNIT_ALLOWED_KEYS = Object.freeze([
  'day_unit_id',
  'accounting_date',
  'day_content_hash',
  'line_count',
  'day_total_debits',
  'day_total_credits',
  'opening_balance_derived',
  'closing_balance_derived',
  'aggregates_status',
  'validation_status',
  'requested_unit_status'
] as const);

/** One `p_lines[]` element whitelist (anti-smuggling, future SQL mirror). */
export const DAILY_STATEMENT_RPC_LINE_ALLOWED_KEYS = Object.freeze([
  'day_unit_id',
  'daily_line_hash',
  'daily_occurrence_ordinal',
  'source_line_index',
  'accounting_date',
  'value_date',
  'description_sanitized',
  'debit_amount',
  'credit_amount',
  'signed_amount',
  'running_balance',
  'direction',
  'currency'
] as const);

/** `p_guard_context` jsonb whitelist (anti-smuggling, future SQL mirror). */
export const DAILY_STATEMENT_RPC_GUARD_ALLOWED_KEYS = Object.freeze([
  'ingestion_ready',
  'period_days',
  'bridge_guard_passed',
  'backfill_grant_reference'
] as const);

/**
 * Keys that must NEVER appear anywhere in an outgoing payload (nor in the
 * caller input). Matching is exact on a normalized form (lowercased,
 * non-alphanumerics stripped), so `raw_csv` and `rawCsv` are both blocked
 * while the authorized `raw_text_hash` / `account_number_masked` — which only
 * CONTAIN a blocked substring — are not.
 */
export const DAILY_STATEMENT_FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
  'raw_csv',
  'raw_text',
  'raw_bytes',
  'raw_content',
  'file_content',
  'account_number',
  'iban',
  'decoded_text',
  'full_iban',
  'raw_account',
  'account_number_raw'
] as const);

const FORBIDDEN_KEYS_NORMALIZED: ReadonlySet<string> = new Set(
  DAILY_STATEMENT_FORBIDDEN_PAYLOAD_KEYS.map((key) => normalizeKeyForBlocklist(key))
);

// ---------------------------------------------------------------------------
// Payload types — strict snake_case mapping of the future RPC parameters.
// ---------------------------------------------------------------------------

export type DailyStatementRequestedMode = 'daily' | 'backfill';

export type DailyStatementParserValidationStatus = 'valid' | 'needs_review';

/**
 * Declared disposition of one unit: 'staged' units are candidates for the
 * normal pipeline; 'provisional' units (ORA non-closed day) must NEVER be
 * promoted. The future RPC re-derives this server-side from
 * export_reference_date — a divergence is a rejection, not a trust.
 */
export type DailyStatementRequestedUnitStatus = 'staged' | 'provisional';

export interface PreIngestDailyStatementUnitsRpcAttemptJson {
  requested_mode: DailyStatementRequestedMode;
  source_format: string;
  bank: string;
  currency: string;
  account_fingerprint: string;
  account_number_masked: string | null;
  source_file_name_redacted: string | null;
  raw_text_hash: string;
  export_period_start: string;
  export_period_end: string;
  statement_date: string | null;
  export_reference_date: string | null;
  parser_validation_status: DailyStatementParserValidationStatus;
  errors_count: number;
  warnings_count: number;
  runtime_version: string | null;
  parser_version: string | null;
}

export interface PreIngestDailyStatementUnitsRpcUnitJson {
  day_unit_id: string;
  accounting_date: string;
  day_content_hash: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: 'derived' | 'unavailable';
  validation_status: 'valid' | 'needs_review';
  requested_unit_status: DailyStatementRequestedUnitStatus;
}

export interface PreIngestDailyStatementUnitsRpcLineJson {
  day_unit_id: string;
  daily_line_hash: string;
  daily_occurrence_ordinal: number;
  source_line_index: number;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
}

export interface PreIngestDailyStatementUnitsRpcGuardContextJson {
  ingestion_ready: boolean;
  period_days: number;
  bridge_guard_passed: boolean;
  backfill_grant_reference: string | null;
}

export interface PreIngestDailyStatementUnitsRpcPayload {
  p_attempt: PreIngestDailyStatementUnitsRpcAttemptJson;
  p_units: PreIngestDailyStatementUnitsRpcUnitJson[];
  p_lines: PreIngestDailyStatementUnitsRpcLineJson[];
  p_guard_context: PreIngestDailyStatementUnitsRpcGuardContextJson;
}

// ---------------------------------------------------------------------------
// Builder input — camelCase runtime values, mapped here to snake_case.
// ---------------------------------------------------------------------------

export interface DailyStatementRpcAttemptInput {
  requestedMode: DailyStatementRequestedMode;
  sourceFormat: string;
  bank: 'BDK' | 'ORA' | string;
  currency: string;
  /** Mandatory, fail-closed — never derived from the masked number. */
  accountFingerprint: string;
  /**
   * Strict masked label, mirror of the v1 tables' CHECK `^[*]+[0-9]{0,4}$`
   * (asterisks then at most 4 digits); anything else is refused fail-closed.
   */
  accountNumberMasked?: string;
  /**
   * Already-redacted display name. Refused fail-closed when it still looks
   * sensitive (path separators, 8+ consecutive digits, IBAN-like run).
   */
  sourceFileNameRedacted?: string;
  /** Traceability only (doctrine 7); 64-char lowercase hex SHA-256. */
  rawTextHash: string;
  /** Traceability only (doctrine 7); strict DD/MM/YYYY. */
  exportPeriodStart: string;
  /** Traceability only (doctrine 7); strict DD/MM/YYYY. */
  exportPeriodEnd: string;
  statementDate?: string;
  /**
   * Trusted operator/runtime statement of the day the export was produced.
   * Never inferred here (the parser carries no generation date), never
   * defaulted from a clock. Drives the non-closed-day gate below.
   */
  exportReferenceDate?: string;
  parserValidationStatus: DailyStatementParserValidationStatus;
  errorsCount?: number;
  warningsCount?: number;
  runtimeVersion?: string;
  parserVersion?: string;
}

export interface DailyStatementRpcGuardContextInput {
  /** 0C verdict computed upstream; a daily deposit requires `true`. */
  ingestionReady: boolean;
  /** Inclusive day count of the export window; re-derived and cross-checked. */
  periodDays: number;
  /** BRIDGE/UNKNOWN guard verdict; a deposit payload requires `true`. */
  bridgeGuardPassed: boolean;
  /** Mandatory in backfill mode; forbidden in daily mode. */
  backfillGrantReference?: string;
}

export interface BuildPreIngestDailyStatementUnitsRpcPayloadInput {
  attempt: DailyStatementRpcAttemptInput;
  /** Daily units produced by `buildDailyStatementUnitsFromStructuredDocument`. */
  units: StructuredBankStatementDailyUnit[];
  guardContext: DailyStatementRpcGuardContextInput;
}

export type BuildPreIngestDailyStatementUnitsRpcPayloadResult =
  | {
      success: true;
      rpcName: typeof PRE_INGEST_DAILY_STATEMENT_UNITS_RPC_NAME;
      payload: PreIngestDailyStatementUnitsRpcPayload;
      warnings: string[];
    }
  | {
      success: false;
      errors: string[];
      warnings: string[];
    };

// ---------------------------------------------------------------------------
// Strict formats — mirrors of the v1 migration parse helpers (future 0H twin).
// ---------------------------------------------------------------------------

const STRICT_DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;
const STRICT_AMOUNT_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

// Redaction heuristics (fail-closed, conservative): path separators, 8+
// consecutive digits (full-account-like) or an IBAN-like run are refused.
const PATH_SEPARATOR_PATTERN = /[\\/]/;
const LONG_DIGIT_RUN_PATTERN = /\d{8,}/;
const IBAN_LIKE_PATTERN = /[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,}/;

// Mirror of the v1 tables' CHECK on account_number_masked.
const ACCOUNT_NUMBER_MASKED_PATTERN = /^[*]+[0-9]{0,4}$/;

const MAX_SAFE_FILE_NAME_LENGTH = 200;

const DAY_IN_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the full `pre_ingest_daily_statement_units` parameter object.
 *
 * Deterministic and side-effect free: same input, same payload. Returns a
 * controlled error result (never throws) when any gate fails, when a
 * forbidden key is smuggled anywhere in the input, or when a value still
 * looks unredacted/unmasked. The built payload is itself re-validated
 * (coherence + forbidden keys) before being exposed.
 */
export function buildPreIngestDailyStatementUnitsRpcPayload(
  input: BuildPreIngestDailyStatementUnitsRpcPayloadInput
): BuildPreIngestDailyStatementUnitsRpcPayloadResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Anti-smuggling first: a forbidden key anywhere in the caller input is an
  // immediate, controlled rejection — even if the mapping below would have
  // dropped it anyway.
  for (const path of findForbiddenDailyStatementPayloadKeys(input)) {
    errors.push(
      `forbidden key in input at ${path}: raw CSV content, full account numbers and IBANs are never accepted.`
    );
  }

  const attempt = input.attempt;
  if (attempt === null || typeof attempt !== 'object') {
    errors.push('attempt metadata is required.');
    return { success: false, errors, warnings };
  }

  if (attempt.requestedMode !== 'daily' && attempt.requestedMode !== 'backfill') {
    errors.push(
      `attempt.requestedMode must be "daily" or "backfill", received "${String(
        (attempt as { requestedMode?: unknown }).requestedMode
      )}".`
    );
    return { success: false, errors, warnings };
  }

  const attemptJson = validateAttempt(attempt, errors);
  const guardJson = validateGuardContext(input.guardContext, attempt, attemptJson, errors);

  if (!Array.isArray(input.units) || input.units.length === 0) {
    errors.push('units must be a non-empty array: an export deposit carries at least one daily unit.');
    return { success: false, errors, warnings };
  }

  const requestedStatuses = resolveRequestedUnitStatuses(
    attemptJson.bank,
    attemptJson.export_reference_date,
    input.units,
    errors,
    warnings
  );

  const unitJsons: PreIngestDailyStatementUnitsRpcUnitJson[] = [];
  const lineJsons: PreIngestDailyStatementUnitsRpcLineJson[] = [];
  const seenDayUnitIds = new Map<string, number>();

  input.units.forEach((unit, unitIndex) => {
    const label = `units[${unitIndex}]`;

    if (unit === null || typeof unit !== 'object') {
      errors.push(`${label} must be an object.`);
      return;
    }

    const dayUnitId = trimToUndefined(unit.dayUnitId);
    if (dayUnitId === undefined || !SHA256_HEX_PATTERN.test(dayUnitId)) {
      errors.push(`${label}.dayUnitId is required and must be a 64-char lowercase hex SHA-256.`);
      return;
    }
    const firstIndex = seenDayUnitIds.get(dayUnitId);
    if (firstIndex !== undefined) {
      errors.push(`${label}.dayUnitId duplicates units[${firstIndex}].dayUnitId (one unit per accounting day).`);
      return;
    }
    seenDayUnitIds.set(dayUnitId, unitIndex);

    const accountingDate = validateRequiredStrictDate(unit.accountingDate, `${label}.accountingDate`, errors);

    // Identity coherence: the unit was composed under the SAME trusted context
    // as the attempt — any divergence means the caller mixed two deposits.
    if (trimToUndefined(unit.bank) !== attemptJson.bank) {
      errors.push(`${label}.bank "${String(unit.bank)}" does not match attempt.bank "${attemptJson.bank}".`);
    }
    if (trimToUndefined(unit.accountFingerprint) !== attemptJson.account_fingerprint) {
      errors.push(`${label}.accountFingerprint does not match attempt.accountFingerprint.`);
    }
    if (trimToUndefined(unit.currency) !== attemptJson.currency) {
      errors.push(
        `${label}.currency "${String(unit.currency)}" does not match attempt.currency "${attemptJson.currency}".`
      );
    }

    if (!Array.isArray(unit.lines) || unit.lines.length === 0) {
      errors.push(`${label}.lines must be a non-empty array (a daily unit without lines cannot exist).`);
      return;
    }

    const unitLineJsons: PreIngestDailyStatementUnitsRpcLineJson[] = [];
    const seenLineHashes = new Map<string, number>();
    unit.lines.forEach((line, lineIndex) => {
      const mapped = mapDailyLine(
        line,
        `${label}.lines[${lineIndex}]`,
        dayUnitId,
        accountingDate,
        attemptJson.currency,
        errors
      );
      if (mapped === undefined) {
        return;
      }
      const duplicateIndex = seenLineHashes.get(mapped.daily_line_hash);
      if (duplicateIndex !== undefined) {
        errors.push(
          `${label}.lines[${lineIndex}].dailyLineHash duplicates lines[${duplicateIndex}] ` +
            '(daily_line_hash must be unique within one unit — ordinal bug upstream).'
        );
        return;
      }
      seenLineHashes.set(mapped.daily_line_hash, lineIndex);
      unitLineJsons.push(mapped);
    });

    if (unitLineJsons.length !== unit.lines.length) {
      // Per-line errors were already reported; never expose a partial unit.
      return;
    }

    // Aggregates: derived from the lines themselves, never caller-provided.
    const aggregates = deriveStructuredBankStatementDailyAggregates(
      unit.lines.map((line) => ({
        direction: line.direction,
        signedAmount: line.signedAmount,
        runningBalance: line.runningBalance
      }))
    );
    for (const aggregateError of aggregates.errors) {
      errors.push(`${label} aggregates: ${aggregateError}`);
    }
    for (const aggregateWarning of aggregates.warnings) {
      warnings.push(`${label} aggregates: ${aggregateWarning}`);
    }

    // day_content_hash: ALWAYS recomputed from the lines' identities.
    let dayContentHash: string;
    try {
      dayContentHash = buildStructuredBankStatementDayContentHash({
        dayUnitId,
        dailyLineHashes: unitLineJsons.map((line) => line.daily_line_hash)
      });
    } catch (error) {
      errors.push(
        `${label}: day_content_hash computation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    unitJsons.push({
      day_unit_id: dayUnitId,
      accounting_date: accountingDate ?? '',
      day_content_hash: dayContentHash,
      line_count: unitLineJsons.length,
      day_total_debits: aggregates.dayTotalDebits,
      day_total_credits: aggregates.dayTotalCredits,
      opening_balance_derived: aggregates.openingBalanceDerived ?? null,
      closing_balance_derived: aggregates.closingBalanceDerived ?? null,
      aggregates_status: aggregates.aggregatesStatus,
      validation_status: aggregates.validationStatus,
      requested_unit_status: requestedStatuses[unitIndex]
    });
    lineJsons.push(...unitLineJsons);
  });

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  const payload: PreIngestDailyStatementUnitsRpcPayload = {
    p_attempt: attemptJson,
    p_units: unitJsons,
    p_lines: lineJsons,
    p_guard_context: guardJson
  };

  // Belt and braces: the assembled payload is re-validated as a whole. With
  // the explicit mapping above this can only fire on a coding defect — fail
  // closed rather than expose an incoherent payload.
  const coherenceErrors = findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(payload);
  if (coherenceErrors.length > 0) {
    return { success: false, errors: coherenceErrors, warnings };
  }
  const forbiddenInPayload = findForbiddenDailyStatementPayloadKeys(payload);
  if (forbiddenInPayload.length > 0) {
    return {
      success: false,
      errors: forbiddenInPayload.map((path) => `forbidden key in built payload at ${path}; refusing to expose it.`),
      warnings
    };
  }

  return {
    success: true,
    rpcName: PRE_INGEST_DAILY_STATEMENT_UNITS_RPC_NAME,
    payload,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Payload-level coherence validation (exported: the future runtime and the
// tests exercise it directly against tampered payloads).
// ---------------------------------------------------------------------------

/**
 * Validate an ASSEMBLED payload as a whole, mirror of the gates the future
 * RPC must enforce server-side: whitelisted keys only, non-empty p_units, no
 * duplicate day_unit_id, no orphan line, per-unit line_count equal to the
 * lines actually received, accounting_date and currency coherence, unique
 * daily_line_hash per unit and a day_content_hash that matches the lines.
 * Returns every violation ([] means coherent).
 */
export function findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(
  payload: PreIngestDailyStatementUnitsRpcPayload
): string[] {
  const errors: string[] = [];

  if (payload === null || typeof payload !== 'object') {
    return ['payload must be an object.'];
  }

  pushUnknownKeyErrors(payload.p_attempt, DAILY_STATEMENT_RPC_ATTEMPT_ALLOWED_KEYS, 'p_attempt', errors);
  pushUnknownKeyErrors(payload.p_guard_context, DAILY_STATEMENT_RPC_GUARD_ALLOWED_KEYS, 'p_guard_context', errors);

  if (!Array.isArray(payload.p_units) || payload.p_units.length === 0) {
    errors.push('p_units must be a non-empty array.');
    return errors;
  }
  if (!Array.isArray(payload.p_lines)) {
    errors.push('p_lines must be an array.');
    return errors;
  }

  const attemptCurrency = payload.p_attempt?.currency;
  const unitsById = new Map<string, PreIngestDailyStatementUnitsRpcUnitJson>();

  payload.p_units.forEach((unit, index) => {
    pushUnknownKeyErrors(unit, DAILY_STATEMENT_RPC_UNIT_ALLOWED_KEYS, `p_units[${index}]`, errors);
    if (typeof unit.day_unit_id !== 'string' || !SHA256_HEX_PATTERN.test(unit.day_unit_id)) {
      errors.push(`p_units[${index}].day_unit_id must be a 64-char lowercase hex SHA-256.`);
      return;
    }
    if (unitsById.has(unit.day_unit_id)) {
      errors.push(`p_units[${index}].day_unit_id is duplicated (one unit per accounting day).`);
      return;
    }
    unitsById.set(unit.day_unit_id, unit);
  });

  const lineHashesByUnit = new Map<string, string[]>();
  const seenHashPerUnit = new Map<string, Set<string>>();

  payload.p_lines.forEach((line, index) => {
    pushUnknownKeyErrors(line, DAILY_STATEMENT_RPC_LINE_ALLOWED_KEYS, `p_lines[${index}]`, errors);
    const unit = typeof line.day_unit_id === 'string' ? unitsById.get(line.day_unit_id) : undefined;
    if (unit === undefined) {
      errors.push(`p_lines[${index}].day_unit_id does not reference any p_units entry (orphan line).`);
      return;
    }
    if (line.accounting_date !== unit.accounting_date) {
      errors.push(
        `p_lines[${index}].accounting_date "${String(line.accounting_date)}" does not equal its unit's ` +
          `accounting_date "${unit.accounting_date}".`
      );
    }
    if (line.currency !== attemptCurrency) {
      errors.push(
        `p_lines[${index}].currency "${String(line.currency)}" does not equal p_attempt.currency ` +
          `"${String(attemptCurrency)}".`
      );
    }
    if (!Number.isInteger(line.daily_occurrence_ordinal) || line.daily_occurrence_ordinal < 1) {
      errors.push(`p_lines[${index}].daily_occurrence_ordinal must be an integer >= 1.`);
    }
    if (typeof line.daily_line_hash !== 'string' || !SHA256_HEX_PATTERN.test(line.daily_line_hash)) {
      errors.push(`p_lines[${index}].daily_line_hash must be a 64-char lowercase hex SHA-256.`);
      return;
    }
    const seen = seenHashPerUnit.get(unit.day_unit_id) ?? new Set<string>();
    if (seen.has(line.daily_line_hash)) {
      errors.push(`p_lines[${index}].daily_line_hash is duplicated within its unit (ordinal bug upstream).`);
      return;
    }
    seen.add(line.daily_line_hash);
    seenHashPerUnit.set(unit.day_unit_id, seen);
    const hashes = lineHashesByUnit.get(unit.day_unit_id) ?? [];
    hashes.push(line.daily_line_hash);
    lineHashesByUnit.set(unit.day_unit_id, hashes);
  });

  for (const unit of unitsById.values()) {
    const hashes = lineHashesByUnit.get(unit.day_unit_id) ?? [];
    if (hashes.length === 0) {
      errors.push(
        `p_units entry ${unit.day_unit_id} declares line_count ${unit.line_count} but received no p_lines.`
      );
      continue;
    }
    if (unit.line_count !== hashes.length) {
      errors.push(
        `p_units entry ${unit.day_unit_id} declares line_count ${unit.line_count} but received ` +
          `${hashes.length} p_lines.`
      );
      continue;
    }
    try {
      const recomputed = buildStructuredBankStatementDayContentHash({
        dayUnitId: unit.day_unit_id,
        dailyLineHashes: hashes
      });
      if (recomputed !== unit.day_content_hash) {
        errors.push(
          `p_units entry ${unit.day_unit_id} carries a day_content_hash that does not match its own lines.`
        );
      }
    } catch (error) {
      errors.push(
        `p_units entry ${unit.day_unit_id}: day_content_hash verification failed: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return errors;
}

/**
 * Deep scan for forbidden keys. Exact match on the normalized key (lowercase,
 * non-alphanumerics stripped), never a substring match: `raw_text_hash` and
 * `account_number_masked` stay authorized while `raw_text` / `rawText` /
 * `account_number` / `iban` / `decoded_text` are refused wherever they hide.
 * Returns the paths of every hit ("$" is the root).
 */
export function findForbiddenDailyStatementPayloadKeys(value: unknown, path = '$'): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      hits.push(...findForbiddenDailyStatementPayloadKeys(value[index], `${path}[${index}]`));
    }
    return hits;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS_NORMALIZED.has(normalizeKeyForBlocklist(key))) {
        hits.push(`${path}.${key}`);
      }
      hits.push(...findForbiddenDailyStatementPayloadKeys(child, `${path}.${key}`));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Attempt / guard / line validation
// ---------------------------------------------------------------------------

function validateAttempt(
  attempt: DailyStatementRpcAttemptInput,
  errors: string[]
): PreIngestDailyStatementUnitsRpcAttemptJson {
  const sourceFormat = trimToUndefined(attempt.sourceFormat);
  if (sourceFormat === undefined) {
    errors.push('attempt.sourceFormat is required and must be non-empty.');
  }
  const bank = trimToUndefined(attempt.bank);
  if (bank === undefined) {
    errors.push('attempt.bank is required and must be non-empty.');
  }
  const currency = trimToUndefined(attempt.currency);
  if (currency === undefined) {
    errors.push('attempt.currency is required and must be non-empty.');
  }
  const accountFingerprint = trimToUndefined(attempt.accountFingerprint);
  if (accountFingerprint === undefined) {
    errors.push('attempt.accountFingerprint is mandatory; no fallback on the masked account number.');
  }

  const accountNumberMasked = validateAccountNumberMasked(attempt.accountNumberMasked, errors);
  const sourceFileNameRedacted = validateSourceFileNameRedacted(attempt.sourceFileNameRedacted, errors);

  const rawTextHash = trimToUndefined(attempt.rawTextHash);
  if (rawTextHash === undefined || !SHA256_HEX_PATTERN.test(rawTextHash)) {
    errors.push('attempt.rawTextHash is required and must be a 64-char lowercase hex SHA-256.');
  }

  const exportPeriodStart = validateRequiredStrictDate(attempt.exportPeriodStart, 'attempt.exportPeriodStart', errors);
  const exportPeriodEnd = validateRequiredStrictDate(attempt.exportPeriodEnd, 'attempt.exportPeriodEnd', errors);
  if (
    exportPeriodStart !== null &&
    exportPeriodEnd !== null &&
    compareStrictDdMmYyyy(exportPeriodEnd, exportPeriodStart) < 0
  ) {
    errors.push('attempt.exportPeriodEnd must not be earlier than attempt.exportPeriodStart (fail-closed).');
  }
  const statementDate = validateOptionalStrictDate(attempt.statementDate, 'attempt.statementDate', errors);
  const exportReferenceDate = validateOptionalStrictDate(
    attempt.exportReferenceDate,
    'attempt.exportReferenceDate',
    errors
  );

  if (attempt.parserValidationStatus !== 'valid' && attempt.parserValidationStatus !== 'needs_review') {
    errors.push(
      `attempt.parserValidationStatus must be "valid" or "needs_review", received "${String(
        attempt.parserValidationStatus
      )}".`
    );
  }

  return {
    requested_mode: attempt.requestedMode,
    source_format: sourceFormat ?? '',
    bank: bank ?? '',
    currency: currency ?? '',
    account_fingerprint: accountFingerprint ?? '',
    account_number_masked: accountNumberMasked,
    source_file_name_redacted: sourceFileNameRedacted,
    raw_text_hash: rawTextHash ?? '',
    export_period_start: exportPeriodStart ?? '',
    export_period_end: exportPeriodEnd ?? '',
    statement_date: statementDate,
    export_reference_date: exportReferenceDate,
    parser_validation_status: attempt.parserValidationStatus,
    errors_count: validateCount(attempt.errorsCount, 'attempt.errorsCount', errors),
    warnings_count: validateCount(attempt.warningsCount, 'attempt.warningsCount', errors),
    runtime_version: trimToUndefined(attempt.runtimeVersion) ?? null,
    parser_version: trimToUndefined(attempt.parserVersion) ?? null
  };
}

function validateGuardContext(
  guardContext: DailyStatementRpcGuardContextInput,
  attempt: DailyStatementRpcAttemptInput,
  attemptJson: PreIngestDailyStatementUnitsRpcAttemptJson,
  errors: string[]
): PreIngestDailyStatementUnitsRpcGuardContextJson {
  if (guardContext === null || typeof guardContext !== 'object') {
    errors.push('guardContext is required.');
    return {
      ingestion_ready: false,
      period_days: 0,
      bridge_guard_passed: false,
      backfill_grant_reference: null
    };
  }

  if (typeof guardContext.ingestionReady !== 'boolean') {
    errors.push('guardContext.ingestionReady must be a boolean.');
  }
  if (typeof guardContext.bridgeGuardPassed !== 'boolean') {
    errors.push('guardContext.bridgeGuardPassed must be a boolean.');
  }
  if (!Number.isInteger(guardContext.periodDays) || guardContext.periodDays < 1) {
    errors.push('guardContext.periodDays must be an integer >= 1.');
  }

  // Cross-check: the declared period length must equal the inclusive day count
  // of the export window carried by the attempt — a caller cannot understate
  // its window to sneak past the 0C cap.
  const computedPeriodDays = computeInclusiveDayCount(
    attemptJson.export_period_start,
    attemptJson.export_period_end
  );
  if (
    computedPeriodDays !== undefined &&
    Number.isInteger(guardContext.periodDays) &&
    guardContext.periodDays !== computedPeriodDays
  ) {
    errors.push(
      `guardContext.periodDays (${guardContext.periodDays}) does not match the inclusive day count of ` +
        `the export window (${computedPeriodDays}).`
    );
  }

  // A deposit payload is only ever built for a source that passed the
  // BRIDGE/UNKNOWN guard: a failed guard is a rejection upstream, not here.
  if (guardContext.bridgeGuardPassed === false) {
    errors.push('guardContext.bridgeGuardPassed is false: a guard-rejected export never becomes a deposit payload.');
  }

  const grant = trimToUndefined(guardContext.backfillGrantReference);

  if (attempt.requestedMode === 'daily') {
    // Doctrine 8: the future write path gates on ingestionReady; building a
    // daily deposit payload for a not-ready export would bypass 0C.
    if (guardContext.ingestionReady === false) {
      errors.push('guardContext.ingestionReady is false: a daily deposit payload requires an ingestion-ready export.');
    }
    if (
      Number.isInteger(guardContext.periodDays) &&
      guardContext.periodDays > MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS
    ) {
      errors.push(
        `daily mode: the export window spans ${guardContext.periodDays} days, above the ` +
          `${MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS}-day ingestion limit (0C); use the dedicated backfill mode.`
      );
    }
    if (grant !== undefined) {
      errors.push('daily mode: backfillGrantReference must not be carried by a daily deposit (backfill only).');
    }
  } else {
    // Backfill (BIS): dedicated mode, mandatory grant. The 0C period cap is
    // deliberately not enforced here — lifting it server-side stays a future
    // DB-side decision; the payload only carries the audited grant.
    if (grant === undefined) {
      errors.push('backfill mode: backfillGrantReference is mandatory (explicit CTO grant, fail-closed).');
    }
  }

  return {
    ingestion_ready: guardContext.ingestionReady === true,
    period_days: Number.isInteger(guardContext.periodDays) ? guardContext.periodDays : 0,
    bridge_guard_passed: guardContext.bridgeGuardPassed === true,
    backfill_grant_reference: attempt.requestedMode === 'backfill' ? grant ?? null : null
  };
}

/**
 * Non-closed-day gate (doctrine 9), decided per unit BEFORE assembly:
 *  - when a trusted exportReferenceDate is provided (any bank), every unit
 *    with accountingDate >= exportReferenceDate is 'provisional';
 *  - ORA WITHOUT an exportReferenceDate: fail-closed — the unit(s) carrying
 *    the maximum accountingDate are 'provisional' (the parser exposes no
 *    export generation date, so the last day can never be proven closed);
 *  - other banks without a reference date inherit nothing: all 'staged'.
 * A provisional unit is never silently promotable; the decision is surfaced
 * as a warning so the operator sees it before any future send.
 */
function resolveRequestedUnitStatuses(
  bank: string,
  exportReferenceDate: string | null,
  units: StructuredBankStatementDailyUnit[],
  errors: string[],
  warnings: string[]
): DailyStatementRequestedUnitStatus[] {
  const dateKeys = units.map((unit) =>
    unit !== null &&
    typeof unit === 'object' &&
    typeof unit.accountingDate === 'string' &&
    STRICT_DATE_PATTERN.test(unit.accountingDate.trim())
      ? toChronologicalKey(unit.accountingDate.trim())
      : undefined
  );

  if (exportReferenceDate !== null) {
    const referenceKey = toChronologicalKey(exportReferenceDate);
    const statuses = dateKeys.map((key): DailyStatementRequestedUnitStatus =>
      key !== undefined && key >= referenceKey ? 'provisional' : 'staged'
    );
    const provisionalCount = statuses.filter((status) => status === 'provisional').length;
    if (provisionalCount > 0) {
      warnings.push(
        `${provisionalCount} unit(s) at or after exportReferenceDate ${exportReferenceDate} are marked ` +
          'provisional: a non-closed day is never promotable.'
      );
    }
    return statuses;
  }

  if (bank === 'ORA') {
    const validKeys = dateKeys.filter((key): key is string => key !== undefined);
    if (validKeys.length === 0) {
      // Accounting dates are invalid; unit validation reports them — no
      // status decision is meaningful here.
      errors.push('ORA: no valid accountingDate found to apply the non-closed-day rule (fail-closed).');
      return units.map(() => 'provisional');
    }
    const maxKey = validKeys.reduce((max, key) => (key > max ? key : max));
    const statuses = dateKeys.map((key): DailyStatementRequestedUnitStatus =>
      key === maxKey ? 'provisional' : 'staged'
    );
    warnings.push(
      'ORA export without exportReferenceDate: its last accounting day is held provisional (fail-closed) — ' +
        'the parser carries no export generation date, so that day can never be proven closed.'
    );
    return statuses;
  }

  return units.map(() => 'staged');
}

function mapDailyLine(
  line: StructuredBankStatementDailyLine,
  label: string,
  dayUnitId: string,
  unitAccountingDate: string | null,
  attemptCurrency: string,
  errors: string[]
): PreIngestDailyStatementUnitsRpcLineJson | undefined {
  const before = errors.length;

  if (line === null || typeof line !== 'object') {
    errors.push(`${label} must be an object.`);
    return undefined;
  }

  const dailyLineHash = trimToUndefined(line.dailyLineHash);
  if (dailyLineHash === undefined || !SHA256_HEX_PATTERN.test(dailyLineHash)) {
    errors.push(`${label}.dailyLineHash is required and must be a 64-char lowercase hex SHA-256.`);
  }

  if (!Number.isInteger(line.dailyOccurrenceOrdinal) || line.dailyOccurrenceOrdinal < 1) {
    errors.push(`${label}.dailyOccurrenceOrdinal must be an integer >= 1.`);
  }
  if (!Number.isInteger(line.sourceRowIndex) || line.sourceRowIndex < 0) {
    errors.push(`${label}.sourceRowIndex must be an integer >= 0.`);
  }

  const accountingDate = validateRequiredStrictDate(line.accountingDate, `${label}.accountingDate`, errors);
  if (accountingDate !== null && unitAccountingDate !== null && accountingDate !== unitAccountingDate) {
    errors.push(
      `${label}.accountingDate "${accountingDate}" does not equal its unit's accountingDate "${unitAccountingDate}".`
    );
  }
  const valueDate = validateOptionalStrictDate(line.valueDate, `${label}.valueDate`, errors);

  const descriptionSanitized = trimToUndefined(line.descriptionSanitized);
  if (descriptionSanitized === undefined) {
    errors.push(`${label}.descriptionSanitized is required and must be non-empty.`);
  }

  if (line.direction !== 'debit' && line.direction !== 'credit') {
    errors.push(`${label}.direction must be "debit" or "credit", received "${String(line.direction)}".`);
  }

  const signedAmount = validateRequiredAmount(line.signedAmount, `${label}.signedAmount`, errors);
  const debitAmount = validateOptionalAmount(line.debitAmount, `${label}.debitAmount`, errors);
  const creditAmount = validateOptionalAmount(line.creditAmount, `${label}.creditAmount`, errors);
  const runningBalance = validateOptionalAmount(line.runningBalance, `${label}.runningBalance`, errors);

  // Mirror of the v1 lines_staging_one_amount gate (hardened PR #77): the
  // amount carried by the direction is mandatory and exclusive, the sign of
  // signedAmount is structural, its magnitude must equal the carried amount,
  // and a zero amount is refused.
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

  const lineCurrency = trimToUndefined(line.currency);
  if (lineCurrency !== attemptCurrency) {
    errors.push(
      `${label}.currency "${String(line.currency)}" does not match attempt.currency "${attemptCurrency}".`
    );
  }

  if (errors.length > before) {
    return undefined;
  }

  return {
    day_unit_id: dayUnitId,
    daily_line_hash: dailyLineHash as string,
    daily_occurrence_ordinal: line.dailyOccurrenceOrdinal,
    source_line_index: line.sourceRowIndex,
    accounting_date: accountingDate as string,
    value_date: valueDate,
    description_sanitized: descriptionSanitized as string,
    debit_amount: debitAmount,
    credit_amount: creditAmount,
    signed_amount: signedAmount as number,
    running_balance: runningBalance,
    direction: line.direction as 'debit' | 'credit',
    currency: lineCurrency as string
  };
}

// ---------------------------------------------------------------------------
// Field validators (mirrors of the v1 payload module; local on purpose — the
// v1 module keeps them private and must not be modified by this lot).
// ---------------------------------------------------------------------------

function validateSourceFileNameRedacted(value: string | undefined, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined) {
    return null; // nullable parameter; absent is the safe default.
  }
  if (trimmed.length > MAX_SAFE_FILE_NAME_LENGTH) {
    errors.push(`attempt.sourceFileNameRedacted must not exceed ${MAX_SAFE_FILE_NAME_LENGTH} characters.`);
    return null;
  }
  if (PATH_SEPARATOR_PATTERN.test(trimmed)) {
    errors.push('attempt.sourceFileNameRedacted must not contain path separators; pass a bare, redacted file name.');
    return null;
  }
  if (LONG_DIGIT_RUN_PATTERN.test(trimmed) || IBAN_LIKE_PATTERN.test(trimmed)) {
    errors.push(
      'attempt.sourceFileNameRedacted still looks sensitive (long digit run or IBAN-like value); ' +
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
      'attempt.accountNumberMasked must match the strict masked pattern (asterisks then at most ' +
        '4 digits); anything else is refused (fail-closed).'
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

function validateRequiredStrictDate(value: string | undefined, label: string, errors: string[]): string | null {
  const trimmed = trimToUndefined(value);
  if (trimmed === undefined || !isStrictDdMmYyyyDate(trimmed)) {
    errors.push(`${label} is required and must be a real DD/MM/YYYY date (fail-closed).`);
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
    errors.push(`${label}, when provided, must be a real DD/MM/YYYY date (fail-closed).`);
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
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

// Chronological comparison of two ALREADY-VALIDATED strict DD/MM/YYYY dates:
// the YYYYMMDD reordering makes plain string comparison chronological.
function toChronologicalKey(value: string): string {
  return value.slice(6, 10) + value.slice(3, 5) + value.slice(0, 2);
}

function compareStrictDdMmYyyy(a: string, b: string): number {
  const keyA = toChronologicalKey(a);
  const keyB = toChronologicalKey(b);
  if (keyA < keyB) {
    return -1;
  }
  return keyA > keyB ? 1 : 0;
}

// Inclusive day count of a strict DD/MM/YYYY window; undefined when either
// bound is invalid (their own validation already reported the failure).
function computeInclusiveDayCount(start: string, end: string): number | undefined {
  if (!isStrictDdMmYyyyDate(start) || !isStrictDdMmYyyyDate(end)) {
    return undefined;
  }
  const startMs = Date.UTC(Number(start.slice(6, 10)), Number(start.slice(3, 5)) - 1, Number(start.slice(0, 2)));
  const endMs = Date.UTC(Number(end.slice(6, 10)), Number(end.slice(3, 5)) - 1, Number(end.slice(0, 2)));
  if (endMs < startMs) {
    return undefined;
  }
  return Math.round((endMs - startMs) / DAY_IN_MS) + 1;
}

function pushUnknownKeyErrors(
  value: unknown,
  allowed: readonly string[],
  label: string,
  errors: string[]
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!allowed.includes(key)) {
      errors.push(`${label} carries a key outside its whitelist: "${key}" (anti-smuggling, fail-closed).`);
    }
  }
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
