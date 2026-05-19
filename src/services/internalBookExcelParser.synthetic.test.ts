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

function createWorkbookFromRows(rows: unknown[][]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, '050526');
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

test('parses ORABANK aliases for deposits, total A, and issued checks sections', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', 1_000_000],
    ['DEPOTS PAS ENCORE ENCAISSE'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ['05/05/2026', 'DEP-001', 'Synthetic deposit', 100_000],
    ['TOTAL DEPOSIT', 100_000],
    ['TOTAL A', 1_100_000],
    ['LESS CHEQUES EMIS NON ENCAISSES'],
    ['DATE', 'CH NO', 'DESCRIPTION', 'AMOUNT'],
    ['05/05/2026', 'CHK-001', 'Synthetic check', 25_000],
    ['TOTAL (B)', 25_000],
    ['CLOSING BALANCE C', 1_075_000],
  ]);

  const result = parser.parseWorkbook(workbook, '05- ORABANK 2026.xlsx');

  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].bank, 'ORABANK');
  assert.equal(result.books[0].depositsNotYetCleared.length, 1);
  assert.equal(result.books[0].checksNotYetCleared.length, 1);
  assert.equal(result.books[0].validation.status, 'valid');
});

test('ignores numeric references under non-amount headers when selecting the amount', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', 1_000],
    ['DEPOSIT NOT YET CLEARED'],
    ['TOTAL DEPOSIT', 0],
    ['TOTAL BALANCE (A)', 1_000],
    ['CHECK NOT YET CLEARED'],
    ['DATE', 'CH NO', 'AMOUNT'],
    ['05/05/2026', 123456, 25],
    ['TOTAL (B)', 25],
    ['CLOSING BALANCE C', 975],
  ]);

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');
  const [check] = result.books[0].checksNotYetCleared;

  assert.equal(check.amount.value, 25);
  assert.equal(check.reference, '123456');
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('ignores raw Excel dates under DATE headers when selecting the amount', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', 1_000],
    ['DEPOSIT NOT YET CLEARED'],
    ['TOTAL DEPOSIT', 0],
    ['TOTAL BALANCE (A)', 1_000],
    ['CHECK NOT YET CLEARED'],
    ['DESCRIPTION', 'DATE', 'AMOUNT'],
    ['Synthetic check', 46147, 25],
    ['TOTAL (B)', 25],
    ['CLOSING BALANCE C', 975],
  ]);

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');

  assert.equal(result.books[0].checksNotYetCleared[0].amount.value, 25);
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('keeps right-most amount selection after filtering non-amount columns', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', 1_000],
    ['DEPOSIT NOT YET CLEARED'],
    ['TOTAL DEPOSIT', 0],
    ['TOTAL BALANCE (A)', 1_000],
    ['CHEQUES EMIS NON ENCAISSES'],
    ['REF', 'AMOUNT'],
    [987654, 25],
    ['TOTAL (B)', 25],
    ['CLOSING BALANCE C', 975],
  ]);

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');

  assert.equal(result.books[0].checksNotYetCleared[0].amount.value, 25);
  assert.equal(result.books[0].checksNotYetCleared[0].reference, '987654');
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('preserves residual ambiguous amount column issues after header filtering', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', 1_000],
    ['DEPOSIT NOT YET CLEARED'],
    ['TOTAL DEPOSIT', 0],
    ['TOTAL BALANCE (A)', 1_000],
    ['CHECK NOT YET CLEARED'],
    ['AMOUNT', 'MONTANT'],
    [10, 25],
    ['TOTAL (B)', 25],
    ['CLOSING BALANCE C', 975],
  ]);

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');

  assert.equal(result.books[0].checksNotYetCleared[0].amount.value, 25);
  assert.equal(result.books[0].validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), true);
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
