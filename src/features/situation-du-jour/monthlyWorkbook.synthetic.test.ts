import assert from 'node:assert/strict';
import test from 'node:test';

import { readMonthlyWorkbook } from './monthlyWorkbook';
import { monthlyTabSheet, monthlyWorkbookBytes, sheetFromRows, tabName, workbookBytes } from './situationSyntheticFixtures';
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

test('devise et unité du classeur : champs explicites de l’en-tête, non contredits, sinon non établis', () => {
  const name = tabName('2026-06-04');
  const deposit = (client: string) => [{ date: D, dueDate: '2026-09-15', client, amount: 700 }];
  /** Onglet dont des cellules de la première ligne sont écrites à la main (E1, F1 sont libres). */
  const withCells = (cells: Record<string, string>, extra: Partial<SyntheticTab> = {}) => {
    const sheet = monthlyTabSheet(tab(D, name, extra));
    for (const [address, value] of Object.entries(cells)) sheet[address] = { t: 's', v: value };
    return readMonthlyWorkbook({ name: 'SYNTHETIC BDK 2026.xlsx', bytes: workbookBytes([{ name, sheet }]) }, D, TODAY);
  };
  // Aucun champ renseigné : ni la devise ni l'unité ne sont présumées.
  const silent = read([tab(D, name)]);
  assert.equal(silent.available, true);
  assert.equal(silent.currency, null);
  assert.equal(silent.unit, null);
  // Champs renseignés dans l'en-tête : établis (« FCFA » vaut XOF).
  for (const [written, expected] of [['XOF', 'XOF'], ['FCFA', 'XOF'], ['EUR', 'EUR']]) {
    assert.equal(read([tab(D, name, { currency: written })]).currency, expected, written);
  }
  for (const [written, expected] of [['francs entiers', 'UNITS'], ['milliers', 'THOUSANDS'], ['milliers de francs', 'THOUSANDS'], ['millions de FCFA', 'MILLIONS']]) {
    assert.equal(read([tab(D, name, { unit: written })]).unit, expected, written);
  }
  const complete = read([tab(D, name, { currency: 'XOF', unit: 'francs entiers' })]);
  assert.equal(complete.currency, 'XOF');
  assert.equal(complete.unit, 'UNITS');
  // Libellé et valeur dans deux cellules voisines.
  assert.equal(withCells({ E1: 'Devise', F1: 'XOF' }).currency, 'XOF');
  assert.equal(withCells({ E1: 'Unité des montants', F1: 'francs entiers' }).unit, 'UNITS');
  // Valeur mal formée : le champ n'établit rien.
  for (const written of ['francs', 'francs entiers environ', 'milliers ou millions']) {
    assert.equal(read([tab(D, name, { unit: written })]).unit, null, written);
  }
  assert.equal(withCells({ F1: 'Devise : XOF provisoire' }).currency, null);
  assert.equal(withCells({ F1: 'Devise : XOF / EUR' }).currency, null);
  // Sans le libellé du champ, une mention n'établit rien, même dans l'en-tête.
  assert.equal(withCells({ F1: 'Client principal : CFA MOTORS' }).available, true);
  assert.equal(withCells({ F1: 'Client principal : CFA MOTORS' }).currency, null);
  assert.equal(withCells({ F1: 'Montants en FCFA' }).currency, null);
  assert.equal(withCells({ F1: 'XOF' }).currency, null);
  assert.equal(withCells({ F1: 'en francs entiers' }).unit, null);
  // Champ écrit deux fois : ambigu, même à valeur identique.
  assert.equal(withCells({ F1: 'Devise : XOF' }, { currency: 'XOF' }).currency, null);
  assert.equal(withCells({ F1: 'Unité : francs entiers' }, { unit: 'francs entiers' }).unit, null);
  // Champ écrit seulement dans une ligne, même sur la ligne qui suit l'ouverture : il n'établit rien.
  for (const client of ['SYNTHETIC CFA CLIENT', 'XOF', 'Devise XOF', 'Devise : XOF', 'Unité : francs entiers']) {
    const lineOnly = read([tab(D, name, { depositSectionTitle: false, deposits: deposit(client) })]);
    assert.equal(lineOnly.available, true, client);
    assert.equal(lineOnly.currency, null, client);
    assert.equal(lineOnly.unit, null, client);
  }
  // Champ renseigné, puis contredit ailleurs dans l'onglet : non établi.
  assert.equal(read([tab(D, name, { currency: 'XOF', deposits: deposit('SYNTHETIC EURO CLIENT') })]).currency, null);
  assert.equal(read([tab(D, name, { currency: 'XOF', deposits: deposit('SYNTHETIC CLIENT 100 $') })]).currency, null);
  assert.equal(read([tab(D, name, { currency: 'XOF', deposits: deposit('SYNTHETIC XAF CLIENT') })]).currency, null);
  assert.equal(withCells({ F1: 'Taux CHF' }, { currency: 'XOF' }).currency, null);
  const farColumn = monthlyTabSheet(tab(D, name, { currency: 'XOF' }));
  farColumn.AB5 = { t: 's', v: 'USD' };
  farColumn['!ref'] = 'A1:AB40';
  assert.equal(readMonthlyWorkbook({ name: 'SYNTHETIC BDK 2026.xlsx', bytes: workbookBytes([{ name, sheet: farColumn }]) }, D, TODAY).currency, null);
  assert.equal(read([tab(D, name, { unit: 'francs entiers', deposits: deposit('SYNTHETIC CLIENT (en milliers)') })]).unit, null);
  // La même devise ou la même unité répétée dans une ligne ne contredit rien.
  assert.equal(read([tab(D, name, { currency: 'XOF', deposits: deposit('SYNTHETIC FCFA CLIENT') })]).currency, 'XOF');
  assert.equal(read([tab(D, name, { unit: 'francs entiers', deposits: deposit('SYNTHETIC ENTIERS CLIENT') })]).unit, 'UNITS');
  // Classeur indisponible : ni devise ni unité.
  const absent = read([tab('2026-06-02', tabName('2026-06-03'), { currency: 'XOF', unit: 'francs entiers' })]);
  assert.equal(absent.currency, null);
  assert.equal(absent.unit, null);
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

test('onglet et libellé d’ouverture : même date acceptée, nom antérieur au libellé ou trop éloigné écarté', () => {
  // Nom et libellé portent tous deux D : l'onglet porte lui-même la date de sa position.
  const sameDay = read([tab(D, tabName(D), { opening: 77_777 })]);
  assert.equal(sameDay.available, true);
  assert.equal(sameDay.tabName, tabName(D));
  assert.equal(sameDay.balanceDate, D);
  assert.equal(sameDay.openingBalance, 77_777);
  // Nom antérieur à la date du libellé (inversion d'un jour ou plus) : la position serait décalée sans alerte.
  for (const name of [tabName('2026-06-02'), tabName('2026-06-01'), tabName('2026-05-20')]) {
    const result = read([tab(D, name)], 'SYNTHETIC BDK 2026.xlsx', D);
    assert.equal(result.available, false, name);
    assert.equal(result.reason, 'TAB_LABEL_INCONSISTENT', name);
    assert.equal(result.openingBalance, null, name);
  }
  // Onglet daté très au-delà de la date de son libellé : écarté lui aussi.
  const late = readMonthlyWorkbook({ name: 'SYNTHETIC BDK 2026.xlsx', bytes: monthlyWorkbookBytes([tab(D, tabName('2026-06-13'))]) }, D, '2026-06-20');
  assert.equal(late.reason, 'TAB_LABEL_INCONSISTENT');
  // Unicité maintenue : un onglet daté D et un onglet daté D+1 portent tous deux la position à D → ambigu.
  const both = read([tab(D, tabName(D), { opening: 77_777 }), tab(D, tabName('2026-06-04'), { opening: 20_000 })]);
  assert.equal(both.available, false);
  assert.equal(both.reason, 'TAB_AMBIGUOUS');
  assert.equal(both.openingBalance, null);
  // Un onglet cohérent l'emporte sur un onglet au nom antérieur à son libellé.
  const mixed = read([tab(D, tabName('2026-06-02'), { opening: 77_777 }), tab(D, tabName('2026-06-04'), { opening: 20_000 })]);
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
