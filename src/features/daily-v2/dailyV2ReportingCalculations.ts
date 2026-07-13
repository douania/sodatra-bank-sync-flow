/**
 * Pure reporting layer for Daily v2 canonical units
 * (DAILY-V2-CANONICAL-REPORTING-EXPORT-0O).
 *
 * Responsibilities, in isolation from any I/O:
 *  - strict validation of the reporting filters (bounded period, conservative
 *    bank/currency domains);
 *  - grouping of canonical units by (bank, currency, FULL account
 *    fingerprint) — the truncated public alias is display-only and is never a
 *    grouping key; an alias collision between two distinct fingerprints
 *    refuses the whole report — with every monetary total computed in bigint
 *    minor units (dailyV2Money);
 *  - fail-closed integer counters bounded by the PostgreSQL integer domain;
 *  - derivation of a SAFE result: no id, no fingerprint, no UUID, no hash, no
 *    transaction line, no actor ever leaves this module.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - browser-safe and Node-test-safe: hashing uses globalThis.crypto.subtle
 *    (Web Crypto) only — never a Node-only crypto import;
 *  - fail-closed, all-or-nothing: a single invalid amount, count or status
 *    rejects the WHOLE report with controlled errors — no partial result and
 *    no silently skipped unit;
 *  - two currencies are never merged, not even in a grand total.
 */

import {
  addDailyV2MinorUnits,
  subtractDailyV2MinorUnits,
  toDailyV2MinorUnits,
  type DailyV2MinorUnits,
} from './dailyV2Money';
import type { DailyV2ReportingUnitRow } from './dailyV2Types';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Inclusive maximum reporting window, mirrored by the contract test. */
export const MAX_DAILY_V2_REPORT_PERIOD_DAYS = 400;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_LABEL_PATTERN = /^[A-Z0-9]{1,12}$/;
const DAY_IN_MS = 86_400_000;

export interface DailyV2ReportingFiltersInput {
  startDate: string;
  endDate: string;
  bank?: string;
  currency?: string;
}

export interface DailyV2ReportingFilters {
  startDate: string;
  endDate: string;
  /** null = no filter; otherwise trimmed, uppercased, conservative charset. */
  bank: string | null;
  currency: string | null;
  inclusiveDayCount: number;
}

export type ValidateDailyV2ReportingFiltersResult =
  | { success: true; filters: DailyV2ReportingFilters }
  | { success: false; errors: string[] };

/**
 * Explicit failure guard: the repo's TypeScript config does not narrow the
 * `success: false` variant through `!result.success`, so every caller uses
 * this predicate instead of relying on control-flow narrowing.
 */
export function isDailyV2ReportingFiltersFailure(
  result: ValidateDailyV2ReportingFiltersResult,
): result is { success: false; errors: string[] } {
  return result.success === false;
}

/**
 * Strict filter validation. No fallback ever masks an invalid date: every
 * violation is reported and the whole validation fails.
 */
export function validateDailyV2ReportingFilters(
  input: DailyV2ReportingFiltersInput,
): ValidateDailyV2ReportingFiltersResult {
  const errors: string[] = [];

  const startUtc = parseStrictIsoDateUtc(input.startDate, 'startDate', errors);
  const endUtc = parseStrictIsoDateUtc(input.endDate, 'endDate', errors);

  let inclusiveDayCount = 0;
  if (startUtc !== undefined && endUtc !== undefined) {
    if (endUtc < startUtc) {
      errors.push('endDate must not be earlier than startDate.');
    } else {
      inclusiveDayCount = (endUtc - startUtc) / DAY_IN_MS + 1;
      if (inclusiveDayCount > MAX_DAILY_V2_REPORT_PERIOD_DAYS) {
        errors.push(
          `The inclusive reporting window spans ${inclusiveDayCount} days, above the ` +
            `${MAX_DAILY_V2_REPORT_PERIOD_DAYS}-day limit.`,
        );
      }
    }
  }

  const bank = normalizeOptionalFilterLabel(input.bank, 'bank', errors);
  const currency = normalizeOptionalFilterLabel(input.currency, 'currency', errors);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    filters: {
      startDate: input.startDate.trim(),
      endDate: input.endDate.trim(),
      bank,
      currency,
      inclusiveDayCount,
    },
  };
}

function parseStrictIsoDateUtc(
  value: string | undefined,
  label: string,
  errors: string[],
): number | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!ISO_DATE_PATTERN.test(trimmed)) {
    errors.push(`${label} is required and must be a strict YYYY-MM-DD date.`);
    return undefined;
  }
  const year = parseInt(trimmed.slice(0, 4), 10);
  const month = parseInt(trimmed.slice(5, 7), 10);
  const day = parseInt(trimmed.slice(8, 10), 10);
  const utc = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utc);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    errors.push(`${label} must be a real calendar date (fail-closed).`);
    return undefined;
  }
  return utc;
}

function normalizeOptionalFilterLabel(
  value: string | undefined,
  label: string,
  errors: string[],
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === '') {
    return null;
  }
  if (!FILTER_LABEL_PATTERN.test(normalized)) {
    errors.push(`${label} filter must match ${String(FILTER_LABEL_PATTERN)} once trimmed and uppercased.`);
    return null;
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Non-sensitive account alias (Web Crypto only)
// ---------------------------------------------------------------------------

const ACCOUNT_ALIAS_PREIMAGE_PREFIX = 'daily-v2-report-alias-v1|';

/**
 * Local, non-persisted alias for one account fingerprint:
 * `C-<16 lowercase hex>` — the first 8 bytes of
 * SHA-256("daily-v2-report-alias-v1|<fingerprint>") — via Web Crypto only.
 * The fingerprint itself never leaves the internal computation.
 */
export async function buildDailyV2ReportAccountAlias(
  accountFingerprint: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('WEB_CRYPTO_UNAVAILABLE_FAIL_CLOSED');
  }
  const bytes = new TextEncoder().encode(
    `${ACCOUNT_ALIAS_PREIMAGE_PREFIX}${accountFingerprint}`,
  );
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let index = 0; index < 8; index++) {
    hex += digest[index].toString(16).padStart(2, '0');
  }
  return `C-${hex}`;
}

/** Alias derivation seam — production always injects the SHA-256 builder. */
type DailyV2ReportAliasBuilder = (accountFingerprint: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Safe aggregation
// ---------------------------------------------------------------------------

export interface DailyV2ReportingGroupSummary {
  bank: string;
  currency: string;
  accountAlias: string;
  firstAccountingDate: string;
  lastAccountingDate: string;
  dayCount: number;
  lineCount: number;
  totalDebitsMinor: DailyV2MinorUnits;
  totalCreditsMinor: DailyV2MinorUnits;
  netFlowMinor: DailyV2MinorUnits;
  firstOpeningBalanceMinor: DailyV2MinorUnits | null;
  lastClosingBalanceMinor: DailyV2MinorUnits | null;
  needsReviewDayCount: number;
  unavailableAggregatesDayCount: number;
}

export interface DailyV2ReportingCurrencySummary {
  currency: string;
  groupCount: number;
  dayCount: number;
  lineCount: number;
  totalDebitsMinor: DailyV2MinorUnits;
  totalCreditsMinor: DailyV2MinorUnits;
  netFlowMinor: DailyV2MinorUnits;
}

/** Safe, non-sensitive failure codes for the whole-report rejection paths. */
export type DailyV2ReportingSummariesSafeCode =
  | 'REPORT_ACCOUNT_ALIAS_COLLISION'
  | 'REPORT_AMOUNTS_UNSAFE'
  | 'REPORT_COUNT_UNSAFE'
  | 'REPORT_INPUT_INVALID';

export type BuildDailyV2ReportingSummariesResult =
  | {
      success: true;
      groups: DailyV2ReportingGroupSummary[];
      currencySummaries: DailyV2ReportingCurrencySummary[];
    }
  | {
      success: false;
      safeCode: DailyV2ReportingSummariesSafeCode;
      errors: string[];
    };

/** Explicit failure guard — same rationale as the filters guard above. */
export function isDailyV2ReportingSummariesFailure(
  result: BuildDailyV2ReportingSummariesResult,
): result is {
  success: false;
  safeCode: DailyV2ReportingSummariesSafeCode;
  errors: string[];
} {
  return result.success === false;
}

/** Upper bound of a PostgreSQL `integer` column (source of line_count). */
const POSTGRES_INTEGER_MAX = 2_147_483_647;

const DAILY_V2_COUNT_UNSAFE_ERROR = 'REPORT_COUNT_UNSAFE';

/**
 * Fail-closed counter addition: both operands and the result must be
 * non-negative safe integers. Any violation refuses the whole report with
 * REPORT_COUNT_UNSAFE — no counter is ever silently wrapped or truncated.
 */
export function addDailyV2SafeCount(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0
  ) {
    throw new Error(DAILY_V2_COUNT_UNSAFE_ERROR);
  }
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(DAILY_V2_COUNT_UNSAFE_ERROR);
  }
  return result;
}

function classifyAggregationSafeCode(
  message: string,
): 'REPORT_COUNT_UNSAFE' | 'REPORT_AMOUNTS_UNSAFE' {
  return message === DAILY_V2_COUNT_UNSAFE_ERROR
    ? 'REPORT_COUNT_UNSAFE'
    : 'REPORT_AMOUNTS_UNSAFE';
}

/**
 * Production entry point: group canonical units and derive exact bigint
 * totals, with the real SHA-256 alias builder. All-or-nothing: any invalid
 * unit rejects the whole report.
 */
export async function buildDailyV2ReportingSummaries(
  units: readonly DailyV2ReportingUnitRow[],
): Promise<BuildDailyV2ReportingSummariesResult> {
  return buildDailyV2ReportingSummariesWithAliasBuilder(
    units,
    buildDailyV2ReportAccountAlias,
  );
}

/**
 * Injectable-alias variant, exported ONLY so synthetic tests can exercise the
 * alias-collision refusal deterministically (a real SHA-256 64-bit prefix
 * collision is not constructible in tests). Never used by the UI or the
 * PostgREST service layer — the production path above always injects the
 * real SHA-256 builder.
 */
export async function buildDailyV2ReportingSummariesWithAliasBuilder(
  units: readonly DailyV2ReportingUnitRow[],
  buildAlias: DailyV2ReportAliasBuilder,
): Promise<BuildDailyV2ReportingSummariesResult> {
  const errors: string[] = [];

  units.forEach((unit, index) => {
    const label = `units[${index}]`;
    if (typeof unit.bank !== 'string' || unit.bank.trim() === '') {
      errors.push(`${label}.bank must be a non-empty string.`);
    }
    if (typeof unit.currency !== 'string' || unit.currency.trim() === '') {
      errors.push(`${label}.currency must be a non-empty string.`);
    }
    if (
      typeof unit.account_fingerprint !== 'string' ||
      unit.account_fingerprint.trim() === ''
    ) {
      errors.push(`${label}.account_fingerprint must be a non-empty string.`);
    }
    if (typeof unit.accounting_date !== 'string' || !ISO_DATE_PATTERN.test(unit.accounting_date)) {
      errors.push(`${label}.accounting_date must be a strict YYYY-MM-DD date.`);
    }
    if (
      !Number.isInteger(unit.line_count) ||
      unit.line_count < 1 ||
      unit.line_count > POSTGRES_INTEGER_MAX
    ) {
      errors.push(
        `${label}.line_count must be an integer >= 1 within the PostgreSQL integer range ` +
          '(DB constraint line_count >= 1).',
      );
    }
    if (unit.validation_status !== 'valid' && unit.validation_status !== 'needs_review') {
      errors.push(`${label}.validation_status "${String(unit.validation_status)}" is outside the frozen domain.`);
    }
    if (unit.aggregates_status !== 'derived' && unit.aggregates_status !== 'unavailable') {
      errors.push(`${label}.aggregates_status "${String(unit.aggregates_status)}" is outside the frozen domain.`);
    }
  });

  if (errors.length > 0) {
    return { success: false, safeCode: 'REPORT_INPUT_INVALID', errors };
  }

  // Alias every fingerprint once, with the inverse map kept in memory to
  // detect collisions: two distinct fingerprints deriving the same public
  // alias must never merge — the whole report is refused. The raw
  // fingerprints stay local to these maps and never reach an error message.
  const aliasByFingerprint = new Map<string, string>();
  const fingerprintByAlias = new Map<string, string>();
  for (const unit of units) {
    if (aliasByFingerprint.has(unit.account_fingerprint)) {
      continue;
    }
    const alias = await buildAlias(unit.account_fingerprint);
    const existingFingerprint = fingerprintByAlias.get(alias);
    if (
      existingFingerprint !== undefined &&
      existingFingerprint !== unit.account_fingerprint
    ) {
      return {
        success: false,
        safeCode: 'REPORT_ACCOUNT_ALIAS_COLLISION',
        errors: [
          `reporting alias collision detected on ${alias}: two distinct accounts ` +
            'would merge under the same public alias. The whole report is refused (fail-closed).',
        ],
      };
    }
    aliasByFingerprint.set(unit.account_fingerprint, alias);
    fingerprintByAlias.set(alias, unit.account_fingerprint);
  }

  // Group by (bank, currency, FULL fingerprint) — never by the truncated
  // alias, which is display-only.
  const groupsByKey = new Map<string, DailyV2ReportingUnitRow[]>();
  for (const unit of units) {
    const key = JSON.stringify([unit.bank, unit.currency, unit.account_fingerprint]);
    const bucket = groupsByKey.get(key) ?? [];
    bucket.push(unit);
    groupsByKey.set(key, bucket);
  }

  const groups: DailyV2ReportingGroupSummary[] = [];

  for (const bucket of groupsByKey.values()) {
    const chronological = [...bucket].sort(
      (a, b) =>
        a.accounting_date.localeCompare(b.accounting_date) ||
        a.ingested_at.localeCompare(b.ingested_at),
    );
    const first = chronological[0];
    const alias = aliasByFingerprint.get(first.account_fingerprint) as string;

    try {
      const debits = chronological.map((unit) => toDailyV2MinorUnits(unit.day_total_debits));
      const credits = chronological.map((unit) => toDailyV2MinorUnits(unit.day_total_credits));

      let firstOpening: DailyV2MinorUnits | null = null;
      let lastClosing: DailyV2MinorUnits | null = null;
      for (const unit of chronological) {
        if (firstOpening === null && unit.opening_balance_derived !== null) {
          firstOpening = toDailyV2MinorUnits(unit.opening_balance_derived);
        }
        if (unit.closing_balance_derived !== null) {
          lastClosing = toDailyV2MinorUnits(unit.closing_balance_derived);
        }
      }

      const totalDebitsMinor = addDailyV2MinorUnits(debits);
      const totalCreditsMinor = addDailyV2MinorUnits(credits);

      groups.push({
        bank: first.bank,
        currency: first.currency,
        accountAlias: alias,
        firstAccountingDate: chronological[0].accounting_date,
        lastAccountingDate: chronological[chronological.length - 1].accounting_date,
        dayCount: chronological.length,
        lineCount: chronological.reduce(
          (total, unit) => addDailyV2SafeCount(total, unit.line_count),
          0,
        ),
        totalDebitsMinor,
        totalCreditsMinor,
        netFlowMinor: subtractDailyV2MinorUnits(totalCreditsMinor, totalDebitsMinor),
        firstOpeningBalanceMinor: firstOpening,
        lastClosingBalanceMinor: lastClosing,
        needsReviewDayCount: chronological.filter(
          (unit) => unit.validation_status === 'needs_review',
        ).length,
        unavailableAggregatesDayCount: chronological.filter(
          (unit) => unit.aggregates_status === 'unavailable',
        ).length,
      });
    } catch (error) {
      // One unconvertible amount or unsafe counter rejects the WHOLE report
      // (all-or-nothing).
      const message = error instanceof Error ? error.message : 'controlled failure';
      return {
        success: false,
        safeCode: classifyAggregationSafeCode(message),
        errors: [
          `reporting aggregation failed on group ${alias}: ${message}. No partial report is produced.`,
        ],
      };
    }
  }

  groups.sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      a.bank.localeCompare(b.bank) ||
      a.accountAlias.localeCompare(b.accountAlias),
  );

  const currencySummaries: DailyV2ReportingCurrencySummary[] = [];
  try {
    for (const group of groups) {
      let summary = currencySummaries.find((entry) => entry.currency === group.currency);
      if (summary === undefined) {
        summary = {
          currency: group.currency,
          groupCount: 0,
          dayCount: 0,
          lineCount: 0,
          totalDebitsMinor: 0n,
          totalCreditsMinor: 0n,
          netFlowMinor: 0n,
        };
        currencySummaries.push(summary);
      }
      summary.groupCount = addDailyV2SafeCount(summary.groupCount, 1);
      summary.dayCount = addDailyV2SafeCount(summary.dayCount, group.dayCount);
      summary.lineCount = addDailyV2SafeCount(summary.lineCount, group.lineCount);
      summary.totalDebitsMinor = addDailyV2MinorUnits([
        summary.totalDebitsMinor,
        group.totalDebitsMinor,
      ]);
      summary.totalCreditsMinor = addDailyV2MinorUnits([
        summary.totalCreditsMinor,
        group.totalCreditsMinor,
      ]);
      summary.netFlowMinor = subtractDailyV2MinorUnits(
        summary.totalCreditsMinor,
        summary.totalDebitsMinor,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'controlled failure';
    return {
      success: false,
      safeCode: classifyAggregationSafeCode(message),
      errors: [
        `reporting currency summary aggregation failed: ${message}. No partial report is produced.`,
      ],
    };
  }

  return { success: true, groups, currencySummaries };
}
