import assert from 'node:assert/strict';
import test from 'node:test';

import { compareFundPosition, readFundPosition } from './fundPositionReading';
import { readMonthlyWorkbook } from './monthlyWorkbook';
import { csvStatementBytes, fundPositionBytes, monthlyWorkbookBytes, sheetFromRows, tabName, workbookBytes } from './situationSyntheticFixtures';
import type { SyntheticFundPositionRow } from './situationSyntheticFixtures';
import { buildAccountBalances, evaluateStatement } from './statementBalances';

const D = '2026-06-03';
const TODAY = '2026-06-05';

const ROWS: SyntheticFundPositionRow[] = [
  { label: 'SGBS', bankBalance: 0, fundApplied: 0, netBalance: 0, nonValidatedDeposit: 0, position: 0 },
  { label: 'BDK', bankBalance: 1050, fundApplied: 500, netBalance: 550, nonValidatedDeposit: 700, position: 1250 },
  { label: 'Bque Atlantique', bankBalance: 900, fundApplied: 100, netBalance: 790, nonValidatedDeposit: 10, position: 810 },
  { label: 'BICIS', bankBalance: 'n/a', fundApplied: 5 },
];

type FundTab = { name: string; rows: SyntheticFundPositionRow[]; hidden?: boolean };

function reading(tabs: FundTab[] = [{ name: tabName('2026-06-04'), rows: ROWS }], date = D, today = TODAY) {
  return readFundPosition(fundPositionBytes(tabs), date, today);
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
  const result = reading([{ name: tabName('2026-06-04'), rows: [...ROWS, { label: 'SYNTHETIC UNKNOWN LABEL', bankBalance: 12345 }] }]);
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
  const result = reading([{ name: tabName('2026-06-04'), rows: [
    { label: 'BDK USD', bankBalance: 12, fundApplied: 0, netBalance: 12, nonValidatedDeposit: 0, position: 12 },
    { label: 'TOTAL BDK', bankBalance: 55555, fundApplied: 0, netBalance: 55555, nonValidatedDeposit: 0, position: 55555 },
  ] }]);
  assert.equal(result.available, true);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues.map((issue) => [issue.code, issue.address]), [['BANK_LABEL_UNKNOWN', 'B2']]);
  assert.deepEqual(compareFundPosition(result, D, [], []), []);
});

test('deux onglets ramenés à la même date : lecture indisponible', () => {
  const result = reading([{ name: `${tabName('2026-06-04')} `, rows: ROWS }, { name: tabName('2026-06-04'), rows: ROWS }]);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'TAB_AMBIGUOUS');
  assert.deepEqual(result.rows, []);
});

test('ligne de banque en double : ambiguë, donc non lue', () => {
  const result = reading([{ name: tabName('2026-06-04'), rows: [{ label: 'BDK', bankBalance: 1 }, { label: 'BDK', bankBalance: 2 }] }]);
  assert.equal(result.rows.some((row) => row.bank === 'BDK'), false);
  assert.ok(result.issues.some((issue) => issue.code === 'BANK_ROW_AMBIGUOUS' && issue.bank === 'BDK'));
});

test('onglet retenu : le premier daté après D, jamais masqué ni daté après aujourd’hui', () => {
  const tabs = [
    { name: '040629', rows: ROWS },
    { name: tabName('2026-06-05'), rows: ROWS },
    { name: tabName('2026-06-04'), rows: ROWS },
    { name: tabName('2026-06-03'), rows: ROWS },
  ];
  const direct = reading(tabs);
  assert.equal(direct.tabName, tabName('2026-06-04'));
  assert.equal(direct.dateComparable, true);
  // Aucun onglet après D à la date du jour : indisponible.
  assert.equal(reading(tabs, '2026-06-05').available, false);
  assert.equal(reading(tabs, '2026-06-05').reason, 'TAB_ABSENT');
  // D = vendredi, onglet du lundi : comparable s'il est déjà permis de le lire, absent sinon.
  const monday = [{ name: tabName('2026-06-08'), rows: ROWS }];
  assert.equal(reading(monday, '2026-06-05', '2026-06-08').dateComparable, true);
  assert.equal(reading(monday, '2026-06-05', '2026-06-05').reason, 'TAB_ABSENT');
  // Onglet masqué : ignoré au profit du suivant.
  const hiddenFirst = reading([{ name: tabName('2026-06-04'), rows: ROWS, hidden: true }, { name: tabName('2026-06-05'), rows: ROWS }]);
  assert.equal(hiddenFirst.tabName, tabName('2026-06-05'));
  // En-tête introuvable, ou répété donc ambigu.
  const noHeader = readFundPosition(monthlyWorkbookBytes([{ name: tabName('2026-06-04'), labelDate: D, titleBank: 'BDK', opening: 1 }]), D, TODAY);
  assert.equal(noHeader.available, false);
  assert.equal(noHeader.reason, 'HEADER_NOT_FOUND');
  const repeated = readFundPosition(workbookBytes([{ name: tabName('2026-06-04'), sheet: sheetFromRows([
    ['', '', 'Bank Balance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', 'Bank Balance'],
    ['Book balance', 'BDK', 1, 1, 0, 0, 0],
  ]) }]), D, TODAY);
  assert.equal(repeated.reason, 'HEADER_NOT_FOUND');
});

test('onglet manquant entre D et l’onglet lu : dates non comparables, aucun écart chiffré', () => {
  // D = mercredi 03/06 ; l'onglet du jeudi manque, seul celui du vendredi existe.
  const skipped = reading([{ name: tabName('2026-06-05'), rows: ROWS }]);
  assert.equal(skipped.available, true);
  assert.equal(skipped.dateComparable, false);
  const balances = buildAccountBalances([evaluateStatement({
    name: '040626 SYNTHETIC BDK ONLINE.csv',
    bytes: csvStatementBytes({ periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000, movements: [{ date: D, amount: 50 }] }),
  }, D, TODAY)]);
  assert.equal(balances.find((balance) => balance.bank === 'BDK')!.status, 'AVAILABLE');
  const comparisons = compareFundPosition(skipped, D, balances, []);
  assert.ok(comparisons.length > 0);
  for (const comparison of comparisons) {
    assert.equal(comparison.status, 'NOT_COMPARABLE');
    assert.equal(comparison.reason, 'DATE_NOT_COMPARABLE');
    assert.equal(comparison.delta, null);
  }
  // Onglet très éloigné : même conclusion.
  assert.equal(reading([{ name: tabName('2026-06-04'), rows: ROWS }], '2026-05-10').dateComparable, false);
});

test('périmètre et devise : un solde d’une autre devise ou un classeur d’une autre date n’est pas comparé', () => {
  const fund = reading();
  const euro = compareFundPosition(fund, D, [{
    bank: 'BDK', currency: 'EUR', status: 'AVAILABLE', amount: 1050, balanceDate: D, identityProof: 'CONTENT', reasons: [], sources: [],
  }], []);
  const statement = euro.find((entry) => entry.bank === 'BDK' && entry.indicator === 'BANK_BALANCE_VS_STATEMENT')!;
  assert.equal(statement.status, 'NOT_COMPARABLE');
  assert.equal(statement.reason, 'CURRENCY_NOT_COMPARABLE');
  assert.equal(statement.delta, null);

  const otherDay = '2026-06-02';
  const workbook = readMonthlyWorkbook({
    name: 'SYNTHETIC BDK 2026.xlsx',
    bytes: monthlyWorkbookBytes([{ name: tabName('2026-06-03'), labelDate: otherDay, titleBank: 'BDK', opening: 1050, cheques: [{ date: otherDay, number: 5550001, amount: 500 }] }]),
  }, otherDay, TODAY);
  assert.equal(workbook.available, true);
  const stale = compareFundPosition(fund, D, [], [workbook]).find((entry) => entry.bank === 'BDK' && entry.indicator === 'FUND_APPLIED_VS_WORKBOOK')!;
  assert.equal(stale.status, 'NOT_COMPARABLE');
  assert.equal(stale.reason, 'DATE_NOT_COMPARABLE');
});

test('écarts calculés seulement à date, périmètre et devise comparables', () => {
  const balances = buildAccountBalances([evaluateStatement({
    name: '040626 SYNTHETIC BDK ONLINE.csv',
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000,
      movements: [{ date: '2026-06-01', amount: -100 }, { date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 }],
    }),
  }, D, TODAY)]);
  const workbook = readMonthlyWorkbook({
    name: 'SYNTHETIC BDK 2026.xlsx',
    bytes: monthlyWorkbookBytes([{
      name: tabName('2026-06-04'), labelDate: D, titleBank: 'BDK', opening: 1050,
      deposits: [{ date: D, dueDate: '2026-09-01', client: 'SYNTHETIC CLIENT A', amount: 700 }],
      cheques: [{ date: D, number: 5550001, amount: 480 }],
    }]),
  }, D, TODAY);
  const comparisons = compareFundPosition(reading(), D, balances, [workbook]);
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
  assert.deepEqual(compareFundPosition(reading(undefined, '2026-06-05'), '2026-06-05', balances, [workbook]), []);
});
