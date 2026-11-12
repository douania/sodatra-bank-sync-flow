import assert from 'node:assert/strict';
import test from 'node:test';

import { readMonthlyWorkbook } from './monthlyWorkbook';
import { monthlyWorkbookBytes, sheetFromRows, tabName, workbookBytes } from './situationSyntheticFixtures';
import type { SyntheticTab } from './situationSyntheticFixtures';

const D = '2026-06-03';
const TODAY = '2026-06-05';

function tab(labelDate: string, name: string, overrides: Partial<SyntheticTab> = {}): SyntheticTab {
  return {
    name,
    labelDate,
    titleBank: 'BDK',
    opening: 10_000,
    deposits: [{ date: labelDate, dueDate: '2026-09-15', client: 'SYNTHETIC CLIENT A', amount: 700 }],
    cheques: [{ date: labelDate, number: 5550001, amount: 300 }, { date: labelDate, number: 5550002, amount: 200 }],
    ...overrides,
  };
}

function read(tabs: SyntheticTab[], fileName = 'SYNTHETIC BDK 2026.xlsx', date = D) {
  return readMonthlyWorkbook({ name: fileName, bytes: monthlyWorkbookBytes(tabs) }, date, TODAY);
}

test('onglets D−1, D et D+1 : seul l’onglet portant la position à D est retenu', () => {
  const result = read([
    tab('2026-06-04', tabName('2026-06-05'), { opening: 30_000 }),
    tab(D, tabName('2026-06-04'), { opening: 20_000 }),
    tab('2026-06-02', tabName('2026-06-03'), { opening: 10_000 }),
  ]);
  assert.equal(result.available, true);
  assert.equal(result.tabName, tabName('2026-06-04'));
  assert.equal(result.balanceDate, D);
  assert.equal(result.openingBalance, 20_000);
  assert.equal(result.totalBalanceA, 20_700);
  assert.equal(result.closingBookBalance, 20_200);
  assert.equal(result.deposits.available, true);
  assert.equal(result.deposits.declaredTotal, 700);
  assert.equal(result.deposits.lines[0].dueDate, '2026-09-15');
  assert.equal(result.deposits.lines[0].client, 'SYNTHETIC CLIENT A');
  assert.equal(result.cheques.available, true);
  assert.deepEqual(result.cheques.lines.map((line) => line.number), ['5550001', '5550002']);
  assert.equal(result.cheques.declaredTotal, 500);
});

test('onglet D absent ou ambigu : encours indisponibles', () => {
  const absent = read([tab('2026-06-02', tabName('2026-06-03')), tab('2026-06-04', tabName('2026-06-05'))]);
  assert.equal(absent.available, false);
  assert.equal(absent.reason, 'TAB_ABSENT');
  assert.equal(absent.openingBalance, null);

  const ambiguous = read([tab(D, tabName('2026-06-04')), tab(D, tabName('2026-06-05'))]);
  assert.equal(ambiguous.available, false);
  assert.equal(ambiguous.reason, 'TAB_AMBIGUOUS');
});

test('onglet au nom daté dans le futur : ignoré, même s’il porte D', () => {
  const result = read([tab(D, '040629', { opening: 99_999 }), tab(D, tabName('2026-06-04'), { opening: 20_000 })]);
  assert.equal(result.available, true);
  assert.equal(result.tabName, tabName('2026-06-04'));
  assert.equal(result.openingBalance, 20_000);
  assert.equal(result.ignoredFutureTabs, 1);
});

test('facilités : ligne sans libellé exclue, lignes libellées conservées', () => {
  const result = read([tab(D, tabName('2026-06-04'), {
    facilities: {
      withHeader: true,
      rows: [
        { label: 'SYNTHETIC DRAWEE ONE', limit: 500, used: 120, date: '2026-07-01' },
        { label: 'SYNTHETIC DRAWEE TWO', limit: 300, used: 0 },
        { label: 'SYNTHETIC DRAWEE THREE', used: 40 },
      ],
      trailingUnlabeledRows: true,
    },
  })]);
  assert.equal(result.facilities.available, true);
  assert.deepEqual(result.facilities.lines.map((line) => line.label), ['SYNTHETIC DRAWEE ONE', 'SYNTHETIC DRAWEE TWO', 'SYNTHETIC DRAWEE THREE']);
  assert.deepEqual(result.facilities.lines.map((line) => line.limit), [500, 300, null]);
  // Zéro explicite (300 / 0) distinct d'un plafond absent (null).
  assert.deepEqual(result.facilities.lines.map((line) => line.used), [120, 0, 40]);
  assert.equal(result.facilities.lines[0].nextDate, '2026-07-01');
  assert.equal(result.facilities.excludedUnlabeledRows, 3);
});

test('facilités : une ligne sans libellé n’est jamais retenue, même seule', () => {
  const result = read([tab(D, tabName('2026-06-04'), {
    titleBank: 'BICIS',
    facilities: { withHeader: true, rows: [{ limit: 1000, used: 450, date: '2026-07-10' }] },
  })], 'SYNTHETIC BICIS 2026.xlsx');
  assert.equal(result.facilities.available, false);
  assert.deepEqual(result.facilities.lines, []);
  assert.equal(result.facilities.excludedUnlabeledRows, 1);
});

test('facilités : plafond zéro explicite conservé ; sans en-tête, un nombre seul n’est pas attribué', () => {
  const zero = read([tab(D, tabName('2026-06-04'), {
    facilities: { withHeader: true, rows: [{ label: 'SYNTHETIC DRAWEE ZERO', limit: 0, used: 0 }, { label: 'SYNTHETIC DRAWEE LIMIT ONLY', limit: 0 }] },
  })]);
  assert.deepEqual(zero.facilities.lines.map((line) => [line.limit, line.used]), [[0, 0], [0, null]]);

  const positional = read([tab(D, tabName('2026-06-04'), {
    titleBank: 'ORABANK', french: true,
    facilities: { withHeader: false, rows: [{ label: 'SYNTHETIC DRAWEE FULL', limit: 800, used: 268 }, { label: 'SYNTHETIC DRAWEE USED ONLY', used: 40 }] },
  })], 'SYNTHETIC ORABANK 2026.xlsx');
  // « 40 » n'est ni affiché comme plafond ni comme utilisé : la ligne n'est pas attribuée.
  assert.deepEqual(positional.facilities.lines.map((line) => [line.label, line.limit, line.used]), [['SYNTHETIC DRAWEE FULL', 800, 268]]);
  assert.equal(positional.facilities.unattributedRows, 1);

  // Deux nombres, ou trois nombres qui ne se prouvent pas (plafond − utilisé ≠ disponible) : rien n'est attribué.
  const unproven = read([tab(D, tabName('2026-06-04'), {
    titleBank: 'ORABANK', french: true,
    facilities: { withHeader: false, rows: [
      { label: 'SYNTHETIC USED AND BALANCE', used: 40, balance: 960 },
      { label: 'SYNTHETIC LIMIT AND BALANCE', limit: 800, balance: 800 },
      { label: 'SYNTHETIC INCONSISTENT', limit: 800, used: 100, balance: 999 },
      { label: 'SYNTHETIC PROVEN', limit: 800, used: 100 },
    ] },
  })], 'SYNTHETIC ORABANK 2026.xlsx');
  assert.deepEqual(unproven.facilities.lines.map((line) => [line.label, line.limit, line.used]), [['SYNTHETIC PROVEN', 800, 100]]);
  assert.equal(unproven.facilities.unattributedRows, 3);
});

test('onglet dont le nom ne suit pas la date de son libellé : écarté', () => {
  // Libellé à D dans un onglet daté D, ou avant D : la position serait décalée sans alerte.
  for (const name of [tabName(D), tabName('2026-06-01'), tabName('2026-05-20')]) {
    const result = read([tab(D, name)], 'SYNTHETIC BDK 2026.xlsx', D);
    assert.equal(result.available, false, name);
    assert.equal(result.reason, 'TAB_LABEL_INCONSISTENT', name);
    assert.equal(result.openingBalance, null, name);
  }
  // Onglet daté très au-delà de la date de son libellé : écarté lui aussi.
  const late = readMonthlyWorkbook({ name: 'SYNTHETIC BDK 2026.xlsx', bytes: monthlyWorkbookBytes([tab(D, tabName('2026-06-13'))]) }, D, '2026-06-20');
  assert.equal(late.reason, 'TAB_LABEL_INCONSISTENT');
  // Un onglet cohérent l'emporte sur un onglet incohérent portant la même date.
  const mixed = read([tab(D, tabName(D), { opening: 77_777 }), tab(D, tabName('2026-06-04'), { opening: 20_000 })]);
  assert.equal(mixed.available, true);
  assert.equal(mixed.openingBalance, 20_000);
});

test('onglet masqué : jamais retenu', () => {
  const onlyHidden = read([tab(D, tabName('2026-06-04'), { hidden: true }), tab('2026-06-02', tabName('2026-06-03'))]);
  assert.equal(onlyHidden.available, false);
  assert.equal(onlyHidden.reason, 'TAB_ABSENT');
  const both = read([tab(D, tabName('2026-06-04'), { hidden: true, opening: 88_888 }), tab(D, tabName('2026-06-05'), { opening: 20_000 })]);
  assert.equal(both.available, true);
  assert.equal(both.openingBalance, 20_000);
});

test('totaux incohérents ou non lus : classeur indisponible, aucun chiffre', () => {
  const inconsistent = read([tab(D, tabName('2026-06-04'), { declaredClosingOverride: 123 })]);
  assert.equal(inconsistent.available, false);
  assert.equal(inconsistent.reason, 'TOTALS_INCONSISTENT');
  assert.equal(inconsistent.openingBalance, null);
  assert.equal(inconsistent.closingBookBalance, null);

  const bare = readMonthlyWorkbook({
    name: 'SYNTHETIC BDK 2026.xlsx',
    bytes: workbookBytes([{ name: tabName('2026-06-04'), sheet: sheetFromRows([['', '', '', 'BDK'], [], ['OPENING BALANCE 03/06/26', '', '', '', '', '', 100]]) }]),
  }, D, TODAY);
  assert.equal(bare.available, false);
  assert.equal(bare.reason, 'TOTALS_NOT_READ');
  assert.equal(bare.openingBalance, null);
});

test('BIS : dépôts lus sans titre de section, prouvés par le total déclaré', () => {
  const result = read([tab(D, tabName('2026-06-04'), {
    titleBank: 'BIS',
    depositSectionTitle: false,
    deposits: [
      { date: D, dueDate: '2026-08-01', client: 'SYNTHETIC CLIENT A', amount: 400 },
      { date: D, dueDate: '2026-08-02', client: 'SYNTHETIC CLIENT B', amount: 250 },
    ],
  })], 'SYNTHETIC BIS 2026.xlsx');
  assert.equal(result.available, true);
  assert.equal(result.deposits.available, true);
  assert.equal(result.deposits.lines.length, 2);
  assert.equal(result.deposits.declaredTotal, 650);
});

test('ORABANK : Total B rattaché à la colonne prouvée, anciens chèques hors total', () => {
  const result = read([tab(D, tabName('2026-06-04'), {
    titleBank: 'ORABANK',
    french: true,
    cheques: [
      { date: '2019-03-01', number: 1110001, amount: 77, outsideTotalColumn: true },
      { date: '2019-04-01', number: 1110002, amount: 88, outsideTotalColumn: true },
      { date: D, number: 1110003, amount: 4000 },
    ],
    facilities: { withHeader: false, rows: [{ label: 'OTHER', limit: 800, used: 268, date: '2026-07-06' }, { label: 'DRAWEE', limit: 300, used: 26 }, { limit: 1100, used: 294 }] },
  })], 'SYNTHETIC ORABANK 2026.xlsx');
  assert.equal(result.available, true);
  assert.equal(result.cheques.available, true);
  assert.equal(result.cheques.declaredTotal, 4000);
  assert.deepEqual(result.cheques.lines.map((line) => line.amount), [4000]);
  assert.equal(result.chequesOutsideTotal, 2);
  assert.equal(result.closingBookBalance, 10_000 + 700 - 4000);
  // Sans en-tête Limit / Used : la ligne de total sans libellé est écartée.
  assert.deepEqual(result.facilities.lines.map((line) => [line.label, line.limit, line.used]), [['OTHER', 800, 268], ['DRAWEE', 300, 26]]);
  assert.equal(result.facilities.excludedUnlabeledRows, 1);
  assert.equal(result.facilities.unattributedRows, 0);
});

test('Total B : colonne prouvée parmi deux candidates, ou égalité ambiguë', () => {
  const orabank = (cheques: SyntheticTab['cheques'], totalBSecondColumn: number) => read([tab(D, tabName('2026-06-04'), {
    titleBank: 'ORABANK', french: true, cheques, totalBSecondColumn,
  })], 'SYNTHETIC ORABANK 2026.xlsx');

  // Deux montants sur la ligne du total : seule la colonne qui vérifie A − B = C et dont les lignes somment le total est retenue.
  const proven = orabank([
    { date: '2019-03-01', number: 1110001, amount: 77, outsideTotalColumn: true },
    { date: '2019-04-01', number: 1110002, amount: 88, outsideTotalColumn: true },
    { date: D, number: 1110003, amount: 4000 },
  ], 165);
  assert.equal(proven.available, true);
  assert.equal(proven.cheques.available, true);
  assert.equal(proven.cheques.declaredTotal, 4000);
  assert.deepEqual(proven.cheques.lines.map((line) => line.amount), [4000]);
  assert.equal(proven.chequesOutsideTotal, 2);
  assert.equal(proven.closingBookBalance, 10_000 + 700 - 4000);

  // Égalité : les deux colonnes portent le même total et leurs lignes le prouvent toutes deux.
  const ambiguous = orabank([
    { date: '2019-03-01', number: 1110001, amount: 500, outsideTotalColumn: true },
    { date: D, number: 1110003, amount: 500 },
  ], 500);
  assert.equal(ambiguous.available, true);
  assert.equal(ambiguous.cheques.available, false);
  assert.equal(ambiguous.cheques.reason, 'TOTAL_COLUMN_AMBIGUOUS');
  assert.deepEqual(ambiguous.cheques.lines, []);
  assert.equal(ambiguous.closingBookBalance, 10_000 + 700 - 500);
});

test('NSIA : reconnue sur preuves concordantes ; discordance refusée', () => {
  const recognized = read([tab(D, tabName('2026-06-04'), { titleBank: 'NSIA BANK' })], 'SYNTHETIC NSIA BANK.xlsx');
  assert.equal(recognized.available, true);
  assert.equal(recognized.bank, 'NSIA');
  assert.equal(recognized.openingBalance, 10_000);

  const mismatch = read([tab(D, tabName('2026-06-04'), { titleBank: 'BRIDGE BANK' })], 'SYNTHETIC NSIA BANK.xlsx');
  assert.equal(mismatch.available, false);
  assert.equal(mismatch.reason, 'BANK_NOT_CORROBORATED');
  assert.equal(mismatch.openingBalance, null);
});

test('zéro explicite distinct d’une valeur absente', () => {
  const zero = read([tab(D, tabName('2026-06-04'), { deposits: [], cheques: [], impayes: [] })]);
  assert.equal(zero.available, true);
  assert.equal(zero.deposits.available, true);
  assert.equal(zero.deposits.declaredTotal, 0);
  assert.deepEqual(zero.deposits.lines, []);
  assert.equal(zero.cheques.declaredTotal, 0);
  assert.equal(zero.impayes.available, true);
  assert.equal(zero.impayes.declaredTotal, 0);
  // Section absente : indisponible, total `null` (jamais 0).
  const absent = read([tab(D, tabName('2026-06-04'))]);
  assert.equal(absent.impayes.available, false);
  assert.equal(absent.impayes.declaredTotal, null);
  assert.equal(absent.facilities.available, false);
});

test('lignes qui ne prouvent pas le total déclaré : section indisponible', () => {
  const result = read([tab(D, tabName('2026-06-04'), { declaredDepositsOverride: 999 })]);
  assert.equal(result.available, true);
  assert.equal(result.deposits.available, false);
  assert.equal(result.deposits.reason, 'LINES_DO_NOT_PROVE_TOTAL');
  assert.deepEqual(result.deposits.lines, []);
  assert.equal(result.cheques.available, true);
});

test('impayés : rendus seulement si les lignes prouvent un total déclaré', () => {
  const impayes = [{ date: '2026-05-10', amount: 150 }, { date: '2026-05-20', amount: 50 }];
  const result = read([tab(D, tabName('2026-06-04'), { impayes })]);
  assert.equal(result.impayes.available, true);
  assert.equal(result.impayes.lines.length, 2);
  assert.equal(result.impayes.declaredTotal, 200);

  const mismatch = read([tab(D, tabName('2026-06-04'), { impayes, impayesTotalOverride: 999 })]);
  assert.equal(mismatch.impayes.available, false);
  assert.equal(mismatch.impayes.reason, 'TOTAL_MISMATCH');
  assert.deepEqual(mismatch.impayes.lines, []);

  const undeclared = read([tab(D, tabName('2026-06-04'), { impayes, impayesTotalOverride: null })]);
  assert.equal(undeclared.impayes.available, false);
  assert.equal(undeclared.impayes.reason, 'TOTAL_NOT_DECLARED');
  assert.deepEqual(undeclared.impayes.lines, []);
});

test('titre d’onglet strict et système de dates 1904 : refusés', () => {
  // « BDK USD » n'est pas le titre du compte BDK attendu.
  const otherTitle = read([tab(D, tabName('2026-06-04'), { titleBank: 'BDK USD' })]);
  assert.equal(otherTitle.available, false);
  assert.equal(otherTitle.reason, 'BANK_NOT_CORROBORATED');
  // Un classeur au système de dates 1904 décalerait toutes les dates : il est refusé.
  const mac = readMonthlyWorkbook({ name: 'SYNTHETIC BDK 2026.xlsx', bytes: monthlyWorkbookBytes([tab(D, tabName('2026-06-04'))], { date1904: true }) }, D, TODAY);
  assert.equal(mac.available, false);
  assert.equal(mac.reason, 'WORKBOOK_UNREADABLE');
  assert.equal(mac.openingBalance, null);
});

test('classeur illisible : indisponible sans exception', () => {
  const result = readMonthlyWorkbook({ name: 'SYNTHETIC BDK 2026.xlsx', bytes: new Uint8Array([1, 2, 3, 4]).buffer }, D, TODAY);
  assert.equal(result.available, false);
  assert.ok(result.reason === 'WORKBOOK_UNREADABLE' || result.reason === 'TAB_ABSENT');
});
