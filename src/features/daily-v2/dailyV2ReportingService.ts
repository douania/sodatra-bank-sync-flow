/**
 * Safe reporting orchestration for Daily v2
 * (DAILY-V2-CANONICAL-REPORTING-EXPORT-0O).
 *
 * Pipeline, in this exact order:
 *  1. strict filter validation (bounded period, conservative labels);
 *  2. bounded canonical read reserved for reporting (status 'ingested' only,
 *     absolute ceiling, no lines, no staging, no RPC);
 *  3. immediate bigint aggregation into a SAFE report.
 *
 * The raw rows (id, account_fingerprint) live only inside this function call:
 * they are never returned, never cached, never put in any React state and
 * never persisted (no localStorage). The exposed report carries aggregated,
 * alias-based lines only.
 */

import {
  buildDailyV2ReportingSummaries,
  isDailyV2ReportingFiltersFailure,
  isDailyV2ReportingSummariesFailure,
  validateDailyV2ReportingFilters,
  type DailyV2ReportingCurrencySummary,
  type DailyV2ReportingFilters,
  type DailyV2ReportingFiltersInput,
  type DailyV2ReportingGroupSummary,
} from './dailyV2ReportingCalculations';
import {
  DailyV2ServiceError,
  listDailyV2CanonicalUnitsForReporting,
} from './dailyV2SupabaseService';

export interface DailyV2SafeReport {
  filters: DailyV2ReportingFilters;
  groups: DailyV2ReportingGroupSummary[];
  currencySummaries: DailyV2ReportingCurrencySummary[];
  /** Number of canonical units aggregated into this report. */
  sourceUnitCount: number;
  /** Non-sensitive generation timestamp (ISO 8601, UTC). */
  generatedAt: string;
}

/**
 * Generate the safe Daily v2 report. Throws a `DailyV2ServiceError` with a
 * non-sensitive message/code on any violated gate; never returns a partial
 * report.
 */
export async function generateDailyV2Report(
  input: DailyV2ReportingFiltersInput,
): Promise<DailyV2SafeReport> {
  const validation = validateDailyV2ReportingFilters(input);
  if (isDailyV2ReportingFiltersFailure(validation)) {
    throw new DailyV2ServiceError(validation.errors.join(' '), 'REPORT_FILTERS_INVALID');
  }
  const filters = validation.filters;

  const { rows, totalCount } = await listDailyV2CanonicalUnitsForReporting({
    startDate: filters.startDate,
    endDate: filters.endDate,
    bank: filters.bank,
    currency: filters.currency,
  });

  const summaries = await buildDailyV2ReportingSummaries(rows);
  if (isDailyV2ReportingSummariesFailure(summaries)) {
    // Propagate the aggregation-layer safe code (alias collision, unsafe
    // amount, unsafe counter, invalid input) without exposing any fingerprint.
    throw new DailyV2ServiceError(summaries.errors.join(' '), summaries.safeCode);
  }

  return {
    filters,
    groups: summaries.groups,
    currencySummaries: summaries.currencySummaries,
    sourceUnitCount: totalCount,
    generatedAt: new Date().toISOString(),
  };
}
