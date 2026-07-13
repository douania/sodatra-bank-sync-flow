import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_DAILY_V2_REPORT_PERIOD_DAYS,
  addDailyV2SafeCount,
  buildDailyV2ReportAccountAlias,
  buildDailyV2ReportingSummaries,
  buildDailyV2ReportingSummariesWithAliasBuilder,
  isDailyV2ReportingSummariesFailure,
  validateDailyV2ReportingFilters,
} from './dailyV2ReportingCalculations';
import type { DailyV2ReportingUnitRow } from './dailyV2Types';

const FINGERPRINT_A = 'synthetic-report-fingerprint-alpha';
const FINGERPRINT_B = 'synthetic-report-fingerprint-beta';

function syntheticUnit(
  overrides: Partial<DailyV2ReportingUnitRow> = {},
): DailyV2ReportingUnitRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    accounting_date: '2026-07-01',
    bank: 'BDK',
    currency: 'XOF',
    account_fingerprint: FINGERPRINT_A,
    line_count: 2,
    day_total_debits: 100000,
    day_total_credits: 250000,
    opening_balance_derived: 1000000,
    closing_balance_derived: 1150000,
    aggregates_status: 'derived',
    validation_status: 'valid',
    ingested_at: '2026-07-10T08:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

test('accepts a strict bounded filter set and normalizes labels', () => {
  const result = validateDailyV2ReportingFilters({
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    bank: ' bdk ',
    currency: 'xof',
  });
  assert.ok(result.success);
  assert.deepEqual(result.filters, {
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    bank: 'BDK',
    currency: 'XOF',
    inclusiveDayCount: 31,
  });
});

test('treats blank optional filters as absent', () => {
  const result = validateDailyV2ReportingFilters({
    startDate: '2026-07-01',
    endDate: '2026-07-01',
    bank: '  ',
    currency: undefined,
  });
  assert.ok(result.success);
  assert.equal(result.filters.bank, null);
  assert.equal(result.filters.currency, null);
  assert.equal(result.filters.inclusiveDayCount, 1);
});

test('rejects malformed, non-calendar and reversed dates without fallback', () => {
  for (const [startDate, endDate] of [
    ['01/07/2026', '2026-07-31'],
    ['2026-7-01', '2026-07-31'],
    ['2026-02-30', '2026-03-31'],
    ['2026-07-31', '2026-07-01'],
    ['', '2026-07-31'],
  ] as const) {
    const result = validateDailyV2ReportingFilters({ startDate, endDate });
    assert.equal(result.success, false, `${startDate}..${endDate} must be refused`);
  }
});

test('rejects a window above the inclusive 400-day cap and accepts the cap', () => {
  const atCap = validateDailyV2ReportingFilters({
    startDate: '2026-01-01',
    endDate: '2027-02-04',
  });
  assert.ok(atCap.success);
  assert.equal(atCap.filters.inclusiveDayCount, MAX_DAILY_V2_REPORT_PERIOD_DAYS);

  const overCap = validateDailyV2ReportingFilters({
    startDate: '2026-01-01',
    endDate: '2027-02-05',
  });
  assert.equal(overCap.success, false);
});

test('rejects filter labels outside the conservative domain', () => {
  for (const bad of ['B K', 'BDK;DROP', 'É', 'VERYLONGLABEL13']) {
    const result = validateDailyV2ReportingFilters({
      startDate: '2026-07-01',
      endDate: '2026-07-02',
      bank: bad,
    });
    assert.equal(result.success, false, `bank "${bad}" must be refused`);
  }
});

// ---------------------------------------------------------------------------
// Alias
// ---------------------------------------------------------------------------

test('derives a deterministic non-reversible alias that hides the fingerprint', async () => {
  const alias = await buildDailyV2ReportAccountAlias(FINGERPRINT_A);
  const again = await buildDailyV2ReportAccountAlias(FINGERPRINT_A);
  const other = await buildDailyV2ReportAccountAlias(FINGERPRINT_B);
  assert.match(alias, /^C-[0-9a-f]{16}$/);
  assert.equal(alias, again);
  assert.notEqual(alias, other);
  assert.equal(alias.includes(FINGERPRINT_A), false);
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test('groups by bank/currency/alias with exact bigint totals and chronology', async () => {
  const units = [
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000003',
      accounting_date: '2026-07-03',
      day_total_debits: 75000,
      day_total_credits: 100000,
      opening_balance_derived: null,
      closing_balance_derived: 1250000,
    }),
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000001',
      accounting_date: '2026-07-01',
      day_total_debits: 100000,
      day_total_credits: 250000,
      opening_balance_derived: null,
      closing_balance_derived: 1150000,
    }),
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000002',
      accounting_date: '2026-07-02',
      day_total_debits: 50000,
      day_total_credits: 125000,
      opening_balance_derived: 1150000,
      closing_balance_derived: 1225000,
      validation_status: 'needs_review',
      aggregates_status: 'unavailable',
    }),
  ];

  const result = await buildDailyV2ReportingSummaries(units);
  assert.ok(
    result.success,
    isDailyV2ReportingSummariesFailure(result) ? result.errors.join(' | ') : undefined,
  );
  assert.equal(result.groups.length, 1);
  const group = result.groups[0];

  assert.equal(group.bank, 'BDK');
  assert.equal(group.currency, 'XOF');
  assert.match(group.accountAlias, /^C-[0-9a-f]{16}$/);
  assert.equal(group.firstAccountingDate, '2026-07-01');
  assert.equal(group.lastAccountingDate, '2026-07-03');
  assert.equal(group.dayCount, 3);
  assert.equal(group.lineCount, 6);
  assert.equal(group.totalDebitsMinor, 22500000n);
  assert.equal(group.totalCreditsMinor, 47500000n);
  assert.equal(group.netFlowMinor, 25000000n);
  // First non-null opening in chronological order is the 02/07 one.
  assert.equal(group.firstOpeningBalanceMinor, 115000000n);
  assert.equal(group.lastClosingBalanceMinor, 125000000n);
  assert.equal(group.needsReviewDayCount, 1);
  assert.equal(group.unavailableAggregatesDayCount, 1);

  assert.equal(result.currencySummaries.length, 1);
  assert.equal(result.currencySummaries[0].netFlowMinor, 25000000n);
});

test('never merges two currencies nor two fingerprints', async () => {
  const units = [
    syntheticUnit({ currency: 'XOF' }),
    syntheticUnit({ id: '00000000-0000-4000-8000-000000000002', currency: 'EUR' }),
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000003',
      account_fingerprint: FINGERPRINT_B,
    }),
  ];

  const result = await buildDailyV2ReportingSummaries(units);
  assert.ok(result.success);
  assert.equal(result.groups.length, 3);
  assert.deepEqual(
    result.currencySummaries.map((entry) => entry.currency),
    ['EUR', 'XOF'],
  );
  const aliases = new Set(result.groups.map((group) => group.accountAlias));
  assert.equal(aliases.size, 2);
});

test('sorts groups by currency, bank then alias', async () => {
  const units = [
    syntheticUnit({ bank: 'ORA', currency: 'XOF' }),
    syntheticUnit({ id: '00000000-0000-4000-8000-000000000002', bank: 'BDK', currency: 'XOF' }),
    syntheticUnit({ id: '00000000-0000-4000-8000-000000000003', bank: 'BDK', currency: 'EUR' }),
  ];
  const result = await buildDailyV2ReportingSummaries(units);
  assert.ok(result.success);
  assert.deepEqual(
    result.groups.map((group) => `${group.currency}/${group.bank}`),
    ['EUR/BDK', 'XOF/BDK', 'XOF/ORA'],
  );
});

test('a single invalid amount fails the whole report with no partial result', async () => {
  const units = [
    syntheticUnit(),
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000002',
      accounting_date: '2026-07-02',
      day_total_debits: 1.234,
    }),
  ];
  const result = await buildDailyV2ReportingSummaries(units);
  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /No partial report/);
});

test('rejects invalid line_count, statuses and dates fail-closed', async () => {
  for (const bad of [
    syntheticUnit({ line_count: 2.5 }),
    syntheticUnit({ line_count: -1 }),
    syntheticUnit({ line_count: Number.NaN }),
    syntheticUnit({ line_count: Number.POSITIVE_INFINITY }),
    syntheticUnit({ validation_status: 'oops' as DailyV2ReportingUnitRow['validation_status'] }),
    syntheticUnit({ aggregates_status: 'oops' as DailyV2ReportingUnitRow['aggregates_status'] }),
    syntheticUnit({ accounting_date: '01/07/2026' }),
    syntheticUnit({ account_fingerprint: ' ' }),
  ]) {
    const result = await buildDailyV2ReportingSummaries([bad]);
    assert.equal(result.success, false);
  }
});

// ---------------------------------------------------------------------------
// Alias collision (16-hex aliases; artificial deterministic collision)
// ---------------------------------------------------------------------------

// Former 32-bit prefix collision pair: shares the first 8 hex characters but
// MUST diverge at 16 hex — regression proof of the widened alias.
const FORMER_32BIT_PAIR_A = 'synthetic-collision-51719';
const FORMER_32BIT_PAIR_B = 'synthetic-collision-63877';

test('the former 32-bit collision pair diverges at 16 hex characters', async () => {
  const aliasA = await buildDailyV2ReportAccountAlias(FORMER_32BIT_PAIR_A);
  const aliasB = await buildDailyV2ReportAccountAlias(FORMER_32BIT_PAIR_B);
  assert.match(aliasA, /^C-[0-9a-f]{16}$/);
  assert.match(aliasB, /^C-[0-9a-f]{16}$/);
  assert.equal(aliasA.slice(0, 10), aliasB.slice(0, 10));
  assert.notEqual(aliasA, aliasB);
});

test('an artificial alias collision between two fingerprints refuses the whole report', async () => {
  const units = [
    syntheticUnit({ account_fingerprint: FINGERPRINT_A }),
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000002',
      accounting_date: '2026-07-02',
      account_fingerprint: FINGERPRINT_B,
    }),
  ];
  // Synthetic builder: deliberately the same 16-hex alias for both accounts.
  const collidingBuilder = async () => 'C-0123456789abcdef';
  const result = await buildDailyV2ReportingSummariesWithAliasBuilder(units, collidingBuilder);
  assert.equal(result.success, false);
  assert.ok(isDailyV2ReportingSummariesFailure(result));
  assert.equal(result.safeCode, 'REPORT_ACCOUNT_ALIAS_COLLISION');
  // Zero group is returned and no fingerprint leaks into the error.
  assert.equal('groups' in result, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(FINGERPRINT_A), false);
  assert.equal(serialized.includes(FINGERPRINT_B), false);
});

test('the production wrapper still groups the former pair separately', async () => {
  const units = [
    syntheticUnit({ account_fingerprint: FORMER_32BIT_PAIR_A }),
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000002',
      account_fingerprint: FORMER_32BIT_PAIR_B,
    }),
  ];
  const result = await buildDailyV2ReportingSummaries(units);
  assert.ok(result.success);
  assert.equal(result.groups.length, 2);
});

test('distinct fingerprints are grouped separately before their public alias is used', async () => {
  const units = [
    syntheticUnit({ account_fingerprint: FINGERPRINT_A }),
    syntheticUnit({
      id: '00000000-0000-4000-8000-000000000002',
      account_fingerprint: FINGERPRINT_B,
    }),
  ];
  const result = await buildDailyV2ReportingSummaries(units);
  assert.ok(result.success);
  assert.equal(result.groups.length, 2);
  assert.equal(new Set(result.groups.map((group) => group.accountAlias)).size, 2);
});

// ---------------------------------------------------------------------------
// Safe counters
// ---------------------------------------------------------------------------

test('rejects a line_count above the PostgreSQL integer bound fail-closed', async () => {
  const result = await buildDailyV2ReportingSummaries([
    syntheticUnit({ line_count: 2_147_483_648 }),
  ]);
  assert.equal(result.success, false);
  assert.ok(isDailyV2ReportingSummariesFailure(result));
  assert.equal(result.safeCode, 'REPORT_INPUT_INVALID');
  assert.equal('groups' in result, false);
});

test('line_count reproduces the DB domain: 1 accepted, 0 refused', async () => {
  const accepted = await buildDailyV2ReportingSummaries([syntheticUnit({ line_count: 1 })]);
  assert.ok(accepted.success);
  assert.equal(accepted.groups[0].lineCount, 1);

  const refused = await buildDailyV2ReportingSummaries([syntheticUnit({ line_count: 0 })]);
  assert.equal(refused.success, false);
  assert.ok(isDailyV2ReportingSummariesFailure(refused));
  assert.equal(refused.safeCode, 'REPORT_INPUT_INVALID');
});

test('addDailyV2SafeCount adds ordinary counters and stays fail-closed', () => {
  assert.equal(addDailyV2SafeCount(0, 0), 0);
  assert.equal(addDailyV2SafeCount(2, 3), 5);
  assert.equal(addDailyV2SafeCount(2_147_483_647, 2_147_483_647), 4_294_967_294);
  assert.throws(() => addDailyV2SafeCount(Number.MAX_SAFE_INTEGER, 1), /REPORT_COUNT_UNSAFE/);
  for (const [left, right] of [
    [-1, 1],
    [1, -1],
    [1.5, 1],
    [1, Number.NaN],
    [Number.POSITIVE_INFINITY, 1],
    [Number.MAX_SAFE_INTEGER + 2, 0],
  ]) {
    assert.throws(() => addDailyV2SafeCount(left, right), /REPORT_COUNT_UNSAFE/);
  }
});

test('input validation failures expose the REPORT_INPUT_INVALID safe code', async () => {
  const result = await buildDailyV2ReportingSummaries([
    syntheticUnit({ accounting_date: 'not-a-date' }),
  ]);
  assert.equal(result.success, false);
  assert.ok(isDailyV2ReportingSummariesFailure(result));
  assert.equal(result.safeCode, 'REPORT_INPUT_INVALID');
});

test('an unconvertible amount exposes the REPORT_AMOUNTS_UNSAFE safe code', async () => {
  const result = await buildDailyV2ReportingSummaries([
    syntheticUnit({ day_total_debits: 1.234 }),
  ]);
  assert.equal(result.success, false);
  assert.ok(isDailyV2ReportingSummariesFailure(result));
  assert.equal(result.safeCode, 'REPORT_AMOUNTS_UNSAFE');
});

test('the safe result exposes no fingerprint, id, uuid or hash material', async () => {
  const result = await buildDailyV2ReportingSummaries([syntheticUnit()]);
  assert.ok(result.success);
  const serialized = JSON.stringify(result, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  assert.equal(serialized.includes(FINGERPRINT_A), false);
  assert.equal(serialized.includes('00000000-0000-4000-8000-000000000001'), false);
  assert.equal(serialized.includes('"id"'), false);
  assert.equal(serialized.includes('fingerprint'), false);
});
