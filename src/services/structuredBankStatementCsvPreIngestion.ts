/**
 * Pure pre-ingestion layer for structured bank statement CSV exports
 * (POC-BANK-STRUCTURED-EXPORTS-0I).
 *
 * Composition, in this exact order:
 *  1. rawTextHash over the already-decoded CSV text (0H helper),
 *  2. pure parse into a `StructuredBankStatementDocument` (0B parser) from the
 *     very same text, so the fingerprint and the document can never diverge,
 *  3. importId from the trusted caller context + parsed period (0H helper),
 *     computed only when every component is present and non-empty,
 *  4. adaptation to a `BankAccountStatementImportResult` (0G adapter), with
 *     importId/rawTextHash forwarded through the adapter's existing options,
 *  5. lineHash enrichment AFTER the adapter, only when a statement and an
 *     importId both exist, on a fresh copy (the adapter result is not mutated).
 *
 * Hard boundaries (deliberately not crossed here):
 *  - PURE: no I/O, no decoding (Windows-1252 decoding stays at the runtime
 *    boundary), no DB, no Supabase, no UI, no upload, no clock, no randomness.
 *  - This module transitively imports `node:crypto` (through the 0H helper):
 *    it is Node-only and must NEVER be imported from a page/component or any
 *    other browser-bundled chain.
 *  - `accountFingerprint` is trusted caller input: it is never derived here and
 *    never falls back on the low-entropy masked account number. Without it
 *    there is no importId and no lineHash — fail-closed, with an explicit
 *    controlled warning and no uncontrolled throw.
 *  - `sourceRowIndex` never feeds a lineHash; genuinely identical lines are
 *    disambiguated by an occurrenceOrdinal computed over logical line groups,
 *    so physical noise rows (blanks, footnotes, balance rows) never shift a
 *    line identity.
 *  - `invalid` / `unsupported` documents never expose an importId or a
 *    lineHash; rawTextHash is still returned for traceability of the rejected
 *    text.
 *  - The decoded text, raw account number and raw CSV cells are never exposed
 *    by the result.
 *
 * DAILY-INGESTION-0C guards (pure, no DB):
 *  - BRIDGE-named files and UNKNOWN bank hints are rejected fail-closed on
 *    this ingestion path (shared guard with the 0G adapter); no importId is
 *    ever computed for such a document.
 *  - A statement period longer than MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS
 *    (inclusive day count) is never `ingestionReady`. Overlap detection
 *    against previously ingested periods requires the DB history and stays
 *    out of scope until E-2C / the period doctrine lot.
 */

import type { BankAccountStatementImportResult } from '@/types/bankAccountStatement';
import {
  parseStructuredBankStatementCsv,
  type StructuredBankStatementLine
} from './structuredBankStatementCsvParser';
import {
  buildStructuredBankStatementImportId,
  buildStructuredBankStatementLineHash,
  buildStructuredBankStatementRawTextHash,
  normalizeStructuredBankStatementDescriptionForHash
} from './structuredBankStatementCsvIdempotencyKeys';
import {
  adaptStructuredBankStatementDocumentToBankAccountStatementImportResult,
  findStructuredBankStatementIngestionGuardRejection
} from './structuredBankStatementCsvImportAdapter';

/**
 * DAILY-INGESTION-0C: maximum statement period length (inclusive day count)
 * accepted on the ingestion path. Anything longer is never `ingestionReady`.
 */
export const MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS = 45;

const DAY_IN_MS = 86_400_000;

export interface StructuredBankStatementCsvPreIngestionInput {
  /** CSV text already decoded (e.g. from Windows-1252) at the runtime boundary. */
  decodedText: string;
  /** Trusted bank identity. Never inferred from the transactional body. */
  bank: 'BDK' | 'ORA';
  sourceFileName?: string;
  /** Trimmed; absent or whitespace-only falls back to `structured_bank_statement_csv`. */
  sourceFormat?: string;
  /**
   * Trusted account fingerprint. Never derived here, never replaced by the
   * masked account number. Absent or blank: no importId and no lineHash.
   */
  accountFingerprint?: string;
  /** Forwarded to the 0G adapter; defaults to `false`. */
  includeNeedsReviewStatement?: boolean;
}

export interface StructuredBankStatementCsvPreIngestionResult {
  /** Mirrors the adapter's success unless a pre-ingestion invariant failed. */
  success: boolean;
  /**
   * True only when the adapter succeeded AND an importId was computed AND every
   * statement line carries a lineHash AND no 0C ingestion guard fired (BRIDGE /
   * UNKNOWN source, period longer than
   * MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS). This is the fail-closed
   * idempotency signal a future ingestion lot must gate on.
   */
  ingestionReady: boolean;
  /** Always computed, even for rejected documents (traceability). */
  rawTextHash: string;
  /** Present only for valid / needs_review documents with complete components. */
  importId?: string;
  /** True when every statement line was enriched with a lineHash. */
  lineHashesApplied: boolean;
  /** 0G adapter result; its statement is an enriched copy when applicable. */
  importResult: BankAccountStatementImportResult;
  /** Pre-ingestion-level errors only; the adapter's own live in importResult. */
  errors: string[];
  /** Pre-ingestion-level warnings only. */
  warnings: string[];
}

const DEFAULT_SOURCE_FORMAT = 'structured_bank_statement_csv';

export function prepareStructuredBankStatementCsvIngestion(
  input: StructuredBankStatementCsvPreIngestionInput
): StructuredBankStatementCsvPreIngestionResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawTextHash = buildStructuredBankStatementRawTextHash({ decodedText: input.decodedText });

  const document = parseStructuredBankStatementCsv(input.decodedText, {
    sourceFileName: input.sourceFileName
  });

  const status = document.validation.status;
  const accountFingerprint = normalizeOptional(input.accountFingerprint);

  // DAILY-INGESTION-0C: BRIDGE / UNKNOWN sources are never ingestable. The
  // rejection is recorded as a pre-ingestion error and no identity is ever
  // fabricated for such a document; the 0G adapter enforces the same guard on
  // its own path, so the importResult below is rejected as well.
  const ingestionGuardRejection = findStructuredBankStatementIngestionGuardRejection({
    sourceFileName: input.sourceFileName,
    bankHint: document.bankHint
  });
  if (ingestionGuardRejection !== undefined) {
    errors.push(ingestionGuardRejection);
  }

  // DAILY-INGESTION-0C: period-length guard. Only rules on a positively
  // measurable period (both dates present, strictly parseable, not reversed);
  // malformed dates stay the parser's concern (non-regression).
  const periodGuardError = buildPeriodLengthGuardError(document.periodStart, document.periodEnd);
  if (periodGuardError !== undefined) {
    errors.push(periodGuardError);
  }

  // Single normalization point: the same trimmed, defaulted sourceFormat feeds
  // both the importId and the adapter, so the statement's sourceFormat can
  // never diverge from the one hashed into the identity.
  const sourceFormat = normalizeOptional(input.sourceFormat) ?? DEFAULT_SOURCE_FORMAT;

  // importId: only for potentially ingestable statuses, and only when every
  // component is positively present. Preconditions are checked here so the 0H
  // helper's throws never become the control flow of this layer.
  let importId: string | undefined;
  if (ingestionGuardRejection !== undefined) {
    // Guard-rejected documents never receive an identity: the pre-ingestion
    // error above is the single controlled signal.
  } else if (status === 'valid' || status === 'needs_review') {
    const periodStart = normalizeOptional(document.periodStart);
    const periodEnd = normalizeOptional(document.periodEnd);

    const missing: string[] = [];
    if (accountFingerprint === undefined) {
      missing.push('accountFingerprint');
    }
    if (periodStart === undefined) {
      missing.push('periodStart');
    }
    if (periodEnd === undefined) {
      missing.push('periodEnd');
    }

    if (missing.length === 0) {
      importId = buildStructuredBankStatementImportId({
        sourceFormat,
        bank: input.bank,
        accountFingerprint: accountFingerprint as string,
        periodStart: periodStart as string,
        periodEnd: periodEnd as string
      });
    } else {
      warnings.push(
        `importId was not computed; missing or empty component(s): ${missing.join(', ')}. ` +
          'No fallback identity is ever fabricated.'
      );
    }
  } else {
    warnings.push(`importId is never computed for a "${status}" document.`);
  }

  const importResult = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    document,
    {
      bank: input.bank,
      sourceFileName: input.sourceFileName,
      sourceFormat,
      accountFingerprint,
      includeNeedsReviewStatement: input.includeNeedsReviewStatement,
      importId,
      rawTextHash
    }
  );

  const statement = importResult.statement;

  if (statement === undefined || importId === undefined) {
    if (statement !== undefined && importId === undefined) {
      warnings.push('lineHash enrichment skipped: importId is unavailable.');
    }
    return {
      success: importResult.success,
      ingestionReady: false,
      rawTextHash,
      importId,
      lineHashesApplied: false,
      importResult,
      errors,
      warnings
    };
  }

  // Alignment invariant: the 0G adapter maps document lines one-to-one, in
  // order, carrying sourceRowIndex over as sourceLineIndex. lineHashes are
  // computed from the document lines and assigned to the statement lines by
  // index, so this invariant must hold positively before any enrichment.
  const aligned =
    statement.lines.length === document.lines.length &&
    statement.lines.every(
      (line, index) => line.sourceLineIndex === document.lines[index].sourceRowIndex
    );
  if (!aligned) {
    errors.push(
      'Pre-ingestion alignment invariant broken: statement lines do not map one-to-one ' +
        'onto document lines; refusing to enrich or expose the statement.'
    );
    return buildFailClosedResult(rawTextHash, importId, importResult, errors, warnings);
  }

  let lineHashes: string[];
  try {
    lineHashes = computeLineHashes(document.lines, importId, statement.currency);
  } catch (error) {
    errors.push(
      `Pre-ingestion lineHash computation failed: ${error instanceof Error ? error.message : String(error)} ` +
        'Refusing to expose a partially hashed statement.'
    );
    return buildFailClosedResult(rawTextHash, importId, importResult, errors, warnings);
  }

  const enrichedResult: BankAccountStatementImportResult = {
    ...importResult,
    statement: {
      ...statement,
      lines: statement.lines.map((line, index) => ({ ...line, lineHash: lineHashes[index] }))
    }
  };

  // DAILY-INGESTION-0C: a fired guard forces ingestionReady to false even for
  // an otherwise fully valid, fully hashed statement.
  const ingestionBlockedByGuard =
    ingestionGuardRejection !== undefined || periodGuardError !== undefined;

  return {
    success: importResult.success,
    ingestionReady: importResult.success && !ingestionBlockedByGuard,
    rawTextHash,
    importId,
    lineHashesApplied: true,
    importResult: enrichedResult,
    errors,
    warnings
  };
}

/**
 * DAILY-INGESTION-0C: controlled error when the statement period (inclusive
 * day count between two strict DD/MM/YYYY dates) exceeds
 * MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS. Absent, unparseable or reversed
 * dates return `undefined`: the guard only rules on a positively measurable
 * period length.
 */
function buildPeriodLengthGuardError(
  periodStart: string | undefined,
  periodEnd: string | undefined
): string | undefined {
  if (periodStart === undefined || periodEnd === undefined) {
    return undefined;
  }
  const startMs = parseStrictDayMonthYearUtc(periodStart.trim());
  const endMs = parseStrictDayMonthYearUtc(periodEnd.trim());
  if (startMs === undefined || endMs === undefined || endMs < startMs) {
    return undefined;
  }
  const periodDays = Math.round((endMs - startMs) / DAY_IN_MS) + 1;
  if (periodDays <= MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS) {
    return undefined;
  }
  return (
    `Statement period spans ${periodDays} days (${periodStart.trim()} -> ${periodEnd.trim()}), ` +
    `above the ${MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS}-day ingestion limit; ` +
    'the statement is not ingestion-ready.'
  );
}

// Strict DD/MM/YYYY parsing with a calendar round-trip: "31/02/2026" is
// refused instead of silently rolling over to March.
function parseStrictDayMonthYearUtc(value: string): number | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return roundTrips ? utc : undefined;
}

/**
 * lineHashes for every document line, all-or-nothing.
 *
 * occurrenceOrdinal is assigned per logical group — the exact lineHash
 * components minus the ordinal itself — following the document line order, so
 * two genuinely identical lines get ordinals 1 and 2 while physical row
 * indices never participate.
 */
function computeLineHashes(
  lines: StructuredBankStatementLine[],
  importId: string,
  currency: string
): string[] {
  const ordinals = new Map<string, number>();

  return lines.map((line) => {
    if (line.direction !== 'debit' && line.direction !== 'credit') {
      throw new Error(`a statement line has an unmappable direction "${line.direction}".`);
    }

    const key = logicalLineKey(line, currency);
    const occurrenceOrdinal = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, occurrenceOrdinal);

    return buildStructuredBankStatementLineHash({
      importId,
      operationDate: line.operationDate ?? '',
      valueDate: line.valueDate,
      direction: line.direction,
      signedAmount: line.signedAmount,
      currency,
      descriptionSanitized: line.descriptionSanitized,
      occurrenceOrdinal
    });
  });
}

// The grouping key mirrors the 0H lineHash normalizations (trimming, NFKC/NBSP
// description folding, negative-zero collapse) so two lines that would hash
// identically always share one ordinal sequence.
function logicalLineKey(line: StructuredBankStatementLine, currency: string): string {
  const canonicalAmount = (line.signedAmount === 0 ? 0 : line.signedAmount).toString();
  return JSON.stringify([
    (line.operationDate ?? '').trim(),
    line.valueDate === undefined ? '' : line.valueDate.trim(),
    line.direction,
    canonicalAmount,
    currency.trim(),
    normalizeStructuredBankStatementDescriptionForHash(line.descriptionSanitized)
  ]);
}

function buildFailClosedResult(
  rawTextHash: string,
  importId: string | undefined,
  importResult: BankAccountStatementImportResult,
  errors: string[],
  warnings: string[]
): StructuredBankStatementCsvPreIngestionResult {
  return {
    success: false,
    ingestionReady: false,
    rawTextHash,
    importId,
    lineHashesApplied: false,
    importResult: {
      ...importResult,
      success: false,
      statement: undefined,
      rejectedReason: 'Pre-ingestion fail-closed: the statement could not be safely enriched.'
    },
    errors,
    warnings
  };
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
