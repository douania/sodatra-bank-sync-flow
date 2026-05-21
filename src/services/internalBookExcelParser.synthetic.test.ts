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

function createWorkbookWithImpayesRows(impayeRows: unknown[][], sourceRows: Partial<{
  bankFacilityRows: unknown[][];
  checksRows: unknown[][];
}> = {}): XLSX.WorkBook {
  return createWorkbookFromRows(
    [
      ['OPENING BALANCE', 1_000_000],
      ['DEPOSIT NOT YET CLEARED'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
      ['05/05/2026', 'DEP-SYN-001', 'Synthetic deposit', 100_000],
      ['TOTAL DEPOSIT', 100_000],
      ['TOTAL BALANCE (A)', 1_100_000],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
      ...(sourceRows.checksRows ?? [
        ['05/05/2026', 'CHK-SYN-001', 'Synthetic check A', 50_000],
        ['05/05/2026', 'CHK-SYN-002', 'Synthetic check B', 25_000],
      ]),
      ['TOTAL (B)', 75_000],
      ['CLOSING BALANCE C', 1_025_000],
      ['BANK FACILITY'],
      ['FACILITY', 'LIMIT', 'USED', 'BALANCE'],
      ...(sourceRows.bankFacilityRows ?? [
        ['Synthetic facility', 500_000, 0, 500_000],
        ['TOTAL', 500_000, 0, 500_000],
      ]),
      ['IMPAYE'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
      ...impayeRows,
    ],
    '180526',
  );
}

function createChecksWorkbook(
  checksRows: unknown[][],
  declaredTotalChecks: number,
  closingBalance: number,
  totalBalanceA = 1_000_000,
): XLSX.WorkBook {
  return createWorkbookFromRows(
    [
      ['OPENING BALANCE', totalBalanceA],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', 0],
      ['TOTAL BALANCE (A)', totalBalanceA],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
      ...checksRows,
      ['TOTAL (B)', declaredTotalChecks],
      ['CLOSING BALANCE C', closingBalance],
    ],
    '180526',
  );
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

test('recognizes an unlabeled single-amount IMPAYE total row without adding a false unpaid line', () => {
  const result = parser.parseWorkbook(
    createWorkbookWithImpayesRows([
      ['05/05/2026', 'UNP-SYN-001', 'Synthetic unpaid A', 10_000],
      ['05/05/2026', 'UNP-SYN-002', 'Synthetic unpaid B', 5_000],
      ['', '', '', 15_000],
    ]),
    '05-BIS 2026.xlsx',
  );

  const [book] = result.books;

  assert.equal(book.impayes.length, 2);
  assert.deepEqual(book.impayes.map((line) => line.amount.value), [10_000, 5_000]);
  assert.equal(book.validation.declaredTotalImpayes, 15_000);
  assert.equal(book.validation.calculatedTotalImpayes, 15_000);
  assert.equal(book.validation.status, 'valid');
});

test('keeps explicit TOTAL IMPAYE rows as declared totals', () => {
  const result = parser.parseWorkbook(
    createWorkbookWithImpayesRows([
      ['05/05/2026', 'UNP-SYN-001', 'Synthetic unpaid A', 10_000],
      ['05/05/2026', 'UNP-SYN-002', 'Synthetic unpaid B', 5_000],
      ['TOTAL IMPAYE', 15_000],
    ]),
    '05-BIS 2026.xlsx',
  );

  const [book] = result.books;

  assert.equal(book.impayes.length, 2);
  assert.equal(book.validation.declaredTotalImpayes, 15_000);
  assert.equal(book.validation.calculatedTotalImpayes, 15_000);
  assert.equal(book.validation.status, 'valid');
});

test('flags an unlabeled single-amount IMPAYE row that does not match the previous unpaid sum', () => {
  const result = parser.parseWorkbook(
    createWorkbookWithImpayesRows([
      ['05/05/2026', 'UNP-SYN-001', 'Synthetic unpaid A', 10_000],
      ['05/05/2026', 'UNP-SYN-002', 'Synthetic unpaid B', 5_000],
      ['', '', '', 99_999],
    ]),
    '05-BIS 2026.xlsx',
  );

  const [book] = result.books;
  const impayesIssue = book.validation.issues.find((issue) => issue.code === 'IMPAYES_TOTAL_MISMATCH');

  assert.equal(book.impayes.length, 3);
  assert.equal(book.validation.declaredTotalImpayes, undefined);
  assert.equal(book.validation.status, 'needs_review');
  assert.equal(impayesIssue?.section, 'impayes');
  assert.equal(impayesIssue?.actual, 99_999);
  assert.equal(impayesIssue?.expected, 15_000);
});

test('keeps an ATLANTIK-shaped workbook valid with an unlabeled IMPAYE total row', () => {
  const result = parser.parseWorkbook(
    createWorkbookWithImpayesRows(
      [
        ['18/05/2026', 740001, 'Synthetic ATLANTIK unpaid A', 10_000],
        ['18/05/2026', 740002, 'Synthetic ATLANTIK unpaid B', 5_000],
        ['', '', '', 15_000],
      ],
      {
        checksRows: [
          [46160, 720001, 'Synthetic ATLANTIK check A', 50_000],
          [46160, 720002, 'Synthetic ATLANTIK check B', 25_000],
        ],
      },
    ),
    '5-ATLANTIK BANK 2026.xlsx',
  );

  const [book] = result.books;

  assert.equal(book.bank, 'ATLANTIK');
  assert.equal(book.impayes.length, 2);
  assert.equal(book.validation.declaredTotalImpayes, 15_000);
  assert.equal(book.validation.calculatedTotalImpayes, 15_000);
  assert.equal(book.validation.status, 'valid');
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

test('resolves BDK TOTAL (B) from AMOUNT when AMOUNT 1 breaks closing balance consistency', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', '', '', '', '', '', 178_080_138, ''],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['DEPOSIT NOT YET CLEARED'],
      ['', '', '', 'TOTAL DEPOSIT', '', '', 0, ''],
      ['', '', '', 'TOTAL BALANCE (A)', '', '', 178_080_138, ''],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['18/05/2026', 1001, 'Synthetic BDK check A', 'Synthetic vendor', 'Synthetic client', 87035, 100_000_000, ''],
      ['18/05/2026', 1002, 'Synthetic BDK check B', 'Synthetic vendor', 'Synthetic client', 87036, 17_265_013, ''],
      ['18/05/2026', 1003, 'Synthetic BDK non official amount', 'Synthetic vendor', 'Synthetic client', 87037, '', 15_606_507],
      ['', '', '', 'TOTAL (B)', '', '', 117_265_013, 15_606_507],
      ['', '', '', 'CLOSING BALANCE', '', '', 60_815_125, ''],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05-BDK 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.reportDate, '2026-05-18');
  assert.equal(book.validation.status, 'valid');
  assert.equal(book.totalB?.value, 117_265_013);
  assert.equal(book.validation.calculatedTotalChecks, 117_265_013);
  assert.equal(book.validation.declaredTotalChecks, 117_265_013);
  assert.equal(book.closingBalanceC?.value, 60_815_125);
  assert.equal(
    book.validation.issues.some(
      (issue) =>
        issue.code === 'AMBIGUOUS_AMOUNT_COLUMN' &&
        issue.severity === 'warning' &&
        issue.section === 'checksNotYetCleared' &&
        issue.message.includes('Montant de cheque hors colonne alignee avec TOTAL(B) ignore'),
    ),
    true,
  );
  assert.equal(
    book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH' && issue.section === 'totalB'),
    false,
  );
  assert.equal(
    book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH' && issue.section === 'closingBalanceC'),
    false,
  );
});

test('preserves BDK TOTAL (B) from AMOUNT 1 when it matches closing balance consistency', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', '', '', '', '', '', 1_000_000, ''],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['DEPOSIT NOT YET CLEARED'],
      ['', '', '', 'TOTAL DEPOSIT', '', '', 0, ''],
      ['', '', '', 'TOTAL BALANCE (A)', '', '', 1_000_000, ''],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['18/05/2026', 1001, 'Synthetic BDK check', 'Synthetic vendor', 'Synthetic client', 87035, 123_456, 600_000],
      ['', '', '', 'TOTAL (B)', '', '', 123_456, 600_000],
      ['', '', '', 'CLOSING BALANCE', '', '', 400_000, ''],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05-BDK 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.totalB?.value, 600_000);
  assert.equal(book.validation.calculatedTotalChecks, 600_000);
  assert.equal(book.closingBalanceC?.value, 400_000);
  assert.equal(
    book.validation.issues.some(
      (issue) =>
        issue.code === 'AMBIGUOUS_AMOUNT_COLUMN' &&
        issue.severity === 'warning' &&
        issue.section === 'checksNotYetCleared' &&
        issue.message.includes('Montant de cheque hors colonne alignee avec TOTAL(B) ignore'),
    ),
    true,
  );
  assert.equal(
    book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH' && issue.section === 'totalB'),
    false,
  );
  assert.equal(
    book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH' && issue.section === 'closingBalanceC'),
    false,
  );
});

test('keeps BDK TOTAL (B) unresolved when no amount candidate matches closing balance consistency', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', '', '', '', '', '', 1_000_000, ''],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['DEPOSIT NOT YET CLEARED'],
      ['', '', '', 'TOTAL DEPOSIT', '', '', 0, ''],
      ['', '', '', 'TOTAL BALANCE (A)', '', '', 1_000_000, ''],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['18/05/2026', 1001, 'Synthetic BDK check', 'Synthetic vendor', 'Synthetic client', 87035, 600_000, 700_000],
      ['', '', '', 'TOTAL (B)', '', '', 500_000, 700_000],
      ['', '', '', 'CLOSING BALANCE', '', '', 400_000, ''],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05-BDK 2026.xlsx');
  const [book] = result.books;
  const totalBIssues = book.validation.issues.filter((issue) => issue.section === 'totalB');

  assert.equal(book.validation.status, 'needs_review');
  assert.equal(book.totalB, undefined);
  assert.equal(totalBIssues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN' && issue.severity === 'error'), true);
  assert.equal(totalBIssues.some((issue) => issue.code === 'MISSING_REQUIRED_AMOUNT'), false);
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

test('flags ambiguous business amount columns on total rows as needs review', () => {
  const workbook = createWorkbookFromRows([
    ['OPENING BALANCE', '', '', 1_000_000],
    ['DEPOSIT NOT YET CLEARED'],
    ['TOTAL DEPOSIT', '', '', 0],
    ['TOTAL BALANCE (A)', '', '', 1_000_000],
    ['CHECK NOT YET CLEARED'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ['05/05/2026', 'CHK-SYN-001', 'Synthetic check', 50_000],
    ['LABEL', 'AMOUNT', 'MONTANT'],
    ['TOTAL (B)', 50_000, 60_000],
    ['CLOSING BALANCE C', '', '', 950_000],
  ]);

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');
  const [book] = result.books;
  const ambiguousTotalIssue = book.validation.issues.find(
    (issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN' && issue.section === 'totalB',
  );

  assert.equal(book.validation.status, 'needs_review');
  assert.equal(ambiguousTotalIssue?.severity, 'error');
  assert.equal(result.success, false);
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

test('classifies ORABANK-shaped old issued checks as prudent risk while TOTAL(B) stays operational', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', 283_316],
      ['DEPOTS PAS ENCORE ENCAISSE'],
      ['TOTAL DEPOSIT', 0],
      ['TOTAL A', 283_316],
      ['LESS CHEQUES EMIS NON ENCAISSES'],
      ['DATE', 'CH NO', 'DESCRIPTION', 'AMOUNT'],
      ['17/05/2023', 'CHK-OLD-001', 'Synthetic old check A', 3_000_000],
      ['18/05/2022', 'CHK-OLD-002', 'Synthetic old check B', 2_808_751],
      ['TOTAL (B)', 0],
      ['CLOSING BALANCE C', 283_316],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05- ORABANK 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.checksNotYetCleared.length, 0);
  assert.equal(book.staleOutstandingChecks.length, 2);
  assert.equal(book.validation.declaredTotalChecks, 0);
  assert.equal(book.validation.calculatedTotalChecksOperational, 0);
  assert.equal(book.validation.calculatedStaleOutstandingChecksRiskTotal, 5_808_751);
  assert.equal(book.validation.calculatedTotalChecksPrudent, 5_808_751);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'STALE_OUTSTANDING_CHECK'), true);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH'), false);
});

test('classifies a stale outstanding check from an Excel serial date', () => {
  const result = parser.parseWorkbook(
    createChecksWorkbook([[45063, 'CHK-SERIAL-OLD', 'Synthetic serial old check', 45_000]], 0, 1_000_000),
    '05-BIS 2026.xlsx',
  );
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.staleOutstandingChecks.length, 1);
  assert.equal(book.checksNotYetCleared.length, 0);
  assert.equal(book.validation.calculatedStaleOutstandingChecksRiskTotal, 45_000);
  assert.equal(book.validation.calculatedTotalChecksOperational, 0);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'STALE_OUTSTANDING_CHECK'), true);
});

test('keeps a recent outstanding check operational from an Excel serial date', () => {
  const result = parser.parseWorkbook(
    createChecksWorkbook([[45795, 'CHK-SERIAL-RECENT', 'Synthetic serial recent check', 70_000]], 70_000, 930_000),
    '05-BIS 2026.xlsx',
  );
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.checksNotYetCleared.length, 1);
  assert.equal(book.staleOutstandingChecks.length, 0);
  assert.equal(book.validation.calculatedTotalChecksOperational, 70_000);
});

test('classifies Excel serial check dates stale at the three-year report-date cutoff only', () => {
  const result = parser.parseWorkbook(
    createChecksWorkbook(
      [
        [45064, 'CHK-SERIAL-CUTOFF', 'Synthetic serial cutoff check', 60_000],
        [45065, 'CHK-SERIAL-AFTER', 'Synthetic serial after cutoff check', 40_000],
      ],
      40_000,
      960_000,
    ),
    '05-BIS 2026.xlsx',
  );
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.deepEqual(book.staleOutstandingChecks.map((line) => line.date), ['2023-05-18']);
  assert.deepEqual(book.checksNotYetCleared.map((line) => line.date), ['2023-05-19']);
});

test('extracts Excel serial dates from DATE headers without confusing official amounts', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', 1_000_000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', 0],
      ['TOTAL BALANCE (A)', 1_000_000],
      ['CHECK NOT YET CLEARED'],
      ['DESCRIPTION', 'DATE', 'REFERENCE', 'AMOUNT'],
      ['Synthetic DATE serial check', 45064, 'CHK-DATE-SERIAL', 65_000],
      ['TOTAL (B)', 0],
      ['CLOSING BALANCE C', 1_000_000],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');
  const [book] = result.books;
  const [check] = book.staleOutstandingChecks;

  assert.equal(book.validation.status, 'valid');
  assert.equal(check.date, '2023-05-18');
  assert.equal(check.amount.value, 65_000);
  assert.equal(book.validation.calculatedTotalChecksOperational, 0);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'AMBIGUOUS_AMOUNT_COLUMN'), false);
});

test('preserves stale outstanding check classification for text row dates', () => {
  const result = parser.parseWorkbook(
    createChecksWorkbook([['17/05/2023', 'CHK-TEXT-OLD', 'Synthetic text old check', 55_000]], 0, 1_000_000),
    '05-BIS 2026.xlsx',
  );
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.staleOutstandingChecks[0].date, '2023-05-17');
  assert.equal(book.validation.calculatedStaleOutstandingChecksRiskTotal, 55_000);
});

test('extracts an Excel serial date from the first row cell without a DATE header', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', 1_000_000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', 0],
      ['TOTAL BALANCE (A)', 1_000_000],
      ['CHECK NOT YET CLEARED'],
      ['REFERENCE', 'DESCRIPTION', 'AMOUNT'],
      [45064, 'Synthetic first-cell serial check', 30_000],
      ['TOTAL (B)', 0],
      ['CLOSING BALANCE C', 1_000_000],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05-BIS 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.staleOutstandingChecks[0].date, '2023-05-18');
  assert.equal(book.validation.calculatedStaleOutstandingChecksRiskTotal, 30_000);
});

test('classifies stale checks by age for common Internal Book bank shapes', () => {
  const cases = [
    ['05-BIS 2026.xlsx', 'BIS'],
    ['05 - BICIS 2026.xlsx', 'BICIS'],
    ['05-BRIDGE 2026.xlsx', 'BRIDGE'],
    ['5-ATLANTIK BANK 2026.xlsx', 'ATLANTIK'],
  ] as const;

  for (const [sourceFile, bank] of cases) {
    const result = parser.parseWorkbook(
      createChecksWorkbook([['17/05/2023', `CHK-${bank}-OLD`, `Synthetic ${bank} old check`, 45_000]], 0, 1_000_000),
      sourceFile,
    );
    const [book] = result.books;

    assert.equal(book.bank, bank);
    assert.equal(book.validation.status, 'valid');
    assert.equal(book.staleOutstandingChecks.length, 1);
    assert.equal(book.validation.calculatedStaleOutstandingChecksRiskTotal, 45_000);
    assert.equal(book.validation.calculatedTotalChecksOperational, 0);
  }
});

test('keeps BDK stale check aligned to the official TOTAL(B) AMOUNT 1 column out of operational total', () => {
  const workbook = createWorkbookFromRows(
    [
      ['OPENING BALANCE', '', '', '', '', '', 1_000_000, ''],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['DEPOSIT NOT YET CLEARED'],
      ['', '', '', 'TOTAL DEPOSIT', '', '', 0, ''],
      ['', '', '', 'TOTAL BALANCE (A)', '', '', 1_000_000, ''],
      ['CHECK NOT YET CLEARED'],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['17/05/2023', 1001, 'Synthetic BDK old check', 'Synthetic vendor', 'Synthetic client', 87035, '', 75_000],
      ['', '', '', 'TOTAL (B)', '', '', '', 0],
      ['', '', '', 'CLOSING BALANCE', '', '', 1_000_000, ''],
    ],
    '180526',
  );

  const result = parser.parseWorkbook(workbook, '05-BDK 2026.xlsx');
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.staleOutstandingChecks.length, 1);
  assert.equal(book.staleOutstandingChecks[0].amount.value, 75_000);
  assert.equal(book.validation.calculatedTotalChecksOperational, 0);
  assert.equal(book.validation.calculatedStaleOutstandingChecksRiskTotal, 75_000);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH'), false);
});

test('keeps recent and undated outstanding checks operational', () => {
  const recent = parser.parseWorkbook(
    createChecksWorkbook([['18/05/2025', 'CHK-RECENT', 'Synthetic recent check', 100_000]], 100_000, 900_000),
    '05-BIS 2026.xlsx',
  ).books[0];
  const undated = parser.parseWorkbook(
    createChecksWorkbook([['', 'CHK-NODATE', 'Synthetic undated check', 80_000]], 80_000, 920_000),
    '05 - BICIS 2026.xlsx',
  ).books[0];

  assert.equal(recent.validation.status, 'valid');
  assert.equal(recent.checksNotYetCleared.length, 1);
  assert.equal(recent.staleOutstandingChecks.length, 0);
  assert.equal(recent.validation.calculatedTotalChecksOperational, 100_000);
  assert.equal(undated.validation.status, 'valid');
  assert.equal(undated.checksNotYetCleared.length, 1);
  assert.equal(undated.staleOutstandingChecks.length, 0);
});

test('classifies three-year-old checks stale at the report-date cutoff only', () => {
  const atCutoff = parser.parseWorkbook(
    createChecksWorkbook([['18/05/2023', 'CHK-CUTOFF', 'Synthetic cutoff check', 60_000]], 0, 1_000_000),
    '05-BIS 2026.xlsx',
  ).books[0];
  const afterCutoff = parser.parseWorkbook(
    createChecksWorkbook([['19/05/2023', 'CHK-AFTER', 'Synthetic after cutoff check', 60_000]], 60_000, 940_000),
    '05-BIS 2026.xlsx',
  ).books[0];

  assert.equal(atCutoff.validation.status, 'valid');
  assert.equal(atCutoff.staleOutstandingChecks.length, 1);
  assert.equal(afterCutoff.validation.status, 'valid');
  assert.equal(afterCutoff.checksNotYetCleared.length, 1);
  assert.equal(afterCutoff.staleOutstandingChecks.length, 0);
});

test('warns on high-risk stale administration checks without blocking the book', () => {
  const result = parser.parseWorkbook(
    createChecksWorkbook([['17/05/2023', 'CHK-DGD', 'Synthetic DOUANE regularization', 50_000]], 0, 1_000_000),
    '05-BRIDGE 2026.xlsx',
  );
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.staleOutstandingChecks.length, 1);
  assert.equal(book.validation.calculatedStaleOutstandingChecksRiskTotal, 50_000);
  assert.equal(book.validation.highRiskStaleOutstandingChecksTotal, 50_000);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'HIGH_RISK_STALE_OUTSTANDING_CHECK'), true);
});

test('accepts TOTAL(B) when it already includes prudent stale outstanding checks', () => {
  const result = parser.parseWorkbook(
    createChecksWorkbook(
      [
        ['18/05/2026', 'CHK-CURRENT', 'Synthetic current check', 100_000],
        ['17/05/2023', 'CHK-OLD', 'Synthetic old check', 50_000],
      ],
      150_000,
      850_000,
    ),
    '05-BIS 2026.xlsx',
  );
  const [book] = result.books;

  assert.equal(book.validation.status, 'valid');
  assert.equal(book.validation.calculatedTotalChecksOperational, 100_000);
  assert.equal(book.validation.calculatedTotalChecksPrudent, 150_000);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'TOTAL_B_INCLUDES_STALE_CHECKS'), true);
  assert.equal(book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH'), false);
});

test('keeps TOTAL(B) that matches neither operational nor prudent stale totals in needs review', () => {
  const result = parser.parseWorkbook(
    createChecksWorkbook(
      [
        ['18/05/2026', 'CHK-CURRENT', 'Synthetic current check', 100_000],
        ['17/05/2023', 'CHK-OLD', 'Synthetic old check', 50_000],
      ],
      123_456,
      876_544,
    ),
    '05-BIS 2026.xlsx',
  );
  const [book] = result.books;

  assert.equal(book.validation.status, 'needs_review');
  assert.equal(book.validation.issues.some((issue) => issue.code === 'A_MINUS_B_MISMATCH' && issue.section === 'totalB'), true);
});
