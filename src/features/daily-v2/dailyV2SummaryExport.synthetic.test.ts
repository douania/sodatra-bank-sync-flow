import assert from 'node:assert/strict';
import test from 'node:test';

import type { DailyV2ReportingGroupSummary } from './dailyV2ReportingCalculations';
import {
  DAILY_V2_SUMMARY_EXPORT_HEADERS,
  DAILY_V2_SUMMARY_EXPORT_SEPARATOR,
  buildDailyV2SummaryCsv,
  buildDailyV2SummaryExportRows,
  buildDailyV2SummaryFileName,
  protectDailyV2ExportCell,
} from './dailyV2SummaryExport';

function syntheticGroup(
  overrides: Partial<DailyV2ReportingGroupSummary> = {},
): DailyV2ReportingGroupSummary {
  return {
    bank: 'BDK',
    currency: 'XOF',
    accountAlias: 'C-0a1b2c3d4e5f6071',
    firstAccountingDate: '2026-07-01',
    lastAccountingDate: '2026-07-03',
    dayCount: 3,
    lineCount: 6,
    totalDebitsMinor: 22500000n,
    totalCreditsMinor: 47500000n,
    netFlowMinor: 25000000n,
    firstOpeningBalanceMinor: 100000000n,
    lastClosingBalanceMinor: 125000000n,
    needsReviewDayCount: 0,
    unavailableAggregatesDayCount: 0,
    ...overrides,
  };
}

test('builds exact text rows with header and bigint-rendered amounts', () => {
  const rows = buildDailyV2SummaryExportRows([syntheticGroup()]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], [...DAILY_V2_SUMMARY_EXPORT_HEADERS]);
  assert.deepEqual(rows[1], [
    'BDK',
    'XOF',
    'C-0a1b2c3d4e5f6071',
    '2026-07-01',
    '2026-07-03',
    '3',
    '6',
    '225000.00',
    '475000.00',
    '250000.00',
    '1000000.00',
    '1250000.00',
    '0',
    '0',
  ]);
  for (const cell of rows.flat()) {
    assert.equal(typeof cell, 'string');
  }
});

test('protects negative amounts and formula-leading cells with an apostrophe', () => {
  const rows = buildDailyV2SummaryExportRows([
    syntheticGroup({
      bank: '=HYPERLINK("x")',
      currency: '+XOF',
      accountAlias: '@alias',
      netFlowMinor: -25000000n,
      firstOpeningBalanceMinor: -1n,
    }),
  ]);
  const row = rows[1];
  assert.equal(row[0], `'=HYPERLINK("x")`);
  assert.equal(row[1], `'+XOF`);
  assert.equal(row[2], `'@alias`);
  assert.equal(row[9], `'-250000.00`);
  assert.equal(row[10], `'-0.01`);
});

test('protectDailyV2ExportCell also covers leading blanks before the marker', () => {
  assert.equal(protectDailyV2ExportCell('  =1+1'), `'  =1+1`);
  assert.equal(protectDailyV2ExportCell(' -1.23'), `' -1.23`);
  assert.equal(protectDailyV2ExportCell('safe'), 'safe');
  assert.equal(protectDailyV2ExportCell(''), '');
});

test('serializes CSV with separator, quoting and newline protection', () => {
  const csv = buildDailyV2SummaryCsv([
    ['a', 'b;c', 'd"e', 'f\ng'],
    ['1', '2', '3', '4'],
  ]);
  assert.equal(csv, `a;"b;c";"d""e";"f\ng"\r\n1;2;3;4`);
  assert.equal(DAILY_V2_SUMMARY_EXPORT_SEPARATOR, ';');
});

test('refuses an empty export explicitly', () => {
  assert.throws(() => buildDailyV2SummaryExportRows([]), /EXPORT_EMPTY_REPORT_REFUSED/);
});

test('builds a safe period-only file name and rejects invalid dates', () => {
  assert.equal(
    buildDailyV2SummaryFileName('2026-07-01', '2026-07-31', 'csv'),
    'daily-v2-report_2026-07-01_2026-07-31.csv',
  );
  assert.equal(
    buildDailyV2SummaryFileName('2026-07-01', '2026-07-31', 'xlsx'),
    'daily-v2-report_2026-07-01_2026-07-31.xlsx',
  );
  assert.throws(
    () => buildDailyV2SummaryFileName('01/07/2026', '2026-07-31', 'csv'),
    /EXPORT_FILE_NAME_DATES_INVALID/,
  );
});

test('headers and content expose no sensitive key material', () => {
  const rows = buildDailyV2SummaryExportRows([syntheticGroup()]);
  const flat = rows.flat().join(' ').toLowerCase();
  for (const forbidden of [
    'fingerprint',
    'day_unit_id',
    'raw_text_hash',
    'uuid',
    'actor',
    'account_fingerprint',
    'staging_unit_id',
  ]) {
    assert.equal(flat.includes(forbidden), false, `export must not contain ${forbidden}`);
  }
});
