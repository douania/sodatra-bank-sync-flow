import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseStructuredBankStatementExcel } from './structuredBankStatementExcelParser';

type BookType = 'xls' | 'xlsx';

function workbookFromRows(rows: unknown[][], sheetName = 'SYNTHETIC'): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return workbook;
}

function workbookBytes(workbook: XLSX.WorkBook, bookType: BookType): ArrayBuffer {
  const written = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer | Uint8Array;
  if (written instanceof ArrayBuffer) return written;
  return written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
}

function excelSerial(day: number, month: number, year: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function excel1904Serial(day: number, month: number, year: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1904, 0, 1)) / 86_400_000);
}

function atbWorkbook(): XLSX.WorkBook {
  return workbookFromRows([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [],
    ['Référence', "Date de l'opération", 'Date Valeur', 'Montant', 'Solde', 'Devise', 'Libellé'],
    ['SYN-002', excelSerial(9, 7, 2026), excelSerial(9, 7, 2026), '200', '1,100', 'XOF', 'SYNTHETIC CREDIT'],
    ['SYN-001', excelSerial(9, 7, 2026), excelSerial(9, 7, 2026), '-100', '900', 'XOF', 'SYNTHETIC DEBIT'],
  ]);
}

function bicisWorkbook(): XLSX.WorkBook {
  return workbookFromRows([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [], [],
    ['Date Opération', 'Date Valeur', 'Référence', 'Montant', 'Libellé', 'Solde', 'Devise'],
    ['09/07/2026', '09/07/2026', 'SYN-002', 200, 'SYNTHETIC CREDIT', 1100, 'XOF'],
    ['09/07/2026', '09/07/2026', 'SYN-001', -100, 'SYNTHETIC DEBIT', 900, 'XOF'],
  ]);
}

function bisWorkbook(rows?: unknown[][]): XLSX.WorkBook {
  const header = new Array(15).fill('');
  header[1] = "Date de l'opération commerciale";
  header[3] = 'Date de valeur';
  header[5] = 'Description';
  header[10] = 'Débit(XOF)';
  header[12] = 'Crédit(XOF)';
  header[14] = 'Solde';

  const latest = new Array(15).fill('');
  latest[1] = '09/07/2026';
  latest[3] = '09/07/2026';
  latest[5] = 'SYNTHETIC CREDIT';
  latest[10] = 0;
  latest[12] = 200;
  latest[14] = '1,100 Créditeur';

  const earliest = new Array(15).fill('');
  earliest[1] = '09/07/2026';
  earliest[3] = '09/07/2026';
  earliest[5] = 'SYNTHETIC DEBIT';
  earliest[10] = 100;
  earliest[12] = 0;
  earliest[14] = '900 Créditeur';

  return workbookFromRows([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [], [], [], [], [],
    header,
    ...(rows ?? [latest, earliest]),
  ]);
}

function bridgeWorkbook(): XLSX.WorkBook {
  return workbookFromRows([
    ['Date Operation', 'Description', 'Reference', 'Date Valeur', 'Debit', 'Credit', ''],
    ['09 Jul 2026', 'SYNTHETIC DEBIT', 'SYN-001', '09 Jul 2026', '100', '', '900'],
    ['09 Jul 2026', 'SYNTHETIC CREDIT', 'SYN-002', '09 Jul 2026', '', '200', '1,100'],
  ]);
}

test('parses the exact ATB ONLINE signed-amount profile and restores chronological order', () => {
  const result = parseStructuredBankStatementExcel(workbookBytes(atbWorkbook(), 'xls'), {
    sourceFileName: 'SYNTHETIC ATB ONLINE.xls',
    expectedBank: 'ATB',
  });

  assert.equal(result.validation.status, 'valid');
  assert.equal(result.bankHint, 'ATB');
  assert.equal(result.currency, 'XOF');
  assert.deepEqual(result.lines.map((line) => line.signedAmount), [-100, 200]);
  assert.deepEqual(result.lines.map((line) => line.balance), [900, 1100]);
  assert.equal(result.validation.lineBalancesConsistent, true);
});

test('parses the exact BICIS ONLINE signed-amount profile', () => {
  const result = parseStructuredBankStatementExcel(workbookBytes(bicisWorkbook(), 'xls'), {
    sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
    expectedBank: 'BICIS',
  });

  assert.equal(result.validation.status, 'valid');
  assert.equal(result.bankHint, 'BICIS');
  assert.deepEqual(result.lines.map((line) => line.direction), ['debit', 'credit']);
  assert.equal(result.periodStart, '09/07/2026');
  assert.equal(result.periodEnd, '09/07/2026');
});

test('converts the Excel 1904 date system without timezone-dependent shifts', () => {
  const workbook = atbWorkbook();
  for (const address of ['B8', 'C8', 'B9', 'C9']) {
    workbook.Sheets[workbook.SheetNames[0]][address].v = excel1904Serial(9, 7, 2026);
  }
  workbook.Workbook = {
    ...(workbook.Workbook ?? {}),
    WBProps: { ...(workbook.Workbook?.WBProps ?? {}), date1904: true },
  };
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
    sourceFileName: 'SYNTHETIC ATB ONLINE.xls',
    expectedBank: 'ATB',
  });

  assert.equal(result.validation.status, 'valid');
  assert.equal(result.periodStart, '09/07/2026');
});

test('parses BIS split amounts, zero placeholders and creditor/debtor balance suffixes', () => {
  const result = parseStructuredBankStatementExcel(workbookBytes(bisWorkbook(), 'xls'), {
    sourceFileName: 'SYNTHETIC BIS ONLINE.xls',
    expectedBank: 'BIS',
  });

  assert.equal(result.validation.status, 'valid');
  assert.equal(result.currency, 'XOF');
  assert.deepEqual(result.lines.map((line) => line.signedAmount), [-100, 200]);
  assert.deepEqual(result.lines.map((line) => line.balance), [900, 1100]);
});

test('parses BRIDGE word dates and the characterized unlabeled running-balance column', () => {
  const result = parseStructuredBankStatementExcel(workbookBytes(bridgeWorkbook(), 'xlsx'), {
    sourceFileName: 'SYNTHETIC BRIDGE ONLINE.xlsx',
    expectedBank: 'BRIDGE',
  });

  assert.equal(result.validation.status, 'needs_review');
  assert.equal(result.bankHint, 'BRIDGE');
  assert.equal(result.currency, undefined);
  assert.deepEqual(result.lines.map((line) => line.signedAmount), [-100, 200]);
  assert.equal(result.validation.lineBalancesConsistent, true);
  assert.match(result.warnings.join(' '), /trusted operator currency/i);
  assert.deepEqual(result.reviewReasonCodes, ['TRUSTED_CURRENCY_UNCORROBORATED']);
});

test('refuses generic Internal Book-shaped workbooks on the statement path', () => {
  const workbook = workbookFromRows([
    ['OPENING BALANCE', 1000],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ['09/07/2026', 'SYN-001', 'SYNTHETIC INTERNAL ITEM', 100],
    ['CLOSING BALANCE', 900],
  ]);
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xlsx'), {
    sourceFileName: 'SYNTHETIC INTERNAL BOOK.xlsx',
  });

  assert.equal(result.validation.status, 'unsupported');
  assert.equal(result.lines.length, 0);
  assert.match(result.errors.join(' '), /Internal Book workbooks are refused/i);
});

test('refuses formulas before extracting any transaction', () => {
  const workbook = bridgeWorkbook();
  workbook.Sheets[workbook.SheetNames[0]].G2.f = 'E2-F2';
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xlsx'), {
    sourceFileName: 'SYNTHETIC BRIDGE ONLINE.xlsx',
    expectedBank: 'BRIDGE',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.equal(result.lines.length, 0);
  assert.match(result.errors.join(' '), /contains formulas/i);
});

test('refuses multiple non-empty worksheets on the one-account statement path', () => {
  const workbook = atbWorkbook();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['SYNTHETIC NOTES']]), 'NOTES');
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
    sourceFileName: 'SYNTHETIC ATB ONLINE.xls',
    expectedBank: 'ATB',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.match(result.errors.join(' '), /Multiple non-empty worksheets/i);
});

test('refuses a trusted-bank/profile mismatch', () => {
  const result = parseStructuredBankStatementExcel(workbookBytes(atbWorkbook(), 'xls'), {
    sourceFileName: 'SYNTHETIC ATB ONLINE.xls',
    expectedBank: 'BICIS',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.match(result.errors.join(' '), /does not match the detected Excel profile/i);
});

test('fails closed when a numeric amount cannot round-trip through safe integer cents', () => {
  const workbook = bicisWorkbook();
  workbook.Sheets[workbook.SheetNames[0]].D9.v = 100_000_000_000_000;
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
    sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
    expectedBank: 'BICIS',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.match(result.errors.join(' '), /non-zero signed amount/i);
});

test('refuses malformed or precision-unsafe textual amounts', () => {
  for (const unsafeAmount of ['1-000', '12,34.56', '100 debit', '90071992547409.91']) {
    const workbook = bicisWorkbook();
    workbook.Sheets[workbook.SheetNames[0]].D9.v = unsafeAmount;
    const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
      sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
      expectedBank: 'BICIS',
    });

    assert.equal(result.validation.status, 'invalid');
    assert.match(result.errors.join(' '), /non-zero signed amount/i);
  }
});

test('does not silently skip a described row when both its date and amount are malformed', () => {
  const workbook = bicisWorkbook();
  XLSX.utils.sheet_add_aoa(
    workbook.Sheets[workbook.SheetNames[0]],
    [['NOT-A-DATE', 'NOT-A-DATE', 'SYN-003', 'NOT-AN-AMOUNT', 'SYNTHETIC MALFORMED', '', 'XOF']],
    { origin: 'A10' },
  );
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
    sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
    expectedBank: 'BICIS',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.match(result.errors.join(' '), /looks transactional but has an invalid operation date/i);
});

test('does not silently skip a referenced row with malformed date and amount', () => {
  const workbook = bicisWorkbook();
  XLSX.utils.sheet_add_aoa(
    workbook.Sheets[workbook.SheetNames[0]],
    [['NOT-A-DATE', 'NOT-A-DATE', 'SYN-003', 'NOT-AN-AMOUNT', '', '', 'XOF']],
    { origin: 'A10' },
  );
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
    sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
    expectedBank: 'BICIS',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.match(result.errors.join(' '), /looks transactional but has an invalid operation date/i);
});

test('refuses two account identifiers supplied in adjacent pre-header cells', () => {
  const workbook = bicisWorkbook();
  XLSX.utils.sheet_add_aoa(
    workbook.Sheets[workbook.SheetNames[0]],
    [['Compte', '11111111'], ['Compte', '22222222']],
    { origin: 'A2' },
  );
  const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
    sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
    expectedBank: 'BICIS',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.match(result.errors.join(' '), /Multiple account identifiers/i);
});

test('refuses an XLSX container presented to the exported parser as XLS', () => {
  const result = parseStructuredBankStatementExcel(workbookBytes(bicisWorkbook(), 'xlsx'), {
    sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
    expectedBank: 'BICIS',
  });

  assert.equal(result.validation.status, 'invalid');
  assert.match(result.errors.join(' '), /does not match the Excel container signature/i);
});
