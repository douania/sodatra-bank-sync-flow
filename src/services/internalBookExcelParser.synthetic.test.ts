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

function createWorkbookFromRows(rows: unknown[][], sheetName = '050526'): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
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

test('selects BDK simple totals from AMOUNT while keeping TOTAL (B) on AMOUNT 1', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', '', '', '', '', '', 1_000_000, ''],
    ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
    ['DEPOSIT NOT YET CLEARED'],
    ['05/05/2026', '', 'Synthetic BDK deposit', 'Synthetic vendor', 'Synthetic client', 260581, 100_000, ''],
    ['', '', '', 'TOTAL DEPOSIT', '', '', 100_000, 0],
    ['', '', '', 'TOTAL BALANCE (A)', '', '', 1_100_000, ''],
    ['CHECK NOT YET CLEARED'],
    ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
    ['05/05/2026', 1001, 'Synthetic BDK check', 'Synthetic vendor', 'Synthetic client', 87035, '', 75_000],
    ['', '', '', 'TOTAL (B)', '', '', '', 75_000],
    ['', '', '', 'CLOSING BALANCE', '', '', 1_025_000, ''],
  ]);

  const result = parser.parseWorkbook(workbook, '05-BDK 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.totalDeposits?.value, 100_000);
  assert.equal(book.totalB?.value, 75_000);
  assert.equal(book.closingBalanceC?.value, 1_025_000);
  assert.deepEqual(book.validation.issues.map((issue) => issue.code), []);
});

test('selects ORABANK simple totals from MONTANT when MONTANT 2 contains trailing zeros', () => {
  const workbook = createWorkbookFromRows([
    ['DATE', 'CH NO BD', 'DESCRIPTION', 'PROVIDER', 'CLIENT', 'REF', 'MONTANT', 'MONTANT 2'],
    ['', '', 'SOLDE D OUVERTURE', '', '', '', 1_000_000, 0],
    ['DEPOTS PAS ENCORE ENCAISSE'],
    ['05/05/2026', '', 'Synthetic ORABANK deposit', 'Synthetic provider', 'Synthetic client', 'SYN-DEP-001', 100_000, 0],
    ['', '', 'TOTAL DEPOSIT', '', '', '', 100_000, 0],
    ['', '', 'TOTAL A', '', '', '', 1_100_000, 0],
    ['LESS CHEQUES EMIS NON ENCAISSES'],
    ['05/05/2026', 'SYN-CHK-001', 'Synthetic ORABANK check A', 'Synthetic provider', 'Synthetic client', 'SYN-REF-001', 50_000, 0],
    ['05/05/2026', 'SYN-CHK-002', 'Synthetic ORABANK check B', 'Synthetic provider', 'Synthetic client', 'SYN-REF-002', 25_000, 0],
    ['', '', 'TOTAL B', '', '', '', 75_000, 0],
    ['', '', 'SOLDE DE CLOTURE SELON LE LIVRE C = A-B', '', '', '', 1_025_000, 0],
  ]);

  const result = parser.parseWorkbook(workbook, '05- ORABANK 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.openingBalance?.value, 1_000_000);
  assert.equal(book.totalDeposits?.value, 100_000);
  assert.equal(book.totalBalanceA?.value, 1_100_000);
  assert.equal(book.totalB?.value, 75_000);
  assert.equal(book.closingBalanceC?.value, 1_025_000);
  assert.deepEqual(book.validation.issues.map((issue) => issue.code), []);
});

test('keeps official total amounts under AMOUNT when numeric parasites are farther right', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', '', '', 1_000_000],
      ['DEPOSIT NOT YET CLEARED'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT', 'CONTROL'],
      ['TOTAL DEPOSIT', '', '', 0, 123_456],
      ['TOTAL BALANCE (A)', '', '', 1_000_000, 234_567],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT', 'CONTROL'],
      ['18/05/2026', 'CHK-SYN-001', 'Synthetic check', 600_000, 345_678],
      ['TOTAL (B)', '', '', 600_000, 123_456],
      ['CLOSING BALANCE C', '', '', 400_000, 456_789],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05 - BICIS 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.reportDate, '2026-05-18');
  assert.equal(book.validation.status, 'valid');
  assert.equal(book.totalDeposits?.value, 0);
  assert.equal(book.totalBalanceA?.value, 1_000_000);
  assert.equal(book.totalB?.value, 600_000);
  assert.equal(book.closingBalanceC?.value, 400_000);
  assert.equal(book.checksNotYetCleared[0].amount.value, 600_000);
  assert.equal(
    book.validation.issues.some((issue) => issue.severity === 'error' && issue.section === 'totalB'),
    false,
  );
  assert.equal(
    book.validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN' && issue.severity === 'warning'),
    true,
  );
});

test('keeps official detail amount under MONTANT and warns on unclassified numeric parasites', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', '', '', 1_000_000],
    ['DEPOTS PAS ENCORE ENCAISSE'],
    ['DATE', 'TR NO', 'DESCRIPTION', 'MONTANT', 'CONTROL'],
    ['18/05/2026', 123456, 'Synthetic deposit', 100_000, 987_654],
    ['TOTAL DEPOSIT', '', '', 100_000],
    ['TOTAL BALANCE (A)', '', '', 1_100_000],
    ['CHECK NOT YET CLEARED'],
    ['DATE', 'FACT NO', 'DESCRIPTION', 'MONTANT'],
    ['18/05/2026', 654321, 'Synthetic check', 50_000],
    ['TOTAL (B)', '', '', 50_000],
    ['CLOSING BALANCE C', '', '', 1_050_000],
  ]);

  const result = parser.parseWorkbook(workbook, '05 - BICIS 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.depositsNotYetCleared[0].amount.value, 100_000);
  assert.equal(book.depositsNotYetCleared[0].reference, '123456');
  assert.equal(
    book.validation.issues.some(
      (issue) =>
        issue.code === 'AMBIGUOUS_AMOUNT_COLUMN' &&
        issue.severity === 'warning' &&
        issue.section === 'depositsNotYetCleared',
    ),
    true,
  );
});

test('extracts bank facility amounts by business headers while ignoring dates and references', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', 1_000_000],
    ['DEPOSIT NOT YET CLEARED'],
    ['TOTAL DEPOSIT', 0],
    ['TOTAL BALANCE (A)', 1_000_000],
    ['CHECK NOT YET CLEARED'],
    ['TOTAL (B)', 0],
    ['CLOSING BALANCE C', 1_000_000],
    ['BANK FACILITY'],
    ['FACILITY', 'DATE', 'REF', 'LIMIT', 'USED', 'BALANCE'],
    ['Synthetic facility', 46147, 123456, 1_000_000, 400_000, 600_000],
    ['TOTAL', 46147, 123456, 1_000_000, 400_000, 600_000],
  ]);

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.bankFacilities[0].limit?.value, 1_000_000);
  assert.equal(book.bankFacilities[0].used?.value, 400_000);
  assert.equal(book.bankFacilities[0].balance?.value, 600_000);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
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
