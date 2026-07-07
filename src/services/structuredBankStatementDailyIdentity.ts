/**
 * Daily canonical identity layer for structured bank statement CSV exports
 * (PERIOD-IDENTITY-V2-0E).
 *
 * Doctrine CTO (DOCTRINE-PERIOD-0D, acted):
 *  - the canonical unit is (bank, accountFingerprint, currency, accountingDate)
 *    with accountingDate = operationDate — NEVER valueDate, which stays a line
 *    attribute and a hash component but is never a split key;
 *  - a multi-day export is split into one daily unit per accounting day, each
 *    carrying a period-independent `dayUnitId` (v2) so two overlapping sliding
 *    exports produce the SAME identity for a common day;
 *  - every line carries a `dailyLineHash` (v2) scoped to its daily unit, with
 *    a `dailyOccurrenceOrdinal` computed PER ACCOUNTING DAY over logical line
 *    groups — never per export, never from sourceRowIndex;
 *  - the export attempt metadata (sourceFileName, rawTextHash, export
 *    periodStart/periodEnd) is kept for TRACEABILITY ONLY on each unit: it
 *    never feeds any v2 identity.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - PURE: no I/O, no decoding, no DB, no Supabase, no RPC, no UI, no clock,
 *    no randomness. This is an identity layer, nothing else.
 *  - NODE-ONLY: it transitively imports `node:crypto` through the 0H helper;
 *    it must NEVER be imported from a page/component or any browser-bundled
 *    chain. The v2 hash builders themselves have browser twins in
 *    `structuredBankStatementCsvBrowserIdempotencyKeys.ts` for a future
 *    browser composition lot.
 *  - NO INGESTION SIGNAL: a daily unit exposes no `ingestionReady`, no
 *    promotability flag and no RPC payload. Splitting an export NEVER bypasses
 *    the 0C guards (BRIDGE/UNKNOWN, 45-day period cap): those stay enforced by
 *    the pre-ingestion layer on the whole export. ORA non-closed-day rules and
 *    BIS backfill live in future lots, not here.
 *  - Fail-closed, all-or-nothing: a single line without a strictly parseable
 *    operationDate, or with an unmappable direction, rejects the WHOLE
 *    composition with controlled errors — no partial unit list is ever
 *    returned and nothing throws for bad business input.
 */

import type {
  StructuredBankStatementDocument,
  StructuredBankStatementLine
} from './structuredBankStatementCsvParser';
import {
  buildStructuredBankStatementDayUnitId,
  buildStructuredBankStatementDailyLineHash,
  normalizeStructuredBankStatementDescriptionForHash
} from './structuredBankStatementCsvIdempotencyKeys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One accounting day worth of parser lines, in document order. */
export interface StructuredBankStatementAccountingDayGroup {
  /** Strict DD/MM/YYYY accounting date (= operationDate, doctrine 0D). */
  accountingDate: string;
  lines: StructuredBankStatementLine[];
}

export type GroupStructuredBankStatementLinesByAccountingDateResult =
  | { success: true; groups: StructuredBankStatementAccountingDayGroup[] }
  | { success: false; errors: string[] };

/** Traceability-only metadata of the export that carried a daily unit. */
export interface StructuredBankStatementDailyUnitSource {
  sourceFileName?: string;
  rawTextHash?: string;
  exportPeriodStart?: string;
  exportPeriodEnd?: string;
}

/** One line of a daily unit, enriched with its v2 identity. */
export interface StructuredBankStatementDailyLine {
  /** Physical traceability only — never feeds any hash. */
  sourceRowIndex: number;
  /** Equals the unit's accountingDate by construction. */
  accountingDate: string;
  valueDate?: string;
  direction: 'debit' | 'credit';
  signedAmount: number;
  currency: string;
  descriptionSanitized: string;
  dailyOccurrenceOrdinal: number;
  dailyLineHash: string;
}

/** One canonical daily unit produced by splitting an export. */
export interface StructuredBankStatementDailyUnit {
  bank: string;
  accountFingerprint: string;
  currency: string;
  accountingDate: string;
  dayUnitId: string;
  source: StructuredBankStatementDailyUnitSource;
  lines: StructuredBankStatementDailyLine[];
}

export interface BuildDailyStatementUnitsFromStructuredDocumentInput {
  /** Parsed document; its lines are split, its period is traceability only. */
  document: StructuredBankStatementDocument;
  /** Trusted bank identity. Never inferred from the transactional body. */
  bank: 'BDK' | 'ORA' | string;
  /** Trusted account fingerprint. Never derived here, no masked fallback. */
  accountFingerprint: string;
  /** Trusted currency. Never inferred here. */
  currency: string;
  /** Optional traceability fingerprint of the decoded export text. */
  rawTextHash?: string;
}

export type BuildDailyStatementUnitsFromStructuredDocumentResult =
  | { success: true; units: StructuredBankStatementDailyUnit[] }
  | { success: false; errors: string[] };

// ---------------------------------------------------------------------------
// Grouping by accounting date
// ---------------------------------------------------------------------------

// Strict DD/MM/YYYY with calendar round-trip, mirroring the 0C guard's rule:
// "31/02/2026" is refused instead of silently rolling over to March.
const STRICT_DAY_MONTH_YEAR_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function parseStrictDayMonthYearUtc(value: string): number | undefined {
  const match = STRICT_DAY_MONTH_YEAR_PATTERN.exec(value);
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
 * Split parser lines into accounting-day groups keyed by operationDate.
 *
 * All-or-nothing and fail-closed: a line with an absent, blank or non-strict
 * operationDate rejects the whole grouping with a controlled error — the
 * accounting date is the canonical split key and is never guessed, defaulted
 * or borrowed from valueDate. Groups come back in chronological order; lines
 * keep their document order within each group.
 */
export function groupStructuredBankStatementLinesByAccountingDate(
  lines: StructuredBankStatementLine[]
): GroupStructuredBankStatementLinesByAccountingDateResult {
  const errors: string[] = [];
  const groupsByDate = new Map<string, { utc: number; lines: StructuredBankStatementLine[] }>();

  lines.forEach((line, index) => {
    const operationDate = typeof line.operationDate === 'string' ? line.operationDate.trim() : '';
    if (operationDate === '') {
      errors.push(
        `lines[${index}] (sourceRowIndex ${line.sourceRowIndex}): operationDate is missing or empty; ` +
          'the accounting date is never guessed or borrowed from valueDate (fail-closed).'
      );
      return;
    }
    const utc = parseStrictDayMonthYearUtc(operationDate);
    if (utc === undefined) {
      errors.push(
        `lines[${index}] (sourceRowIndex ${line.sourceRowIndex}): operationDate "${operationDate}" ` +
          'is not a strict DD/MM/YYYY calendar date (fail-closed).'
      );
      return;
    }
    const existing = groupsByDate.get(operationDate);
    if (existing !== undefined) {
      existing.lines.push(line);
    } else {
      groupsByDate.set(operationDate, { utc, lines: [line] });
    }
  });

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const groups = Array.from(groupsByDate.entries())
    .sort((a, b) => a[1].utc - b[1].utc)
    .map(([accountingDate, entry]) => ({ accountingDate, lines: entry.lines }));

  return { success: true, groups };
}

// ---------------------------------------------------------------------------
// Daily occurrence ordinals
// ---------------------------------------------------------------------------

/**
 * Assign occurrence ordinals over logical line groups, per accounting day.
 *
 * The grouping key mirrors the v2 dailyLineHash components minus the ordinal
 * itself (operationDate, valueDate, direction, canonical amount, currency,
 * normalized description), so two lines that would hash identically always
 * share one ordinal sequence. operationDate is part of the key defensively:
 * even if a caller passes a multi-day slice, sequences stay per-day (doctrine
 * 0D rule 6). Returned ordinals are positional (ordinals[i] belongs to
 * lines[i]) and start at 1 in document order. sourceRowIndex never plays.
 */
export function assignDailyOccurrenceOrdinals(
  lines: StructuredBankStatementLine[],
  currency: string
): number[] {
  const ordinals = new Map<string, number>();

  return lines.map((line) => {
    const canonicalAmount = (line.signedAmount === 0 ? 0 : line.signedAmount).toString();
    const key = JSON.stringify([
      (line.operationDate ?? '').trim(),
      line.valueDate === undefined ? '' : line.valueDate.trim(),
      line.direction,
      canonicalAmount,
      currency.trim(),
      normalizeStructuredBankStatementDescriptionForHash(line.descriptionSanitized)
    ]);
    const ordinal = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, ordinal);
    return ordinal;
  });
}

// ---------------------------------------------------------------------------
// Composition: export document -> daily units
// ---------------------------------------------------------------------------

/**
 * Split a parsed export into canonical daily units carrying v2 identities.
 *
 * Identity layer ONLY: the result exposes no ingestion signal, no RPC payload
 * and no promotability flag — the 0C guards on the whole export (BRIDGE /
 * UNKNOWN / 45-day cap) remain the pre-ingestion layer's exclusive concern
 * and are NOT re-evaluated nor bypassed here. Fail-closed, all-or-nothing:
 * any invalid line rejects the whole composition with controlled errors.
 */
export function buildDailyStatementUnitsFromStructuredDocument(
  input: BuildDailyStatementUnitsFromStructuredDocumentInput
): BuildDailyStatementUnitsFromStructuredDocumentResult {
  const errors: string[] = [];

  const bank = trimToEmpty(input.bank);
  if (bank === '') {
    errors.push('bank is required and must be non-empty.');
  }
  const accountFingerprint = trimToEmpty(input.accountFingerprint);
  if (accountFingerprint === '') {
    errors.push(
      'accountFingerprint is required and must be non-empty; ' +
        'refusing to fall back on the masked account number.'
    );
  }
  const currency = trimToEmpty(input.currency);
  if (currency === '') {
    errors.push('currency is required and must be non-empty.');
  }

  const document = input.document;
  if (document === null || typeof document !== 'object' || !Array.isArray(document.lines)) {
    errors.push('document with a lines array is required.');
    return { success: false, errors };
  }

  document.lines.forEach((line, index) => {
    if (line.direction !== 'debit' && line.direction !== 'credit') {
      errors.push(
        `lines[${index}] (sourceRowIndex ${line.sourceRowIndex}): direction "${String(
          line.direction
        )}" is not mappable to debit/credit (fail-closed).`
      );
    }
  });

  const grouping = groupStructuredBankStatementLinesByAccountingDate(document.lines);
  if (!grouping.success) {
    errors.push(...grouping.errors);
  }

  if (errors.length > 0 || !grouping.success) {
    return { success: false, errors };
  }

  // Traceability-only export metadata, shared by every unit of this export.
  const source: StructuredBankStatementDailyUnitSource = {
    sourceFileName: trimToUndefined(document.sourceFileName),
    rawTextHash: trimToUndefined(input.rawTextHash),
    exportPeriodStart: trimToUndefined(document.periodStart),
    exportPeriodEnd: trimToUndefined(document.periodEnd)
  };

  let units: StructuredBankStatementDailyUnit[];
  try {
    units = grouping.groups.map((group) => {
      const dayUnitId = buildStructuredBankStatementDayUnitId({
        bank,
        accountFingerprint,
        currency,
        accountingDate: group.accountingDate
      });

      // Ordinals are computed on the DAY's lines only (doctrine 0D rule 6).
      const ordinals = assignDailyOccurrenceOrdinals(group.lines, currency);

      const lines = group.lines.map((line, index) => {
        const dailyLineHash = buildStructuredBankStatementDailyLineHash({
          dayUnitId,
          valueDate: line.valueDate,
          direction: line.direction as 'debit' | 'credit',
          signedAmount: line.signedAmount,
          currency,
          descriptionSanitized: line.descriptionSanitized,
          dailyOccurrenceOrdinal: ordinals[index]
        });

        return {
          sourceRowIndex: line.sourceRowIndex,
          accountingDate: group.accountingDate,
          valueDate: line.valueDate,
          direction: line.direction as 'debit' | 'credit',
          signedAmount: line.signedAmount,
          currency,
          descriptionSanitized: line.descriptionSanitized,
          dailyOccurrenceOrdinal: ordinals[index],
          dailyLineHash
        };
      });

      return {
        bank,
        accountFingerprint,
        currency,
        accountingDate: group.accountingDate,
        dayUnitId,
        source,
        lines
      };
    });
  } catch (error) {
    // The 0H builders throw only on inputs already screened above; this path
    // converts any residual throw into a controlled, all-or-nothing rejection.
    return {
      success: false,
      errors: [
        `daily identity computation failed: ${error instanceof Error ? error.message : String(error)} ` +
          'Refusing to expose a partially identified unit list.'
      ]
    };
  }

  return { success: true, units };
}

function trimToEmpty(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
