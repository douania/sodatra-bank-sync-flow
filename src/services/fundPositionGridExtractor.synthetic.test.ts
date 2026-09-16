import assert from 'node:assert/strict';
import test from 'node:test';

import * as XLSX from 'xlsx';

import { worksheetToGrid, type ExcelSheetGrid } from './excelSheetGrid';
import { extractFundPositionFromGrid } from './fundPositionGridExtractor';

const ACCOUNTING = '_-* #,##0\\ _€_-;\\-* #,##0\\ _€_-;_-* "-"??\\ _€_-;_-@_-';

type Cell = string | number | { date: string } | { amount: number } | { error: string } | null;

function serialOf(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function gridOf(rows: Cell[][], sheetName = '090726'): ExcelSheetGrid {
  const sheet: XLSX.WorkSheet = {};
  let maxColumn = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === null) return;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (typeof value === 'string') sheet[address] = { t: 's', v: value };
      else if (typeof value === 'number') sheet[address] = { t: 'n', v: value };
      else if ('date' in value) sheet[address] = { t: 'n', v: serialOf(value.date), z: 'm/d/yy' };
      else if ('amount' in value) sheet[address] = { t: 'n', v: value.amount, z: ACCOUNTING };
      else sheet[address] = { t: 'e', v: 23, w: value.error };
      maxColumn = Math.max(maxColumn, columnIndex);
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: maxColumn } });
  return worksheetToGrid(sheet, sheetName);
}

const A = (amount: number): Cell => ({ amount });
const D = (iso: string): Cell => ({ date: iso });

function nominal(): Cell[][] {
  return [
    [null, null, 'Bank \nBalance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', 'Grand Balance'],
    ['Book balance', 'BDK', A(100_000_000), A(0), A(100_000_000), A(0), A(100_000_000), A(-5_000_000)],
    [null, 'BIS', A(20_000_000), A(500_000), A(19_500_000), A(0), A(19_500_000)],
    [null, 'ATB-2', A(1_000_000), A(0), A(1_000_000), A(0), A(1_000_000)],
    [],
    ['Deposit for the day'],
    [null, 'BDK', null, null, null, null, A(3_000_000)],
    ['Payment for the day'],
    [null, 'BIS', null, null, null, null, A(1_000_000)],
    [],
    [null, 'TOTAL FUND AVAILABLE', A(121_000_000), A(500_000), A(120_500_000), A(0), A(120_500_000)],
    ['COLLECTION NOT DEPOSITED', null, null, null, null, null, A(7_000_000)],
    ['COMPTANT', A(7_000_000)],
    [],
    [null, null, 'HOLD'],
    ['DATE', 'n°chéque/Ech', 'BANQUE Client', 'Client', 'facture', 'Montant', 'DATE DEPOT/Nbre Jrs'],
    [D('2026-07-01'), 1234567, 'BDK', 'CLIENT A', 'FACT 1', A(400_000), -3, D('2026-07-12')],
    [D('2026-07-02'), D('2026-07-20'), 'BIS', 'CLIENT B', 'FACT 2', A(600_000), 5],
    [null, null, null, null, null, A(1_000_000)],
  ];
}

test('Fund Position tabulaire : en-tête, banques, totaux sous colonnes, blocs du jour et HOLD', () => {
  const result = extractFundPositionFromGrid(gridOf(nominal()));
  assert.equal(result.success, true, result.errors?.join(' '));
  const position = result.data!;
  assert.equal(position.reportDate, '2026-07-09');
  assert.equal(position.details?.length, 3);
  assert.deepEqual(position.details?.[0], {
    bankName: 'BDK', balance: 100_000_000, fundApplied: 0, netBalance: 100_000_000, nonValidatedDeposit: 0, grandBalance: 100_000_000,
  });
  assert.equal(position.details?.[2].bankName, 'ATB-2');
  assert.equal(position.totalFundAvailable, 120_500_000);
  assert.equal(position.grandTotal, 120_500_000);
  assert.equal(position.depositForDay, 3_000_000);
  assert.equal(position.paymentForDay, 1_000_000);
  assert.equal(position.collectionsNotDeposited, 7_000_000);
  assert.equal(position.holdCollections?.length, 2);
  assert.equal(position.holdCollections?.[0].chequeNumber, '1234567');
  assert.equal(position.holdCollections?.[0].daysRemaining, -3);
  assert.equal(position.holdCollections?.[0].depositDate, '2026-07-12');
  assert.equal(position.holdCollections?.[1].chequeNumber, '2026-07-20');
});

test('Fund Position tabulaire : la date vient du nom de feuille JJMMAA, sinon d’un libellé daté, sinon refus', () => {
  const labelled = nominal();
  labelled.unshift(['FUND POSITION 31/07/2026']);
  const fromLabel = extractFundPositionFromGrid(gridOf(labelled, 'Feuil1'));
  assert.equal(fromLabel.success, true, fromLabel.errors?.join(' '));
  assert.equal(fromLabel.data?.reportDate, '2026-07-31');

  const missing = extractFundPositionFromGrid(gridOf(nominal(), 'Feuil1'));
  assert.equal(missing.success, false);
  assert.match(missing.errors?.join(' ') ?? '', /Date Fund Position/);
});

test('Fund Position tabulaire refuse cellule d’erreur, montant vide, total absent, HOLD incohérent', () => {
  const errorCell = nominal();
  errorCell[10][6] = { error: '#REF!' };
  const errorResult = extractFundPositionFromGrid(gridOf(errorCell));
  assert.equal(errorResult.success, false);
  assert.match(errorResult.errors?.join(' ') ?? '', /erreur Excel/);

  const emptyCell = nominal();
  emptyCell[2][5] = null;
  assert.equal(extractFundPositionFromGrid(gridOf(emptyCell)).success, false);

  const noTotal = nominal();
  noTotal[10] = [];
  const noTotalResult = extractFundPositionFromGrid(gridOf(noTotal));
  assert.equal(noTotalResult.success, false);
  assert.match(noTotalResult.errors?.join(' ') ?? '', /TOTAL FUND AVAILABLE/);

  const holdMismatch = nominal();
  holdMismatch[18] = [null, null, null, null, null, A(999)];
  const holdResult = extractFundPositionFromGrid(gridOf(holdMismatch));
  assert.equal(holdResult.success, false);
  assert.match(holdResult.errors?.join(' ') ?? '', /HOLD/);

  const noHeader = nominal();
  noHeader[0] = [];
  assert.equal(extractFundPositionFromGrid(gridOf(noHeader)).success, false);
});

test('Fund Position tabulaire : sans colonne Grand Balance, le document est refusé sans valeur dérivée', () => {
  const rows = nominal();
  rows[0] = [null, null, 'Bank \nBalance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit'];
  const result = extractFundPositionFromGrid(gridOf(rows));
  assert.equal(result.success, false);
  assert.match(result.errors?.join(' ') ?? '', /Colonne Grand Balance absente/);
});

test('Fund Position tabulaire : HOLD lit le montant dans la colonne MONTANT et tolère jours et date de dépôt absents', () => {
  const rows = nominal();
  rows[16] = [D('2026-07-01'), 1234567, 'BDK', 'CLIENT A', 'FACT 1', A(400_000), A(-3)];
  rows[17] = [D('2026-07-02'), 7654321, 'BIS', 'CLIENT B', 'FACT 2', A(600_000)];
  const result = extractFundPositionFromGrid(gridOf(rows));
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.holdCollections?.[0].amount, 400_000, 'la colonne des jours formatée n’est pas le montant');
  assert.equal(result.data?.holdCollections?.[0].daysRemaining, -3);
  assert.equal(result.data?.holdCollections?.[1].daysRemaining, undefined);
  assert.equal(result.data?.holdCollections?.[1].depositDate, undefined);
});

test('Fund Position tabulaire : aucune donnée financière brute ne fuit dans les erreurs de ligne', () => {
  const decimal = nominal();
  decimal[1][2] = { amount: 100.5 };
  const result = extractFundPositionFromGrid(gridOf(decimal));
  assert.equal(result.success, false);
  assert.doesNotMatch(result.errors?.join(' ') ?? '', /100\.5/);
});
