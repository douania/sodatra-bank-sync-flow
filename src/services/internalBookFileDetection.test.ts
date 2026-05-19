import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { detectInternalBookWorkbook } from './internalBookFileDetection';

function createWorkbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }

  return workbook;
}

function internalBookRows(): unknown[][] {
  return [
    ['OPENING BALANCE', 1000],
    ['DEPOSIT NOT YET CLEARED'],
    ['Synthetic deposit', 250],
    ['TOTAL BALANCE (A)', 1250],
    ['CHECK NOT YET CLEARED'],
    ['Synthetic check', 150],
    ['TOTAL (B)', 150],
    ['CLOSING BALANCE C', 1100],
  ];
}

function snapshotWorkbook(workbook: XLSX.WorkBook): string {
  return JSON.stringify({
    sheetNames: workbook.SheetNames,
    sheets: workbook.SheetNames.map((sheetName) => ({
      sheetName,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null }),
    })),
  });
}

test('detects a synthetic Internal Book workbook with a valid daily sheet and minimal sections', () => {
  const workbook = createWorkbook({ '050526': internalBookRows() });

  const result = detectInternalBookWorkbook(workbook, 'synthetic-internal-book.xlsx');

  assert.equal(result.isInternalBook, true);
  assert.equal(result.confidence, 'high');
  assert.deepEqual(result.detectedDailySheets, ['050526']);
  assert.equal(result.ignoredSheets.length, 0);
  assert.ok(result.matchedSignals.includes('openingBalance'));
  assert.ok(result.matchedSignals.includes('closingBalance'));
});

test('detects multiple daily sheets and returns detectedDailySheets', () => {
  const workbook = createWorkbook({
    '050526': internalBookRows(),
    '060526': internalBookRows(),
    Summary: [['Synthetic summary']],
  });

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, true);
  assert.deepEqual(result.detectedDailySheets, ['050526', '060526']);
  assert.deepEqual(result.ignoredSheets, ['Summary']);
});

test('does not detect a synthetic Collection Report workbook', () => {
  const workbook = createWorkbook({
    Collections: [
      ['DATE', 'CLIENT NAME', 'AMOUNT', 'BANK NAME'],
      ['2026-05-05', 'Synthetic client', 100, 'Synthetic bank'],
    ],
  });

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, false);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.detectedDailySheets, []);
});

test('does not detect a synthetic Fund Position workbook', () => {
  const workbook = createWorkbook({
    '050526': [
      ['FUND POSITION'],
      ['Book balance', 1000],
      ['TOTAL FUND AVAILABLE', 1000],
      ['GRAND TOTAL', 1000],
    ],
  });

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, false);
  assert.deepEqual(result.detectedDailySheets, ['050526']);
});

test('does not detect a synthetic Client Reconciliation workbook', () => {
  const workbook = createWorkbook({
    '050526': [
      ['CLIENT RECONCILIATION'],
      ['CLIENT CODE', 'CLIENT NAME', 'IMPAYES AMOUNT'],
      ['SYN-001', 'Synthetic client', 100],
    ],
  });

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, false);
  assert.deepEqual(result.detectedDailySheets, ['050526']);
});

test('does not detect a simple legacy bank report with bank, balances, and transactions only', () => {
  const workbook = createWorkbook({
    '050526': [
      ['BDK', '05/05/2026'],
      ['OPENING BALANCE', 1000],
      ['TRANSACTION', 'Synthetic transaction', 100],
      ['BALANCE', 1100],
      ['CLOSING BALANCE', 1100],
    ],
  });

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, false);
  assert.deepEqual(result.detectedDailySheets, ['050526']);
});

test('does not detect an empty workbook', () => {
  const workbook = XLSX.utils.book_new();

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, false);
  assert.equal(result.reason, 'Workbook has no sheets.');
  assert.deepEqual(result.detectedDailySheets, []);
});

test('does not detect a workbook with non-daily sheets only', () => {
  const workbook = createWorkbook({
    Summary: internalBookRows(),
    Archive: internalBookRows(),
  });

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, false);
  assert.deepEqual(result.detectedDailySheets, []);
  assert.deepEqual(result.ignoredSheets, ['Summary', 'Archive']);
});

test('handles a daily sheet without sufficient Internal Book shape', () => {
  const workbook = createWorkbook({
    '050526': [
      ['BALANCE', 1000],
      ['Synthetic transaction', 100],
    ],
  });

  const result = detectInternalBookWorkbook(workbook);

  assert.equal(result.isInternalBook, false);
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.detectedDailySheets, ['050526']);
  assert.deepEqual(result.matchedSignals, []);
});

test('does not mutate the workbook', () => {
  const workbook = createWorkbook({
    '050526': internalBookRows(),
    Summary: [['Synthetic summary']],
  });
  const before = snapshotWorkbook(workbook);

  detectInternalBookWorkbook(workbook);

  assert.equal(snapshotWorkbook(workbook), before);
});
