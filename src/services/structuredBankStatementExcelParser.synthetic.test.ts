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

// Scénarios « montant textuel malformé » et « sonde DEF-19 » : chaque profil
// est exercé avec son conteneur autorisé (BICIS → XLS, BRIDGE → XLSX), jamais
// en renommant un conteneur. Un témoin valide, même profil et même conteneur,
// prouve que le scénario atteint l'analyse métier et non un refus amont.
interface AmountScenario {
  name: string;
  container: BookType;
  file: string;
  bank: 'BICIS' | 'BRIDGE';
  workbook: () => XLSX.WorkBook;
  /** Cellule de montant visée. */
  address: string;
  /** Index de ligne (0-based) de cette cellule dans la feuille. */
  rowIndex: number;
  /** Erreur attendue quand la cellule porte un montant textuel malformé. */
  malformedError: RegExp;
}

const AMOUNT_SCENARIOS: readonly AmountScenario[] = [
  {
    name: 'BICIS signed amount, XLS container',
    container: 'xls',
    file: 'SYNTHETIC BICIS ONLINE.xls',
    bank: 'BICIS',
    workbook: bicisWorkbook,
    address: 'D9',
    rowIndex: 8,
    malformedError: /requires one non-zero signed amount/i,
  },
  {
    name: 'BRIDGE split credit, XLSX container',
    container: 'xlsx',
    file: 'SYNTHETIC BRIDGE ONLINE.xlsx',
    bank: 'BRIDGE',
    workbook: bridgeWorkbook,
    address: 'F3',
    rowIndex: 2,
    malformedError: /invalid debit or credit amount/i,
  },
  {
    name: 'BRIDGE split debit, XLSX container',
    container: 'xlsx',
    file: 'SYNTHETIC BRIDGE ONLINE.xlsx',
    bank: 'BRIDGE',
    workbook: bridgeWorkbook,
    address: 'E2',
    rowIndex: 1,
    malformedError: /invalid debit or credit amount/i,
  },
];

const MALFORMED_TEXT_AMOUNTS = ['1-000', '12,34.56', '100 debit', '90071992547409.91'] as const;

/** Type et valeur de la cellule réellement soumise au parser, après sérialisation puis relecture. */
function rereadCell(bytes: ArrayBuffer, address: string): { t?: string; v?: unknown; w?: string } | undefined {
  const workbook = XLSX.read(bytes, { type: 'array', raw: true });
  const cell = workbook.Sheets[workbook.SheetNames[0]][address] as XLSX.CellObject | undefined;
  return cell ? { t: cell.t, v: cell.v, w: cell.w } : undefined;
}

function assertWitnessReachesBusinessAnalysis(scenario: AmountScenario): void {
  const witness = parseStructuredBankStatementExcel(workbookBytes(scenario.workbook(), scenario.container), {
    sourceFileName: scenario.file,
    expectedBank: scenario.bank,
  });
  assert.notEqual(witness.validation.status, 'invalid', `${scenario.name}: witness must not be refused (${witness.errors.join(' ')})`);
  assert.notEqual(witness.validation.status, 'unsupported', `${scenario.name}: witness must match its profile`);
  assert.equal(witness.bankHint, scenario.bank, `${scenario.name}: witness must resolve the expected profile`);
  assert.equal(witness.lines.length, 2, `${scenario.name}: witness must yield both synthetic lines`);
}

test('refuses malformed or precision-unsafe textual amounts', () => {
  for (const scenario of AMOUNT_SCENARIOS) {
    assertWitnessReachesBusinessAnalysis(scenario);

    for (const unsafeAmount of MALFORMED_TEXT_AMOUNTS) {
      const label = `${scenario.name} / ${unsafeAmount}`;
      const workbook = scenario.workbook();
      // Cellule de texte réelle (t:'s'). La forme incohérente (t:'n' portant une
      // chaîne) est couverte par le scénario DEF-19 dédié plus bas.
      workbook.Sheets[workbook.SheetNames[0]][scenario.address] = { t: 's', v: unsafeAmount };
      const bytes = workbookBytes(workbook, scenario.container);

      const submitted = rereadCell(bytes, scenario.address);
      assert.equal(submitted?.t, 's', `${label}: a real text cell must reach the parser (observed ${submitted?.t})`);
      assert.equal(submitted?.v, unsafeAmount, `${label}: the text must survive serialization unchanged`);

      const result = parseStructuredBankStatementExcel(bytes, {
        sourceFileName: scenario.file,
        expectedBank: scenario.bank,
      });
      assert.equal(result.validation.status, 'invalid', label);
      assert.match(result.errors.join(' '), scenario.malformedError, label);
      assert.doesNotMatch(result.errors.join(' '), /container signature|error cell/i, `${label}: refusal must come from the amount, not from an upstream gate`);
      assert.ok(
        result.lines.every((line) => line.sourceRowIndex !== scenario.rowIndex),
        `${label}: the malformed row must not yield a financial line`,
      );
      assert.ok(!result.lines.some((line) => line.signedAmount === 36), label);
    }
  }
});

// --- PACK 0 / GO_FIX_PACK_0 — DEF-19 : cellules d'erreur Excel -----------------

type ExcelErrorCode = { code: number; label: string };
const EXCEL_ERROR_CODES: readonly ExcelErrorCode[] = [
  { code: 0, label: '#NULL!' },
  { code: 7, label: '#DIV/0!' },
  { code: 15, label: '#VALUE!' },
  { code: 23, label: '#REF!' },
  { code: 29, label: '#NAME?' },
  { code: 36, label: '#NUM!' },
  { code: 42, label: '#N/A' },
];

function setErrorCell(workbook: XLSX.WorkBook, address: string, error: ExcelErrorCode): void {
  workbook.Sheets[workbook.SheetNames[0]][address] = { t: 'e', v: error.code, w: error.label };
}

function assertRefusedForErrorCell(
  result: ReturnType<typeof parseStructuredBankStatementExcel>,
  address: string,
  label: string,
): void {
  assert.equal(result.validation.status, 'invalid', label);
  assert.equal(result.lines.length, 0, `${label}: an error cell must never yield a financial line`);
  assert.match(result.errors.join(' '), /error cell/i, label);
  assert.match(result.errors.join(' '), new RegExp(address), `${label}: the refusal names the cell`);
  assert.notEqual(result.validation.status, 'needs_review', label);
}

test('refuses every Excel error code in the BICIS amount column before any extraction (XLS)', () => {
  for (const error of EXCEL_ERROR_CODES) {
    const workbook = bicisWorkbook();
    setErrorCell(workbook, 'D9', error);
    const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
      sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
      expectedBank: 'BICIS',
    });
    assertRefusedForErrorCell(result, 'D9', `BICIS amount ${error.label}`);
  }
});

test('refuses error cells in signed amount, balance and date columns (ATB/BICIS, XLS)', () => {
  const cases: Array<{ name: string; workbook: () => XLSX.WorkBook; file: string; bank: 'ATB' | 'BICIS'; address: string; error: ExcelErrorCode }> = [
    { name: 'BICIS balance', workbook: bicisWorkbook, file: 'SYNTHETIC BICIS ONLINE.xls', bank: 'BICIS', address: 'F9', error: EXCEL_ERROR_CODES[1] },
    { name: 'BICIS operation date', workbook: bicisWorkbook, file: 'SYNTHETIC BICIS ONLINE.xls', bank: 'BICIS', address: 'A9', error: EXCEL_ERROR_CODES[2] },
    { name: 'BICIS value date', workbook: bicisWorkbook, file: 'SYNTHETIC BICIS ONLINE.xls', bank: 'BICIS', address: 'B10', error: EXCEL_ERROR_CODES[5] },
    { name: 'ATB amount', workbook: atbWorkbook, file: 'SYNTHETIC ATB ONLINE.xls', bank: 'ATB', address: 'D8', error: EXCEL_ERROR_CODES[5] },
    { name: 'ATB balance', workbook: atbWorkbook, file: 'SYNTHETIC ATB ONLINE.xls', bank: 'ATB', address: 'E9', error: EXCEL_ERROR_CODES[1] },
  ];
  for (const testCase of cases) {
    const workbook = testCase.workbook();
    setErrorCell(workbook, testCase.address, testCase.error);
    const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
      sourceFileName: testCase.file,
      expectedBank: testCase.bank,
    });
    assertRefusedForErrorCell(result, testCase.address, `${testCase.name} ${testCase.error.label}`);
  }
});

test('refuses error cells in split debit/credit and balance columns (BIS XLS, BRIDGE XLSX)', () => {
  const bisCases = [
    { address: 'K12', error: EXCEL_ERROR_CODES[5] },   // débit
    { address: 'M13', error: EXCEL_ERROR_CODES[1] },   // crédit
    { address: 'O12', error: EXCEL_ERROR_CODES[2] },   // solde
    { address: 'B13', error: EXCEL_ERROR_CODES[6] },   // date opération
  ];
  for (const bisCase of bisCases) {
    const workbook = bisWorkbook();
    setErrorCell(workbook, bisCase.address, bisCase.error);
    const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
      sourceFileName: 'SYNTHETIC BIS ONLINE.xls',
      expectedBank: 'BIS',
    });
    assertRefusedForErrorCell(result, bisCase.address, `BIS ${bisCase.address} ${bisCase.error.label}`);
  }

  const bridgeCases = [
    { address: 'E2', error: EXCEL_ERROR_CODES[5] },    // débit
    { address: 'F3', error: EXCEL_ERROR_CODES[1] },    // crédit
    { address: 'G3', error: EXCEL_ERROR_CODES[3] },    // solde courant
    { address: 'A2', error: EXCEL_ERROR_CODES[4] },    // date opération
  ];
  for (const bridgeCase of bridgeCases) {
    const workbook = bridgeWorkbook();
    setErrorCell(workbook, bridgeCase.address, bridgeCase.error);
    const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xlsx'), {
      sourceFileName: 'SYNTHETIC BRIDGE ONLINE.xlsx',
      expectedBank: 'BRIDGE',
    });
    assertRefusedForErrorCell(result, bridgeCase.address, `BRIDGE ${bridgeCase.address} ${bridgeCase.error.label}`);
  }
});

test('legitimate numeric values equal to Excel error codes remain accepted unchanged', () => {
  for (const legitimate of [36, 7, 42]) {
    const workbook = bicisWorkbook();
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const amount = sheet.D9;
    amount.t = 'n';
    amount.v = legitimate;
    delete amount.w;
    // La chaîne de soldes suit le montant légitime : 900 + montant.
    sheet.F9 = { t: 'n', v: 900 + legitimate };
    const result = parseStructuredBankStatementExcel(workbookBytes(workbook, 'xls'), {
      sourceFileName: 'SYNTHETIC BICIS ONLINE.xls',
      expectedBank: 'BICIS',
    });
    assert.equal(result.validation.status, 'valid', `numeric ${legitimate}: ${result.errors.join(' ')} ${result.warnings.join(' ')}`);
    assert.deepEqual(result.lines.map((line) => line.signedAmount), [-100, legitimate]);
    assert.deepEqual(result.lines.map((line) => line.balance), [900, 900 + legitimate]);
  }

  const bis = bisWorkbook();
  const bisSheet = bis.Sheets[bis.SheetNames[0]];
  bisSheet.M12 = { t: 'n', v: 36 };
  bisSheet.O12 = { t: 's', v: '936 Créditeur' };
  const bisResult = parseStructuredBankStatementExcel(workbookBytes(bis, 'xls'), {
    sourceFileName: 'SYNTHETIC BIS ONLINE.xls',
    expectedBank: 'BIS',
  });
  assert.equal(bisResult.validation.status, 'valid', `${bisResult.errors.join(' ')} ${bisResult.warnings.join(' ')}`);
  assert.deepEqual(bisResult.lines.map((line) => line.signedAmount), [-100, 36]);
});

test('DEF-19 discovery scenario: an inconsistent numeric cell carrying a string never becomes a financial line', () => {
  // Sonde ayant révélé le défaut : `xlsx@0.18.5` écrivait cette cellule
  // incohérente (t:'n' portant une chaîne) en NaN, `xlsx@0.20.3` en cellule
  // d'erreur #NUM! ; le parser lisait alors le code d'erreur comme montant 36
  // et produisait `needs_review`. Le type réellement obtenu après
  // sérialisation/relecture est vérifié pour connaître le cas soumis au parser.
  for (const scenario of AMOUNT_SCENARIOS) {
    assertWitnessReachesBusinessAnalysis(scenario);

    for (const unsafeAmount of ['1-000', '12,34.56', '100 debit'] as const) {
      const label = `${scenario.name} / ${unsafeAmount}`;
      const workbook = scenario.workbook();
      workbook.Sheets[workbook.SheetNames[0]][scenario.address] = { t: 'n', v: unsafeAmount as unknown as number };
      const bytes = workbookBytes(workbook, scenario.container);

      const submitted = rereadCell(bytes, scenario.address);
      assert.equal(
        submitted?.t,
        'e',
        `${label}: with the pinned xlsx, the inconsistent cell must be serialized as an Excel error cell (observed ${submitted?.t}, ${String(submitted?.w)})`,
      );

      const result = parseStructuredBankStatementExcel(bytes, {
        sourceFileName: scenario.file,
        expectedBank: scenario.bank,
      });
      assert.equal(result.validation.status, 'invalid', label);
      assert.notEqual(result.validation.status, 'needs_review', label);
      assert.match(result.errors.join(' '), /error cell/i, `${label}: refusal must name the Excel error cell`);
      assert.match(result.errors.join(' '), new RegExp(scenario.address), `${label}: refusal must name the cell`);
      assert.doesNotMatch(result.errors.join(' '), /container signature/i, label);
      assert.equal(result.lines.length, 0, `${label}: no financial line`);
      assert.ok(
        !result.lines.some((line) => line.signedAmount === 36),
        `${label}: the error code must never be read as an amount`,
      );
    }
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

// Lot 1 opérationnel (R6 § 4.2) : causes possibles du statut needs_review, par
// version exacte de profil, miroir de treasury_private.parser_versions. Une
// nouvelle version ou une nouvelle cause fait échouer ce test : la liste blanche
// de la trésorerie doit alors être revue (canal opérateur), jamais devinée.
test('freezes the needs_review causes of every Excel profile version (treasury whitelist mirror)', async () => {
  const { readFileSync } = await import('node:fs');
  const { STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES } = await import('./structuredBankStatementExcelProfiles');
  const parserSource = readFileSync('src/services/structuredBankStatementExcelParser.ts', 'utf8');
  const emitted = [...parserSource.matchAll(/reviewReasonCodes\.push\('([A-Z_]+)'\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(emitted, ['RUNNING_BALANCE_CHAIN_INCOHERENT', 'RUNNING_BALANCE_MISSING', 'TRUSTED_CURRENCY_UNCORROBORATED']);

  const migration = readFileSync('supabase/migrations/20261103130000_treasury_v1_lot1_operational_fix.sql', 'utf8');
  const seeded = new Map([...migration.matchAll(
    /\('(ATB|BICIS|BIS|BRIDGE)', '(structured_bank_statement_xlsx?)', '(structured-excel-0q\/[a-z0-9-]+)', (true|false),/g,
  )].map((match) => [match[3], { bank: match[1], sourceFormat: match[2], currencyCause: match[4] === 'true' }]));
  assert.equal(seeded.size, STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES.length, 'one whitelisted version per profile');
  const expected: Record<string, string[]> = {
    'structured-excel-0q/atb-online-xls-v1': ['RUNNING_BALANCE_CHAIN_INCOHERENT', 'RUNNING_BALANCE_MISSING'],
    'structured-excel-0q/bicis-online-xls-v1': ['RUNNING_BALANCE_CHAIN_INCOHERENT', 'RUNNING_BALANCE_MISSING'],
    'structured-excel-0q/bis-online-xls-v1': ['RUNNING_BALANCE_CHAIN_INCOHERENT', 'RUNNING_BALANCE_MISSING'],
    'structured-excel-0q/bridge-online-xlsx-v1': ['RUNNING_BALANCE_CHAIN_INCOHERENT', 'RUNNING_BALANCE_MISSING',
      'TRUSTED_CURRENCY_UNCORROBORATED'],
  };
  for (const profile of STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES) {
    const version = `structured-excel-0q/${profile.version}`;
    // La devise n'est une cause possible que sans colonne de devise ni devise fixe du profil.
    const currencyCause = !('currency' in profile.columns) && !('fixedCurrency' in profile);
    const causes = ['RUNNING_BALANCE_CHAIN_INCOHERENT', 'RUNNING_BALANCE_MISSING',
      ...(currencyCause ? ['TRUSTED_CURRENCY_UNCORROBORATED'] : [])];
    assert.deepEqual(causes, expected[version], version);
    assert.equal(seeded.get(version)?.bank, profile.bank, version);
    assert.equal(seeded.get(version)?.currencyCause, currencyCause, `${version} currency cause`);
  }
  // Observé : ATB sans cause, BRIDGE avec la seule devise.
  const atb = parseStructuredBankStatementExcel(workbookBytes(atbWorkbook(), 'xls'), {
    sourceFileName: 'SYNTHETIC ATB ONLINE.xls', expectedBank: 'ATB',
  });
  assert.deepEqual(atb.reviewReasonCodes, []);
  const bridge = parseStructuredBankStatementExcel(workbookBytes(bridgeWorkbook(), 'xlsx'), {
    sourceFileName: 'SYNTHETIC BRIDGE ONLINE.xlsx', expectedBank: 'BRIDGE',
  });
  assert.deepEqual(bridge.reviewReasonCodes, ['TRUSTED_CURRENCY_UNCORROBORATED']);
});
