import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { InternalBookExcelParser } from './internalBookExcelParser';

const parser = new InternalBookExcelParser();

function createWorkbook(closingBalance = 117769578): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['OPENING BALANCE', 118728153],
    ['DEPOSIT NOT YET CLEARED'],
    ['TOTAL DEPOSIT', '-'],
    ['TOTAL BALANCE (A)', 118728153],
    ['CHECK NOT YET CLEARED'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ['05/05/2026', '1001', 'Synthetic check A', 228519],
    ['05/05/2026', '1002', 'Synthetic check B', 730056],
    ['TOTAL (B)', 958575],
    ['CLOSING BALANCE C', closingBalance],
    ['BANK FACILITY'],
    ['FACILITY', 'LIMIT', 'USED', 'BALANCE'],
    ['Synthetic facility 1', 1000000, '-', 1000000],
    ['Synthetic facility 2', 500000, 250000, 250000],
    ['TOTAL', 1500000, 250000, 1250000],
    ['IMPAYE'],
    ['05/05/2026', 'SYN-001', 'Synthetic unpaid A', 7000000],
    ['05/05/2026', 'SYN-002', 'Synthetic unpaid B', 8000000],
    ['05/05/2026', 'SYN-003', 'Synthetic unpaid C', 5702280],
    ['TOTAL IMPAYES', 20702280],
  ]);
  const ignoredSheet = XLSX.utils.aoa_to_sheet([['Notes'], ['Not an internal book sheet']]);

  XLSX.utils.book_append_sheet(workbook, sheet, '050526');
  XLSX.utils.book_append_sheet(workbook, ignoredSheet, 'NOTES');

  return workbook;
}

test('parses a synthetic BIS internal book workbook with dash zero totals and facilities', () => {
  const result = parser.parseWorkbook(createWorkbook(), '05-BIS 2026.xlsx', {
    parsedAt: '2026-05-18T00:00:00.000Z',
  });

  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].reportDate, '2026-05-05');
  assert.equal(result.books[0].bank, 'BIS');
  assert.equal(result.books[0].validation.calculatedTotalChecks, 958575);
  assert.equal(result.books[0].validation.declaredClosingBalanceC, 117769578);
  assert.equal(result.books[0].validation.calculatedClosingBalanceC, 117769578);
  assert.equal(result.books[0].validation.declaredTotalDeposits, 0);
  assert.equal(result.books[0].bankFacilities[0].used?.value, 0);
  assert.equal(result.errors.some((issue) => issue.section === 'totalDeposits'), false);
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('ignores an invalid non-daily sheet name', () => {
  const result = parser.parseWorkbook(createWorkbook(), '05-BIS 2026.xlsx');

  assert.equal(result.ignoredSheets.length, 1);
  assert.equal(result.ignoredSheets[0].sheetName, 'NOTES');
});

test('flags an A-B-C mismatch as needs_review', () => {
  const result = parser.parseWorkbook(createWorkbook(117000000), '05-BIS 2026.xlsx');

  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].validation.status, 'needs_review');
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH'), true);
});

function workbookFromRows(rows: unknown[][], sourceSheet = '050526'): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sourceSheet);
  return workbook;
}

test('recognizes ORABANK total A and less cheques aliases without missing section issues', () => {
  const result = parser.parseWorkbook(
    workbookFromRows([
      ['OPENING BALANCE', 100000],
      ['DEPOTS PAS ENCORE ENCAISSE'],
      ['TOTAL DEPOSIT', '-'],
      ['TOTAL (A)', 100000],
      ['LESS CHEQUES EMIS NON ENCAISSES'],
      ['DATE', 'CH.NO', 'TR No/FACT No/REF', 'AMOUNT'],
      ['05/05/2026', 123456, 7890, 50000],
      ['TOTAL (B)', 50000],
      ['CLOSING BALANCE C', 50000],
    ]),
    '05- ORABANK 2026.xlsx',
  );

  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].bank, 'ORABANK');
  assert.equal(result.books[0].totalBalanceA?.value, 100000);
  assert.equal(result.books[0].checksNotYetCleared.length, 1);
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'MISSING_REQUIRED_SECTION'), false);
});

test('filters numeric reference columns from amount candidates using section headers', () => {
  const result = parser.parseWorkbook(
    workbookFromRows([
      ['OPENING BALANCE', 100000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', '-'],
      ['TOTAL A', 100000],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'CH.NO', 'TR No/FACT No/REF', 'AMOUNT'],
      ['05/05/2026', 123456, 7890, 50000],
      ['TOTAL (B)', 50000],
      ['CLOSING BALANCE C', 50000],
    ]),
    '05-BDK 2026.xlsx',
  );

  assert.equal(result.books[0].checksNotYetCleared[0].amount.value, 50000);
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('does not treat Excel serial dates in DATE header columns as business amounts', () => {
  const result = parser.parseWorkbook(
    workbookFromRows([
      ['OPENING BALANCE', 100000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', '-'],
      ['TOTAL BALANCE (A)', 100000],
      ['CHECK NOT YET CLEARED'],
      ['TOTAL (B)', 0],
      ['CLOSING BALANCE C', 100000],
      ['IMPAYE'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
      [46147, 'UNP-SYN-001', 'Synthetic unpaid', 25000],
      ['TOTAL IMPAYES', 25000],
    ]),
    '05-BIS 2026.xlsx',
  );

  assert.equal(result.books[0].impayes[0].amount.value, 25000);
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('uses right-most amount after header filtering when amount columns are explicit and contiguous', () => {
  const result = parser.parseWorkbook(
    workbookFromRows([
      ['OPENING BALANCE', 100000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', '-'],
      ['TOTAL BALANCE (A)', 100000],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'REF', 'AMOUNT', 'AMOUNT 1'],
      ['05/05/2026', 456789, 10000, 25000],
      ['TOTAL (B)', 25000],
      ['CLOSING BALANCE C', 75000],
    ]),
    '05- ORABANK 2026.xlsx',
  );

  assert.equal(result.books[0].checksNotYetCleared[0].amount.value, 25000);
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('preserves needs_review when multiple numeric columns remain ambiguous without headers', () => {
  const result = parser.parseWorkbook(
    workbookFromRows([
      ['OPENING BALANCE', 100000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', '-'],
      ['TOTAL BALANCE (A)', 100000],
      ['CHECK NOT YET CLEARED'],
      [123456, 7890, 50000],
      ['TOTAL (B)', 50000],
      ['CLOSING BALANCE C', 50000],
    ]),
    '05-BDK 2026.xlsx',
  );

  assert.equal(result.books[0].validation.status, 'needs_review');
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), true);
});
