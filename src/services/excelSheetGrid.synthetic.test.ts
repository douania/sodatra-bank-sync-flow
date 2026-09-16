import assert from 'node:assert/strict';
import test from 'node:test';

import * as XLSX from 'xlsx';

import {
  ExcelSheetSelectionError,
  excelSerialToIsoDate,
  isFormattedAmountCell,
  listWorkbookSheetNames,
  readSelectedSheetGrid,
  resolveSelectedSheetName,
  sheetGridToText,
  worksheetToGrid,
} from './excelSheetGrid';

const ACCOUNTING = '_-* #,##0\\ _€_-;\\-* #,##0\\ _€_-;_-* "-"??\\ _€_-;_-@_-';

function workbookBytes(sheets: Record<string, XLSX.WorkSheet>, bookType: XLSX.BookType = 'xlsx'): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, sheet, name);
  return new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType, cellDates: false }));
}

test('la sélection de feuille est explicite : une feuille implicite, plusieurs feuilles exigent un nom', () => {
  assert.equal(resolveSelectedSheetName(['090726'], undefined), '090726');
  assert.equal(resolveSelectedSheetName(['090726', '100726'], '100726'), '100726');
  assert.throws(
    () => resolveSelectedSheetName(['090726', '100726'], undefined),
    (error: unknown) => error instanceof ExcelSheetSelectionError && error.code === 'SHEET_SELECTION_REQUIRED',
  );
  assert.throws(
    () => resolveSelectedSheetName(['090726'], 'ABSENTE'),
    (error: unknown) => error instanceof ExcelSheetSelectionError && error.code === 'SHEET_NOT_FOUND',
  );
  assert.throws(
    () => resolveSelectedSheetName([], undefined),
    (error: unknown) => error instanceof ExcelSheetSelectionError && error.code === 'WORKBOOK_WITHOUT_SHEET',
  );
});

test('les noms de feuilles sont listés sans analyser les cellules et une seule feuille est convertie', () => {
  const bytes = workbookBytes({
    A: XLSX.utils.aoa_to_sheet([['A1']]),
    B: XLSX.utils.aoa_to_sheet([['B1', 42]]),
    C: XLSX.utils.aoa_to_sheet([['C1']]),
  });
  assert.deepEqual(listWorkbookSheetNames(bytes), ['A', 'B', 'C']);
  const grid = readSelectedSheetGrid(bytes, 'B');
  assert.equal(grid.sheetName, 'B');
  assert.equal(grid.usedRowCount, 1);
  assert.equal(grid.usedColumnCount, 2);
  assert.equal(grid.rows[0][0].text, 'B1');
  assert.equal(grid.rows[0][1].number, 42);
  assert.throws(() => readSelectedSheetGrid(bytes, 'Z'), (error: unknown) => (
    error instanceof ExcelSheetSelectionError && error.code === 'SHEET_NOT_FOUND'
  ));
});

test('une cellule date est convertie depuis son numéro de série, jamais depuis son rendu m/d/yy', () => {
  assert.equal(excelSerialToIsoDate(46212), '2026-07-09');
  assert.equal(excelSerialToIsoDate(0), null);
  const sheet = XLSX.utils.aoa_to_sheet([['x']]);
  sheet.A1 = { t: 'n', v: 46212, z: 'm/d/yy' };
  sheet.B1 = { t: 'n', v: 1234567, z: ACCOUNTING };
  sheet.C1 = { t: 'n', v: 999999, z: 'General' };
  sheet.D1 = { t: 'n', v: 100.5 };
  sheet['!ref'] = 'A1:D1';
  const grid = worksheetToGrid(sheet, 'S');
  assert.equal(grid.rows[0][0].kind, 'date');
  assert.equal(grid.rows[0][0].isoDate, '2026-07-09');
  assert.equal(grid.rows[0][0].text, '2026-07-09');
  assert.equal(isFormattedAmountCell(grid.rows[0][1]), true);
  assert.equal(isFormattedAmountCell(grid.rows[0][2]), false);
  assert.equal(grid.rows[0][3].number, 100.5);
  assert.equal(sheetGridToText(grid), '2026-07-09\t1234567\t999999\t100.5\n');
});

test('la grille est bornée par les cellules présentes et non par la plage déclarée de 16 384 colonnes', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['BIS', 1], ['ligne', 2]]);
  sheet['!ref'] = 'A1:XFD2';
  const grid = worksheetToGrid(sheet, 'S');
  assert.equal(grid.usedColumnCount, 2);
  assert.equal(grid.usedRowCount, 2);

  // Une cellule parasite au-delà de la 512e colonne est comptée, jamais lue ni parcourue.
  const farCell = XLSX.utils.aoa_to_sheet([['BIS', 1]]);
  farCell.XFD1 = { t: 'n', v: 46212, z: 'm/d/yy' };
  farCell.XFD2 = { t: 's', v: 'parasite' };
  farCell['!ref'] = 'A1:XFD2';
  const farGrid = worksheetToGrid(farCell, 'S');
  assert.equal(farGrid.usedColumnCount, 2);
  assert.equal(farGrid.usedRowCount, 1);
  assert.equal(farGrid.ignoredFarCellCount, 2);

  const tooManyRows = XLSX.utils.aoa_to_sheet([['BIS']]);
  tooManyRows.A20001 = { t: 'n', v: 1 };
  tooManyRows['!ref'] = 'A1:A20001';
  assert.throws(() => worksheetToGrid(tooManyRows, 'S'), (error: unknown) => (
    error instanceof ExcelSheetSelectionError && error.code === 'SHEET_LIMIT_EXCEEDED'
  ));
});

test('les cellules d’erreur Excel sont conservées comme erreurs et comptées', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['x']]);
  sheet.A1 = { t: 'e', v: 23, w: '#REF!' };
  sheet['!ref'] = 'A1:A1';
  const grid = worksheetToGrid(sheet, 'S');
  assert.equal(grid.rows[0][0].kind, 'error');
  assert.equal(grid.errorCellCount, 1);
});

test('un classeur XLS est lu avec les mêmes règles', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['BDK', 5]]);
  sheet.B1 = { t: 'n', v: 46212, z: 'm/d/yy' };
  const bytes = workbookBytes({ ONLY: sheet }, 'xls');
  const grid = readSelectedSheetGrid(bytes, 'ONLY');
  assert.equal(grid.rows[0][0].text, 'BDK');
  assert.equal(grid.rows[0][1].isoDate, '2026-07-09');
});
