/**
 * Pure adapter from a parsed `StructuredBankStatementDocument` to a
 * `BankAccountStatementImportResult` (POC-BANK-STRUCTURED-EXPORTS-0G).
 *
 * Scope and hard boundaries (deliberately not crossed here):
 *  - This function is PURE: it performs NO I/O, no decoding, no hashing and no
 *    database access. It only re-shapes an already-parsed document.
 *  - It never re-parses raw CSV, never re-derives a bank identity from the body,
 *    never fabricates an account number and never emits `UNKNOWN_MASKED_ACCOUNT`.
 *  - It never computes `importId`, `rawTextHash` or any `lineHash`: those belong
 *    to the runtime boundary and are only forwarded when explicitly provided.
 *  - Real ingestion is out of scope: `success` is reserved to a fully reconciled
 *    `valid` document. `needs_review` never yields `success: true`; it can only
 *    produce a review statement when the caller opts in and every mandatory field
 *    is present. `invalid` and `unsupported` never produce a statement.
 *  - DAILY-INGESTION-0C guard: a BRIDGE-named source file or an UNKNOWN bank
 *    hint is a hard rejection on this adaptation path — never a mere warning.
 *    The read-only diagnostic service does not go through this adapter and
 *    keeps returning its safe summary for any CSV.
 *
 * The raw account number, raw CSV text and raw transaction cells are never
 * surfaced: only the already-masked / already-sanitized document fields flow
 * through.
 */

import type {
  BankAccountStatement,
  BankAccountStatementImportResult,
  BankAccountStatementLine,
  BankAccountStatementValidation
} from '@/types/bankAccountStatement';
import type {
  StructuredBankStatementDocument,
  StructuredBankStatementLine
} from './structuredBankStatementCsvParser';

export interface StructuredBankStatementCsvImportAdapterOptions {
  /** Trusted bank identity. Never inferred from the transactional body. */
  bank: 'BDK' | 'ORA';
  sourceFileName?: string;
  sourceFormat?: string;
  /** Forwarded verbatim when provided; never computed here. */
  importId?: string;
  /** Forwarded verbatim when provided; never computed here. */
  rawTextHash?: string;
  /** Forwarded from options first, then from the document; never fabricated. */
  accountFingerprint?: string;
  /**
   * When `true`, a `needs_review` document may produce a review statement (still
   * with `success: false`). Defaults to `false`.
   */
  includeNeedsReviewStatement?: boolean;
}

const DETECTED_FORMAT = 'structured_bank_statement_csv';
const DEFAULT_SOURCE_FORMAT = 'structured_bank_statement_csv';

// ---------------------------------------------------------------------------
// DAILY-INGESTION-0C — ingestion/adaptation guard (pure, no I/O).
// ---------------------------------------------------------------------------

export const BRIDGE_CSV_INGESTION_REJECTION_MESSAGE =
  'BRIDGE CSV is not supported for ingestion; use the XLSX export.';

export const UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE =
  'Document bank hint is UNKNOWN; ingestion and adaptation require a trusted BDK or ORA source file name.';

export interface StructuredBankStatementIngestionGuardInput {
  sourceFileName?: string;
  bankHint: StructuredBankStatementDocument['bankHint'];
}

/**
 * Fail-closed eligibility check shared by the 0G adapter and the 0I
 * pre-ingestion layer: BRIDGE exports (any source file name containing
 * "bridge") and UNKNOWN bank hints can never become a promotable statement.
 * Returns the controlled rejection message, or `undefined` when eligible.
 */
export function findStructuredBankStatementIngestionGuardRejection(
  input: StructuredBankStatementIngestionGuardInput
): string | undefined {
  const name = (input.sourceFileName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (name.includes('bridge')) {
    return BRIDGE_CSV_INGESTION_REJECTION_MESSAGE;
  }
  if (input.bankHint !== 'BDK' && input.bankHint !== 'ORA') {
    return UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE;
  }
  return undefined;
}

export function adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
  document: StructuredBankStatementDocument,
  options: StructuredBankStatementCsvImportAdapterOptions
): BankAccountStatementImportResult {
  const adapterWarnings: string[] = [];

  // 0. DAILY-INGESTION-0C guard: BRIDGE / UNKNOWN are hard rejections on the
  //    adaptation path. Evaluated before anything else so no statement can be
  //    produced for an ineligible source.
  const guardRejection = findStructuredBankStatementIngestionGuardRejection({
    sourceFileName: options.sourceFileName ?? document.sourceFileName,
    bankHint: document.bankHint
  });
  if (guardRejection !== undefined) {
    return buildRejectedResult(document, options, [guardRejection], adapterWarnings);
  }

  // 1. Bank-hint coherence: after the 0C guard the hint is concrete (BDK/ORA);
  //    a hint that contradicts the requested bank is a hard rejection.
  if (document.bankHint !== options.bank) {
    return buildRejectedResult(
      document,
      options,
      [`Document bank hint "${document.bankHint}" contradicts the requested bank "${options.bank}".`],
      adapterWarnings
    );
  }

  const status = document.validation.status;

  // 2. Terminal statuses that can never yield a statement.
  if (status === 'invalid' || status === 'unsupported') {
    return buildRejectedResult(
      document,
      options,
      [`Document status "${status}" cannot be mapped to a bank account statement.`],
      adapterWarnings
    );
  }

  // 3. A statement is meaningless without at least one transaction line.
  if (document.lines.length === 0) {
    return buildRejectedResult(
      document,
      options,
      ['Document has no transaction lines to map.'],
      adapterWarnings
    );
  }

  // 4. Defence in depth: a line with an unknown direction is never mappable
  //    (the parser already forces `invalid` in this case).
  if (document.lines.some((line) => line.direction === 'unknown')) {
    return buildRejectedResult(
      document,
      options,
      ['Document contains a transaction line with an unknown direction.'],
      adapterWarnings
    );
  }

  // 5. `needs_review` yields nothing unless the caller explicitly opts in.
  if (status === 'needs_review' && options.includeNeedsReviewStatement !== true) {
    return buildRejectedResult(
      document,
      options,
      ['Document status is needs_review; a review statement was not requested.'],
      adapterWarnings
    );
  }

  // 6. Mandatory fields required to construct a BankAccountStatement.
  const missingFields = collectMissingMandatoryFields(document);
  if (missingFields.length > 0) {
    return buildRejectedResult(
      document,
      options,
      [`Missing mandatory fields for a bank account statement: ${missingFields.join(', ')}.`],
      adapterWarnings
    );
  }

  // 7. A `valid` document must actually reconcile. A forced fixture claiming
  //    `valid` while carrying a non-zero discrepancy is never ingestable.
  if (status === 'valid' && !isReconciled(document)) {
    return buildRejectedResult(
      document,
      options,
      ['Document is marked valid but its balances do not reconcile; refusing to map.'],
      adapterWarnings
    );
  }

  const currency = document.currency as string;
  const validation = buildValidation(document, adapterWarnings, []);
  const statement = buildStatement(document, options, currency, validation, adapterWarnings);
  const success = status === 'valid';

  return {
    success,
    statement,
    detectedFormat: DETECTED_FORMAT,
    bank: options.bank,
    sourceFileName: options.sourceFileName ?? document.sourceFileName,
    validation,
    errors: [...document.errors],
    warnings: [...document.warnings, ...adapterWarnings],
    rejectedReason: success
      ? undefined
      : 'Document status is needs_review; the statement requires manual review before ingestion.'
  };
}

function collectMissingMandatoryFields(document: StructuredBankStatementDocument): string[] {
  const missing: string[] = [];
  if (document.currency === undefined) {
    missing.push('currency');
  }
  if (document.accountNumberMasked === undefined) {
    missing.push('accountNumberMasked');
  }
  if (document.openingBalance === undefined) {
    missing.push('openingBalance');
  }
  if (document.declaredTotalDebits === undefined) {
    missing.push('declaredTotalDebits');
  }
  if (document.declaredTotalCredits === undefined) {
    missing.push('declaredTotalCredits');
  }
  if (document.declaredClosingBalance === undefined) {
    missing.push('declaredClosingBalance');
  }
  return missing;
}

function isReconciled(document: StructuredBankStatementDocument): boolean {
  // A `valid` document is only considered reconciled when every reconciliation
  // signal is positively present: the closing balance was recomputed, matches
  // the declared one exactly, and both the declared totals and the running
  // balances were confirmed consistent. An absent (`undefined`) signal is never
  // treated as reconciled.
  const validation = document.validation;
  return (
    validation.computedClosingBalance !== undefined &&
    validation.closingBalanceDiscrepancy === 0 &&
    validation.declaredTotalsMatchLines === true &&
    validation.lineBalancesConsistent === true
  );
}

function buildStatement(
  document: StructuredBankStatementDocument,
  options: StructuredBankStatementCsvImportAdapterOptions,
  currency: string,
  validation: BankAccountStatementValidation,
  adapterWarnings: string[]
): BankAccountStatement {
  const statement: BankAccountStatement = {
    bank: options.bank,
    currency,
    periodStartDate: document.periodStart,
    periodEndDate: document.periodEnd,
    statementDate: document.statementDate,
    closingDate: document.statementDate,
    accountIdentity: {
      accountNumberMasked: document.accountNumberMasked as string,
      accountFingerprint: options.accountFingerprint ?? document.accountFingerprint
    },
    openingBalance: document.openingBalance as number,
    totalDebits: document.declaredTotalDebits as number,
    totalCredits: document.declaredTotalCredits as number,
    closingBalance: document.declaredClosingBalance as number,
    lines: document.lines.map((line) => mapLine(line, currency)),
    validation,
    sourceFileName: options.sourceFileName ?? document.sourceFileName,
    sourceFormat: options.sourceFormat ?? DEFAULT_SOURCE_FORMAT,
    status: document.validation.status,
    errors: [...document.errors],
    warnings: [...document.warnings, ...adapterWarnings]
  };

  // Runtime-owned identifiers are forwarded only when explicitly provided.
  if (options.importId !== undefined) {
    statement.importId = options.importId;
  }
  if (options.rawTextHash !== undefined) {
    statement.rawTextHash = options.rawTextHash;
  }

  return statement;
}

function mapLine(line: StructuredBankStatementLine, currency: string): BankAccountStatementLine {
  const mapped: BankAccountStatementLine = {
    sourceLineIndex: line.sourceRowIndex,
    transactionDate: line.operationDate,
    valueDate: line.valueDate,
    descriptionSanitized: line.descriptionSanitized,
    debitAmount: line.debit,
    creditAmount: line.credit,
    signedAmount: line.signedAmount,
    runningBalance: line.balance,
    direction: line.direction,
    currency
  };

  // No `lineHash` is generated in this lot.
  if (line.warnings) {
    mapped.warnings = [...line.warnings];
  }

  return mapped;
}

function buildValidation(
  document: StructuredBankStatementDocument,
  adapterWarnings: string[],
  adapterErrors: string[]
): BankAccountStatementValidation {
  const validation = document.validation;

  return {
    calculatedClosing: validation.computedClosingBalance ?? 0,
    discrepancy: validation.closingBalanceDiscrepancy ?? 0,
    isValid: validation.status === 'valid',
    status: validation.status,
    openingBalanceFound: validation.openingBalanceFound,
    totalDebitsFound: document.declaredTotalDebits !== undefined,
    totalCreditsFound: document.declaredTotalCredits !== undefined,
    closingBalanceFound: validation.closingBalanceFound,
    declaredTotalsMatchLines: validation.declaredTotalsMatchLines,
    lineBalancesConsistent: validation.lineBalancesConsistent,
    errors: [...validation.errors, ...adapterErrors],
    warnings: [...validation.warnings, ...adapterWarnings]
  };
}

function buildRejectedResult(
  document: StructuredBankStatementDocument,
  options: StructuredBankStatementCsvImportAdapterOptions,
  adapterErrors: string[],
  adapterWarnings: string[]
): BankAccountStatementImportResult {
  const validation = buildValidation(document, adapterWarnings, adapterErrors);

  return {
    success: false,
    detectedFormat: DETECTED_FORMAT,
    bank: options.bank,
    sourceFileName: options.sourceFileName ?? document.sourceFileName,
    validation,
    errors: [...document.errors, ...adapterErrors],
    warnings: [...document.warnings, ...adapterWarnings],
    rejectedReason:
      adapterErrors.join(' ') ||
      document.errors[0] ||
      'Document could not be mapped to a bank account statement.'
  };
}
