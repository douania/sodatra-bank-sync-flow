import assert from 'node:assert/strict';
import test from 'node:test';

import { compareFundPosition, readFundPosition } from './fundPositionReading';
import { readMonthlyWorkbook } from './monthlyWorkbook';
import { csvStatementBytes, fundPositionBytes, monthlyWorkbookBytes, sheetFromRows, tabName, workbookBytes } from './situationSyntheticFixtures';
import type { SyntheticFundPositionReference, SyntheticFundPositionRow } from './situationSyntheticFixtures';
import { buildAccountBalances, evaluateStatement } from './statementBalances';

const D = '2026-06-03';
const TODAY = '2026-06-05';
/** Référence écrite dans l'onglet : date égale à D et devise. */
const AT_D: SyntheticFundPositionReference = { date: D, currency: 'XOF' };

const ROWS: SyntheticFundPositionRow[] = [
  { label: 'SGBS', bankBalance: 0, fundApplied: 0, netBalance: 0, nonValidatedDeposit: 0, position: 0 },
  { label: 'BDK', bankBalance: 1050, fundApplied: 500, netBalance: 550, nonValidatedDeposit: 700, position: 1250 },
  { label: 'Bque Atlantique', bankBalance: 900, fundApplied: 100, netBalance: 790, nonValidatedDeposit: 10, position: 810 },
  { label: 'BICIS', bankBalance: 'n/a', fundApplied: 5 },
];

type FundTab = { name: string; rows: SyntheticFundPositionRow[]; hidden?: boolean; reference?: SyntheticFundPositionReference };

function reading(tabs: FundTab[] = [{ name: tabName('2026-06-04'), rows: ROWS, reference: AT_D }], date = D, today = TODAY) {
  return readFundPosition(fundPositionBytes(tabs), date, today);
}

function bdkBalances() {
  return buildAccountBalances([evaluateStatement({
    name: 'SYNTHETIC BDK ONLINE.csv',
    attestation: { identityAttested: true },
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000,
      movements: [{ date: '2026-06-01', amount: -100 }, { date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 }, { date: '2026-06-04', amount: 5 }],
    }),
  }, D, TODAY)]);
}

/** Classeur mensuel BDK ; `currency` : devise écrite dans l'en-tête de l'onglet, `null` pour n'en écrire aucune. */
function bdkWorkbook(date = D, tab = tabName('2026-06-04'), currency: string | null = 'XOF') {
  return readMonthlyWorkbook({
    name: 'SYNTHETIC BDK 2026.xlsx',
    bytes: monthlyWorkbookBytes([{
      name: tab, labelDate: date, titleBank: 'BDK', opening: 1050, currency: currency ?? undefined,
      deposits: [{ date, dueDate: '2026-09-01', client: 'SYNTHETIC CLIENT A', amount: 700 }],
      cheques: [{ date, number: 5550001, amount: 480 }],
    }]),
  }, date, TODAY);
}

test('lecture cellule par cellule : valeurs déclarées et recalculées distinctes', () => {
  const result = reading();
  assert.equal(result.available, true);
  assert.equal(result.tabName, tabName('2026-06-04'));
  const bdk = result.rows.find((row) => row.bank === 'BDK')!;
  assert.deepEqual(bdk.declared.bankBalance, { address: 'C3', value: 1050 });
  assert.equal(bdk.declared.netBalance.value, 550);
  assert.equal(bdk.recalculated.netBalance, 550);
  assert.equal(bdk.recalculated.position, 1250);
  // Banque Atlantique : le net déclaré (790) diffère du net recalculé (800).
  const atb = result.rows.find((row) => row.bank === 'ATB')!;
  assert.equal(atb.declared.netBalance.value, 790);
  assert.equal(atb.recalculated.netBalance, 800);
  assert.equal(atb.recalculated.position, 810);
  assert.ok(result.issues.some((issue) => issue.code === 'DECLARED_NET_DIFFERS_FROM_RECALCULATED' && issue.address === 'E4' && issue.bank === 'ATB'));
  // La ligne « BIS » du bloc « Deposit for the day » n'est pas lue comme une ligne de banque.
  assert.equal(result.rows.some((row) => row.bank === 'BIS'), false);
});

test('zéro explicite distinct d’une cellule absente ou non numérique', () => {
  const result = reading();
  const sgbs = result.rows.find((row) => row.bank === 'SGBS')!;
  assert.equal(sgbs.declared.bankBalance.value, 0);
  assert.equal(sgbs.recalculated.netBalance, 0);
  const bicis = result.rows.find((row) => row.bank === 'BICIS')!;
  assert.equal(bicis.declared.bankBalance.value, null);
  assert.equal(bicis.declared.netBalance.value, null);
  assert.equal(bicis.recalculated.netBalance, null);
  assert.ok(result.issues.some((issue) => issue.code === 'CELL_NOT_NUMERIC' && issue.address === 'C5'));
  assert.ok(result.issues.some((issue) => issue.code === 'CELL_ABSENT' && issue.address === 'E5'));
});

test('les signalements ne recopient jamais le contenu d’une ligne source', () => {
  const result = reading([{ name: tabName('2026-06-04'), rows: [...ROWS, { label: 'SYNTHETIC UNKNOWN LABEL', bankBalance: 12345 }], reference: AT_D }]);
  assert.ok(result.issues.some((issue) => issue.code === 'BANK_LABEL_UNKNOWN' && issue.address === 'B6'));
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ['address', 'bank', 'code']);
    assert.match(issue.address, /^[A-Z]{1,2}[0-9]{1,3}$/);
  }
  const serialized = JSON.stringify(result.issues);
  assert.equal(serialized.includes('SYNTHETIC UNKNOWN LABEL'), false);
  assert.equal(serialized.includes('12345'), false);
});

test('libellé de banque strict : « BDK USD » et « TOTAL BDK » ne sont pas la ligne BDK', () => {
  const result = reading([{ name: tabName('2026-06-04'), reference: AT_D, rows: [
    { label: 'BDK USD', bankBalance: 12, fundApplied: 0, netBalance: 12, nonValidatedDeposit: 0, position: 12 },
    { label: 'TOTAL BDK', bankBalance: 55555, fundApplied: 0, netBalance: 55555, nonValidatedDeposit: 0, position: 55555 },
  ] }]);
  assert.equal(result.available, true);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues.map((issue) => [issue.code, issue.address]), [['BANK_LABEL_UNKNOWN', 'B2']]);
  assert.deepEqual(compareFundPosition(result, D, bdkBalances(), []), []);
});

test('ligne de banque en double : ambiguë, donc non lue', () => {
  const result = reading([{ name: tabName('2026-06-04'), reference: AT_D, rows: [{ label: 'BDK', bankBalance: 1 }, { label: 'BDK', bankBalance: 2 }] }]);
  assert.equal(result.rows.some((row) => row.bank === 'BDK'), false);
  assert.ok(result.issues.some((issue) => issue.code === 'BANK_ROW_AMBIGUOUS' && issue.bank === 'BDK'));
});

test('onglet lu : le premier daté après D, jamais masqué, daté après aujourd’hui ou en double', () => {
  const tabs: FundTab[] = [
    { name: '040629', rows: ROWS, reference: AT_D },
    { name: tabName('2026-06-05'), rows: ROWS, reference: AT_D },
    { name: tabName('2026-06-04'), rows: ROWS, reference: AT_D },
    { name: tabName('2026-06-03'), rows: ROWS, reference: AT_D },
  ];
  assert.equal(reading(tabs).tabName, tabName('2026-06-04'));
  // Aucun onglet après D à la date du jour : indisponible.
  assert.equal(reading(tabs, '2026-06-05').reason, 'TAB_ABSENT');
  // Un onglet daté après aujourd'hui n'est jamais lu.
  const monday: FundTab[] = [{ name: tabName('2026-06-08'), rows: ROWS, reference: { date: '2026-06-05', currency: 'XOF' } }];
  assert.equal(reading(monday, '2026-06-05', '2026-06-08').dateComparable, true);
  assert.equal(reading(monday, '2026-06-05', '2026-06-05').reason, 'TAB_ABSENT');
  // Onglet masqué : ignoré au profit du suivant.
  const hiddenFirst = reading([{ name: tabName('2026-06-04'), rows: ROWS, hidden: true, reference: AT_D }, { name: tabName('2026-06-05'), rows: ROWS, reference: AT_D }]);
  assert.equal(hiddenFirst.tabName, tabName('2026-06-05'));
  // Deux onglets ramenés à la même date : lecture indisponible.
  const twins = reading([{ name: `${tabName('2026-06-04')} `, rows: ROWS, reference: AT_D }, { name: tabName('2026-06-04'), rows: ROWS, reference: AT_D }]);
  assert.equal(twins.available, false);
  assert.equal(twins.reason, 'TAB_AMBIGUOUS');
  // En-tête introuvable, ou répété donc ambigu.
  const noHeader = readFundPosition(monthlyWorkbookBytes([{ name: tabName('2026-06-04'), labelDate: D, titleBank: 'BDK', opening: 1 }]), D, TODAY);
  assert.equal(noHeader.reason, 'HEADER_NOT_FOUND');
  const repeated = readFundPosition(workbookBytes([{ name: tabName('2026-06-04'), sheet: sheetFromRows([
    ['', '', 'Bank Balance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', 'Bank Balance'],
    ['Book balance', 'BDK', 1, 1, 0, 0, 0],
  ]) }]), D, TODAY);
  assert.equal(repeated.reason, 'HEADER_NOT_FOUND');
});

test('le nom de l’onglet ne prouve ni la date ni la devise : référence lue, sans écart chiffré', () => {
  const balances = bdkBalances();
  const workbook = bdkWorkbook();
  assert.equal(balances.find((balance) => balance.bank === 'BDK')!.status, 'AVAILABLE');
  assert.equal(workbook.available, true);
  const cases: Array<[string, SyntheticFundPositionReference | undefined, string]> = [
    // Onglet voisin de D sans date ni devise écrites : forme habituelle d'une Fund Position.
    ['aucune référence', undefined, 'DATE_NOT_COMPARABLE'],
    ['date écrite différente de D', { date: '2026-06-02', currency: 'XOF' }, 'DATE_NOT_COMPARABLE'],
    ['deux dates écrites', { date: D, otherDate: '2026-06-02', currency: 'XOF' }, 'DATE_NOT_COMPARABLE'],
    ['date à D mais devise absente', { date: D }, 'CURRENCY_NOT_COMPARABLE'],
    ['date à D mais autre devise', { date: D, currency: 'EUR' }, 'CURRENCY_NOT_COMPARABLE'],
  ];
  for (const [label, reference, reason] of cases) {
    const fund = reading([{ name: tabName('2026-06-04'), rows: ROWS, reference }]);
    assert.equal(fund.available, true, label);
    // La référence lue reste affichable…
    assert.equal(fund.rows.find((row) => row.bank === 'BDK')!.declared.bankBalance.value, 1050, label);
    // … mais aucun écart n'est chiffré.
    const comparisons = compareFundPosition(fund, D, balances, [workbook]);
    assert.ok(comparisons.length > 0, label);
    for (const comparison of comparisons) {
      assert.equal(comparison.status, 'NOT_COMPARABLE', label);
      assert.equal(comparison.reason, reason, label);
      assert.equal(comparison.delta, null, label);
    }
  }
  const none = reading([{ name: tabName('2026-06-04'), rows: ROWS }]);
  assert.equal(none.referenceDate, null);
  assert.equal(none.currency, null);
  assert.equal(none.dateComparable, false);
});

test('date de référence : une seule date, écrite sans autre mention, sinon aucune comparaison', () => {
  const read = (reference: SyntheticFundPositionReference) => reading([{ name: tabName('2026-06-04'), rows: ROWS, reference }]);
  // Témoins : la date de D écrite seule, sous plusieurs écritures lisibles.
  for (const dateText of ['03/06/2026', 'Situation au 3 juin 2026', 'As of 2026-06-03', 'Position du 03/06/26']) {
    const fund = read({ dateText, currency: 'XOF' });
    assert.equal(fund.referenceDate, D, dateText);
    assert.equal(fund.dateComparable, true, dateText);
  }
  const doubtful: Array<[string, SyntheticFundPositionReference]> = [
    ['période dans une seule cellule', { dateText: 'Du 03/06/2026 au 04/06/2026', currency: 'XOF' }],
    ['même date écrite deux fois dans une cellule', { dateText: 'Du 03/06/2026 au 03/06/2026', currency: 'XOF' }],
    ['situation à une autre date et date d’impression à D', { dateText: 'Situation au 2 juin 2026', currency: 'XOF', texts: ['Imprimé le 03/06/2026'] }],
    ['situation en écriture ISO et date isolée à D', { dateText: 'Situation au 2026-06-02', currency: 'XOF', texts: ['03/06/26'] }],
    ['seule date du document, mais annotée', { currency: 'XOF', texts: ['Prochaine revue 03/06/2026'] }],
    ['date de D en cellule et date d’impression identique', { date: D, currency: 'XOF', texts: ['Imprimé le 03/06/2026'] }],
    ['seule date du document, libellée « Imprimé le » dans la cellule voisine', { currency: 'XOF', texts: ['Imprimé le', '03/06/2026'] }],
    ['situation sans année, autre date à D', { dateText: 'Situation au 02 juin', currency: 'XOF', texts: ['', '03/06/2026'] }],
    ['situation en écriture anglaise, autre date à D', { dateText: 'As at June 2, 2026', currency: 'XOF', texts: ['', '03/06/2026'] }],
    ['« date du jour » n’est pas une date de situation', { dateText: 'Date du jour : 03/06/2026', currency: 'XOF' }],
    ['mois et année seulement, autre date à D', { dateText: 'Juin 2026', currency: 'XOF', texts: ['', '03/06/2026'] }],
    ['seconde date au-delà de la colonne P', { date: D, currency: 'XOF', texts: ['', '', '', '', '', '02/06/2026'] }],
  ];
  const balances = bdkBalances();
  const workbook = bdkWorkbook();
  for (const [label, reference] of doubtful) {
    const fund = read(reference);
    assert.equal(fund.available, true, label);
    assert.equal(fund.referenceDate, null, label);
    assert.equal(fund.dateComparable, false, label);
    for (const comparison of compareFundPosition(fund, D, balances, [workbook])) {
      assert.equal(comparison.status, 'NOT_COMPARABLE', label);
      assert.equal(comparison.delta, null, label);
    }
  }
  // Un mois et une année ne désignent aucun jour, même quand D est le premier du mois.
  const monthOnly = reading([{ name: tabName('2026-06-02'), rows: ROWS, reference: { dateText: 'Juin 2026', currency: 'XOF' } }], '2026-06-01');
  assert.equal(monthOnly.available, true);
  assert.equal(monthOnly.referenceDate, null);
  assert.equal(monthOnly.dateComparable, false);
  assert.equal(reading([{ name: tabName('2026-06-02'), rows: ROWS, reference: { dateText: '01/06/2026', currency: 'XOF' } }], '2026-06-01').dateComparable, true);
  // Une autre date écrite SOUS la ligne d'en-tête, sur la ligne d'une banque : la référence n'est plus unique.
  const below = reading([{
    name: tabName('2026-06-04'), reference: AT_D,
    rows: ROWS.map((row) => (row.label === 'BDK' ? { ...row, note: 'Situation au 02/06/2026' } : row)),
  }]);
  assert.equal(below.referenceDate, null);
  assert.equal(below.dateComparable, false);
});

test('devise : une seule devise écrite dans tout l’onglet, sinon aucune comparaison', () => {
  const withNote = (note: string) => ROWS.map((row) => (row.label === 'BDK' ? { ...row, note } : row));
  // Témoin : une mention équivalente (FCFA) sur la ligne d'une banque ne change rien.
  const same = reading([{ name: tabName('2026-06-04'), rows: withNote('FCFA'), reference: AT_D }]);
  assert.equal(same.currency, 'XOF');
  const cases: Array<[string, FundTab]> = [
    ['seconde devise écrite dans l’en-tête', { name: tabName('2026-06-04'), rows: ROWS, reference: { ...AT_D, texts: ['USD'] } }],
    ['autre devise écrite sur la ligne d’une banque', { name: tabName('2026-06-04'), rows: withNote('USD'), reference: AT_D }],
    ['autre devise écrite par son symbole', { name: tabName('2026-06-04'), rows: ROWS, reference: { ...AT_D, texts: ['Montants en €'] } }],
  ];
  for (const [label, tab] of cases) {
    const fund = reading([tab]);
    assert.equal(fund.currency, null, label);
    assert.equal(fund.dateComparable, true, label);
    const comparisons = compareFundPosition(fund, D, bdkBalances(), [bdkWorkbook()]);
    assert.ok(comparisons.length > 0, label);
    for (const comparison of comparisons) {
      assert.equal(comparison.status, 'NOT_COMPARABLE', label);
      assert.equal(comparison.reason, 'CURRENCY_NOT_COMPARABLE', label);
      assert.equal(comparison.delta, null, label);
    }
  }
});

test('périmètre : un solde d’une autre devise ou un classeur d’une autre date n’est pas comparé', () => {
  const fund = reading();
  const euro = compareFundPosition(fund, D, [{
    bank: 'BDK', currency: 'EUR', status: 'AVAILABLE', amount: 1050, balanceDate: D, identityProof: 'OPERATOR', currencyProof: 'CONTENT', reasons: [], sources: [],
  }], []);
  const statement = euro.find((entry) => entry.bank === 'BDK' && entry.indicator === 'BANK_BALANCE_VS_STATEMENT')!;
  assert.equal(statement.status, 'NOT_COMPARABLE');
  assert.equal(statement.reason, 'CURRENCY_NOT_COMPARABLE');
  assert.equal(statement.delta, null);

  const otherDay = '2026-06-02';
  const workbook = bdkWorkbook(otherDay, tabName('2026-06-03'));
  assert.equal(workbook.available, true);
  const stale = compareFundPosition(fund, D, [], [workbook]).find((entry) => entry.bank === 'BDK' && entry.indicator === 'FUND_APPLIED_VS_WORKBOOK')!;
  assert.equal(stale.status, 'NOT_COMPARABLE');
  assert.equal(stale.reason, 'DATE_NOT_COMPARABLE');
});

test('classeur mensuel : sans devise établie et concordante, non comparable et sans écart chiffré', () => {
  const fund = reading();
  const balances = bdkBalances();
  const workbookIndicators = ['BANK_BALANCE_VS_WORKBOOK', 'FUND_APPLIED_VS_WORKBOOK', 'NON_VALIDATED_VS_WORKBOOK'];
  // Témoin : le même classeur, en XOF comme la Fund Position, donne un écart chiffré.
  const witness = compareFundPosition(fund, D, balances, [bdkWorkbook()]);
  assert.equal(witness.find((entry) => entry.bank === 'BDK' && entry.indicator === 'FUND_APPLIED_VS_WORKBOOK')!.delta, 20);
  const cases: Array<[string, string | null]> = [
    ['classeur dans une autre devise', 'EUR'],
    ['classeur sans devise établie', null],
  ];
  for (const [label, currency] of cases) {
    const workbook = bdkWorkbook(D, tabName('2026-06-04'), currency);
    assert.equal(workbook.available, true, label);
    assert.equal(workbook.balanceDate, D, label);
    assert.equal(workbook.currency, currency, label);
    const comparisons = compareFundPosition(fund, D, balances, [workbook]).filter((entry) => entry.bank === 'BDK');
    for (const indicator of workbookIndicators) {
      const comparison = comparisons.find((entry) => entry.indicator === indicator)!;
      assert.equal(comparison.status, 'NOT_COMPARABLE', `${label} ${indicator}`);
      assert.equal(comparison.reason, 'CURRENCY_NOT_COMPARABLE', `${label} ${indicator}`);
      assert.equal(comparison.delta, null, `${label} ${indicator}`);
    }
    // La comparaison au relevé, dont la devise est établie, reste chiffrée : seul le classeur est écarté.
    assert.equal(comparisons.find((entry) => entry.indicator === 'BANK_BALANCE_VS_STATEMENT')!.status, 'EQUAL', label);
  }
});

test('écarts calculés seulement à date, périmètre et devise comparables', () => {
  const fund = reading();
  assert.equal(fund.referenceDate, D);
  assert.equal(fund.currency, 'XOF');
  assert.equal(fund.dateComparable, true);
  const comparisons = compareFundPosition(fund, D, bdkBalances(), [bdkWorkbook()]);
  const pick = (bank: string, indicator: string) => comparisons.find((entry) => entry.bank === bank && entry.indicator === indicator)!;

  assert.equal(pick('BDK', 'BANK_BALANCE_VS_STATEMENT').status, 'EQUAL');
  assert.equal(pick('BDK', 'BANK_BALANCE_VS_WORKBOOK').status, 'EQUAL');
  const applied = pick('BDK', 'FUND_APPLIED_VS_WORKBOOK');
  assert.equal(applied.status, 'DIFFERENT');
  assert.equal(applied.declared, 500);
  assert.equal(applied.source, 480);
  assert.equal(applied.delta, 20);
  assert.equal(pick('BDK', 'NON_VALIDATED_VS_WORKBOOK').status, 'EQUAL');
  // Banque Atlantique : aucune source vérifiée → non comparable, aucun écart chiffré.
  const atb = pick('ATB', 'BANK_BALANCE_VS_STATEMENT');
  assert.equal(atb.status, 'NOT_COMPARABLE');
  assert.equal(atb.reason, 'SOURCE_UNAVAILABLE');
  assert.equal(atb.delta, null);
  // BICIS : valeur déclarée absente.
  assert.equal(pick('BICIS', 'BANK_BALANCE_VS_STATEMENT').reason, 'DECLARED_ABSENT');
  // Fund Position indisponible : aucune comparaison.
  assert.deepEqual(compareFundPosition(reading(undefined, '2026-06-05'), '2026-06-05', bdkBalances(), [bdkWorkbook()]), []);
});
