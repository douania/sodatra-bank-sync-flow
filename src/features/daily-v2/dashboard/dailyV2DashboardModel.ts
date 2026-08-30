import { z } from 'zod';
import { addDailyV2MinorUnits, toDailyV2MinorUnits } from '../dailyV2Money';
import {
  addDailyV2SafeCount, buildDailyV2ReportAccountAlias,
  isDailyV2ReportingFiltersFailure, validateDailyV2ReportingFilters,
  MAX_DAILY_V2_REPORT_PERIOD_DAYS,
} from '../dailyV2ReportingCalculations';
import { DAILY_V2_REPORTING_MAX_UNITS, DailyV2ServiceError } from '../dailyV2ReportingReadCore';
import type { DailyV2ReportingReadFilters } from '../dailyV2ReportingReadCore';

const DAY_MS = 86_400_000;
export const DASHBOARD_POSITION_LOOKBACK_DAYS = 400;
export interface DashboardInput {
  asOfDate: string;
  flowStartDate: string;
  bank?: string;
  currency?: string;
}
export interface DashboardPlan {
  asOfDate: string;
  flowStartDate: string;
  periodDays: number;
  read: DailyV2ReportingReadFilters;
}
export interface DashboardAccount {
  bank: string;
  currency: string;
  accountAlias: string;
  lastStatementDate: string;
  ageDays: number;
  closingMinor: bigint | null;
  positionUnavailable: boolean;
  observedDays: number;
  unobservedCalendarDays: number;
  lineCount: number;
  debitsMinor: bigint | null;
  creditsMinor: bigint | null;
  netMinor: bigint | null;
  reviewDays: number;
  unavailableDays: number;
}
export interface DashboardCurrency {
  currency: string;
  accountCount: number;
  knownPositionCount: number;
  olderStatementCount: number;
  oldestStatementDate: string;
  newestStatementDate: string;
  observedAccountDays: number;
  possibleAccountDays: number;
  debitsMinor: bigint | null;
  creditsMinor: bigint | null;
  netMinor: bigint | null;
}
export interface DashboardSnapshot {
  plan: DashboardPlan;
  generatedAt: string;
  sourceUnitCount: number;
  accounts: DashboardAccount[];
  currencies: DashboardCurrency[];
}

function refuse(code: string): never {
  throw new DailyV2ServiceError('Vue Daily v2 indisponible : aucun résultat partiel.', code);
}
function calendarDate(value: string): boolean {
  return value.length === 10 && !isDailyV2ReportingFiltersFailure(validateDailyV2ReportingFilters({ startDate: value, endDate: value }));
}
export function planDashboardRead(input: DashboardInput): DashboardPlan {
  if (DASHBOARD_POSITION_LOOKBACK_DAYS > MAX_DAILY_V2_REPORT_PERIOD_DAYS) refuse('DASHBOARD_POSITION_WINDOW_UNSUPPORTED');
  const period = validateDailyV2ReportingFilters({
    startDate: input.flowStartDate, endDate: input.asOfDate,
    bank: input.bank, currency: input.currency,
  });
  if (isDailyV2ReportingFiltersFailure(period)) refuse('DASHBOARD_FILTERS_INVALID');
  const { startDate, endDate, bank, currency, inclusiveDayCount } = period.filters;
  const lookupStart = new Date(Date.parse(`${endDate}T00:00:00Z`) - (DASHBOARD_POSITION_LOOKBACK_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  if (!calendarDate(lookupStart)) refuse('DASHBOARD_FILTERS_INVALID');
  return {
    asOfDate: endDate, flowStartDate: startDate, periodDays: inclusiveDayCount,
    read: { startDate: lookupStart, endDate, bank, currency },
  };
}

// Revalidate the narrow projection defensively. No staging/status/actor fields
// accepted here; the guarded snapshot reader alone selects active canonical units.
const rowSchema = z.strictObject({
  id: z.string().uuid(),
  accounting_date: z.string().refine(calendarDate),
  bank: z.string().regex(/^[A-Z0-9]{1,12}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  account_fingerprint: z.string().min(1).max(200),
  line_count: z.number().int().min(1).max(2_147_483_647),
  day_total_debits: z.number().finite().nonnegative(),
  day_total_credits: z.number().finite().nonnegative(),
  opening_balance_derived: z.number().finite().nullable(),
  closing_balance_derived: z.number().finite().nullable(),
  aggregates_status: z.enum(['derived', 'unavailable']),
  validation_status: z.enum(['valid', 'needs_review']),
  ingested_at: z.string().min(1).max(40).refine((value) => Number.isFinite(Date.parse(value))),
});

export async function buildDashboardSnapshot(
  input: DashboardInput, rows: unknown, totalCount: number, generatedAt: string,
): Promise<DashboardSnapshot> {
  return buildDashboardSnapshotWithAlias(input, rows, totalCount, generatedAt, buildDailyV2ReportAccountAlias);
}

/** Test seam only; the service always uses the real collision-checked alias builder. */
export async function buildDashboardSnapshotWithAlias(
  input: DashboardInput, rows: unknown, totalCount: number, generatedAt: string,
  aliasBuilder: (fingerprint: string) => Promise<string>,
): Promise<DashboardSnapshot> {
  const plan = planDashboardRead(input);
  const parsed = z.array(rowSchema).max(DAILY_V2_REPORTING_MAX_UNITS).safeParse(rows);
  if (!parsed.success || !Number.isSafeInteger(totalCount) || totalCount < 0 ||
      totalCount !== parsed.data.length || !Number.isFinite(Date.parse(generatedAt))) {
    refuse('DASHBOARD_RESPONSE_INVALID');
  }
  const seenIds = new Set<string>();
  const seenDays = new Set<string>();
  const buckets = new Map<string, typeof parsed.data>();
  const aliases = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const row of parsed.data) {
    if (row.accounting_date < plan.read.startDate || row.accounting_date > plan.asOfDate ||
        (plan.read.bank !== null && row.bank !== plan.read.bank) ||
        (plan.read.currency !== null && row.currency !== plan.read.currency)) refuse('DASHBOARD_RESPONSE_INVALID');
    const key = JSON.stringify([row.bank, row.currency, row.account_fingerprint]);
    const dayKey = JSON.stringify([key, row.accounting_date]);
    if (seenIds.has(row.id) || seenDays.has(dayKey)) refuse('DASHBOARD_DUPLICATE_UNIT');
    seenIds.add(row.id); seenDays.add(dayKey);
    try {
      // Validate even older/unavailable amounts: no malformed row is silently skipped.
      toDailyV2MinorUnits(row.day_total_debits); toDailyV2MinorUnits(row.day_total_credits);
      if (row.opening_balance_derived !== null) toDailyV2MinorUnits(row.opening_balance_derived);
      if (row.closing_balance_derived !== null) toDailyV2MinorUnits(row.closing_balance_derived);
    } catch { refuse('DASHBOARD_AMOUNTS_UNSAFE'); }
    if (!aliases.has(row.account_fingerprint)) {
      const alias = await aliasBuilder(row.account_fingerprint);
      if (!/^C-[a-f0-9]{16}$/.test(alias)) refuse('DASHBOARD_ALIAS_INVALID');
      const owner = owners.get(alias);
      if (owner !== undefined && owner !== row.account_fingerprint) refuse('DASHBOARD_ALIAS_COLLISION');
      owners.set(alias, row.account_fingerprint); aliases.set(row.account_fingerprint, alias);
    }
    const bucket = buckets.get(key) ?? [];
    bucket.push(row); buckets.set(key, bucket);
  }
  const accounts: DashboardAccount[] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.accounting_date.localeCompare(b.accounting_date));
    const latest = bucket[bucket.length - 1];
    const period = bucket.filter((row) => row.accounting_date >= plan.flowStartDate);
    const reviewDays = period.filter((row) => row.validation_status !== 'valid').length;
    const unavailableDays = period.filter((row) => row.aggregates_status !== 'derived').length;
    const flowKnown = period.length > 0 && reviewDays === 0 && unavailableDays === 0;
    const positionKnown = latest.validation_status === 'valid' && latest.aggregates_status === 'derived' && latest.closing_balance_derived !== null;
    const debitsMinor = flowKnown ? addDailyV2MinorUnits(period.map((row) => toDailyV2MinorUnits(row.day_total_debits))) : null;
    const creditsMinor = flowKnown ? addDailyV2MinorUnits(period.map((row) => toDailyV2MinorUnits(row.day_total_credits))) : null;
    accounts.push({
      bank: latest.bank, currency: latest.currency, accountAlias: aliases.get(latest.account_fingerprint)!,
      lastStatementDate: latest.accounting_date,
      ageDays: (Date.parse(`${plan.asOfDate}T00:00:00Z`) - Date.parse(`${latest.accounting_date}T00:00:00Z`)) / DAY_MS,
      closingMinor: positionKnown ? toDailyV2MinorUnits(latest.closing_balance_derived) : null,
      positionUnavailable: !positionKnown,
      observedDays: period.length, unobservedCalendarDays: plan.periodDays - period.length,
      lineCount: period.reduce((sum, row) => addDailyV2SafeCount(sum, row.line_count), 0),
      debitsMinor, creditsMinor, netMinor: flowKnown ? creditsMinor! - debitsMinor! : null,
      reviewDays, unavailableDays,
    });
  }
  accounts.sort((a, b) => a.currency.localeCompare(b.currency) || a.bank.localeCompare(b.bank) || a.accountAlias.localeCompare(b.accountAlias));
  const currencies = [...new Set(accounts.map((account) => account.currency))].sort().map((currency): DashboardCurrency => {
    const entries = accounts.filter((account) => account.currency === currency);
    const dates = entries.map((account) => account.lastStatementDate).sort();
    const sumKnown = (field: 'debitsMinor' | 'creditsMinor' | 'netMinor') =>
      entries.some((account) => account[field] === null) ? null : addDailyV2MinorUnits(entries.map((account) => account[field]!));
    return {
      currency, accountCount: entries.length,
      knownPositionCount: entries.filter((account) => account.closingMinor !== null).length,
      olderStatementCount: entries.filter((account) => account.ageDays > 0).length,
      oldestStatementDate: dates[0], newestStatementDate: dates[dates.length - 1],
      // No currency balance total: distinct fingerprints do not prove distinct physical accounts.
      observedAccountDays: entries.reduce((sum, account) => addDailyV2SafeCount(sum, account.observedDays), 0),
      possibleAccountDays: entries.length * plan.periodDays,
      debitsMinor: sumKnown('debitsMinor'),
      creditsMinor: sumKnown('creditsMinor'), netMinor: sumKnown('netMinor'),
    };
  });
  return { plan, generatedAt, sourceUnitCount: totalCount, accounts, currencies };
}
