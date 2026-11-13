import assert from 'node:assert/strict';
import test from 'node:test';

import { compareFundPosition, readFundPosition } from './fundPositionReading';
import { readMonthlyWorkbook } from './monthlyWorkbook';
import { csvStatementBytes, fundPositionBytes, monthlyWorkbookBytes, sheetFromRows, tabName, workbookBytes } from './situationSyntheticFixtures';
import type { SyntheticFundPositionReference, SyntheticFundPositionRow } from './situationSyntheticFixtures';
import type { FundPositionDateAttestation } from './fundPositionReading';
import { buildAccountBalances, evaluateStatement } from './statementBalances';

const D = '2026-06-03';
const TODAY = '2026-06-05';
/** Les trois champs explicites de l'onglet : « Situation au » égal à D, « Devise », « Unité ». */
const AT_D: SyntheticFundPositionReference = { date: D, currency: 'XOF', unit: 'francs entiers' };

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

/** Classeur mensuel BDK ; `currency` et `unit` : champs de l'en-tête de l'onglet, `null` pour ne pas les écrire (convention SODATRA). */
function bdkWorkbook(date = D, tab = tabName('2026-06-04'), currency: string | null = 'XOF', unit: string | null = 'francs entiers') {
  return readMonthlyWorkbook({
    name: 'SYNTHETIC BDK 2026.xlsx',
    bytes: monthlyWorkbookBytes([{
      name: tab, labelDate: date, titleBank: 'BDK', opening: 1050, currency: currency ?? undefined, unit: unit ?? undefined,
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
  const monday: FundTab[] = [{ name: tabName('2026-06-08'), rows: ROWS, reference: { ...AT_D, date: '2026-06-05' } }];
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

test('le nom de l’onglet ne prouve pas la date : sans champ valide ni confirmation, référence lue sans écart chiffré', () => {
  const balances = bdkBalances();
  const workbook = bdkWorkbook();
  assert.equal(balances.find((balance) => balance.bank === 'BDK')!.status, 'AVAILABLE');
  assert.equal(workbook.available, true);
  const cases: Array<[string, SyntheticFundPositionReference | undefined, string]> = [
    // Onglet du lendemain sans aucun champ : forme actuelle d'une Fund Position, avant toute confirmation.
    ['aucun champ, aucune confirmation', undefined, 'DATE_NOT_COMPARABLE'],
    ['« Situation au » différent de D', { ...AT_D, date: '2026-06-02' }, 'DATE_NOT_COMPARABLE'],
    ['champ « Devise » dans une autre devise', { ...AT_D, currency: 'EUR' }, 'CURRENCY_NOT_COMPARABLE'],
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
  // Sans aucun champ : la date n'est pas établie ; devise et unité viennent de la convention SODATRA, et c'est dit.
  const none = reading([{ name: tabName('2026-06-04'), rows: ROWS }]);
  assert.equal(none.referenceDate, null);
  assert.equal(none.dateProof, null);
  assert.equal(none.dateField, 'ABSENT');
  assert.equal(none.dateComparable, false);
  assert.deepEqual([none.currency, none.currencyProvenance], ['XOF', 'CONVENTION']);
  assert.deepEqual([none.unit, none.unitProvenance], ['UNITS', 'CONVENTION']);
  // Champs écrits : lus dans le fichier.
  const written = reading();
  assert.deepEqual([written.referenceDate, written.dateProof, written.dateField], [D, 'FILE', 'VALID']);
  assert.deepEqual([written.currency, written.currencyProvenance], ['XOF', 'FILE']);
  assert.deepEqual([written.unit, written.unitProvenance], ['UNITS', 'FILE']);
});

test('date de la Fund Position : confirmation de l’opérateur, seulement pour l’onglet du lendemain et un champ absent', () => {
  const tab = tabName('2026-06-04');
  const confirm: FundPositionDateAttestation = { tabName: tab, accountingDate: D };
  const read = (tabs: FundTab[], attestation?: FundPositionDateAttestation) => readFundPosition(fundPositionBytes(tabs), D, TODAY, attestation);
  // Onglet du lendemain, champ absent : la confirmation est proposée ; sans elle, rien n'est comparé.
  const plain: FundTab[] = [{ name: tab, rows: ROWS }];
  const asked = read(plain);
  assert.equal(asked.needsDateAttestation, true);
  assert.equal(asked.referenceDate, null);
  assert.equal(asked.dateComparable, false);
  // Confirmée pour ce fichier, cet onglet et cette date : la date est établie, et sa provenance est dite.
  const confirmed = read(plain, confirm);
  assert.deepEqual([confirmed.referenceDate, confirmed.dateProof, confirmed.dateComparable], [D, 'OPERATOR', true]);
  const comparisons = compareFundPosition(confirmed, D, bdkBalances(), [bdkWorkbook(D, tab, null, null)]);
  const pick = (indicator: string) => comparisons.find((entry) => entry.bank === 'BDK' && entry.indicator === indicator)!;
  assert.equal(pick('BANK_BALANCE_VS_STATEMENT').status, 'EQUAL');
  assert.equal(pick('FUND_APPLIED_VS_WORKBOOK').delta, 20);
  // Confirmation donnée pour un autre onglet ou pour une autre date comptable : sans effet.
  for (const other of [{ tabName: tabName('2026-06-05'), accountingDate: D }, { tabName: tab, accountingDate: '2026-06-02' }]) {
    const ignored = read(plain, other);
    assert.deepEqual([ignored.referenceDate, ignored.dateProof, ignored.dateComparable], [null, null, false], JSON.stringify(other));
  }
  // Premier onglet après D daté du surlendemain : aucune confirmation proposée, et une confirmation donnée ne débloque rien.
  const dayAfterNext = tabName('2026-06-05');
  for (const attestation of [undefined, { tabName: dayAfterNext, accountingDate: D }]) {
    const later = read([{ name: dayAfterNext, rows: ROWS }], attestation);
    assert.equal(later.available, true);
    assert.equal(later.tabName, dayAfterNext);
    assert.equal(later.needsDateAttestation, false);
    assert.equal(later.dateComparable, false);
  }
  // Onglet du lendemain masqué : l'onglet visible suivant est lu, sans confirmation possible.
  const hiddenNext = read([{ name: tab, rows: ROWS, hidden: true }, { name: dayAfterNext, rows: ROWS }], confirm);
  assert.equal(hiddenNext.tabName, dayAfterNext);
  assert.equal(hiddenNext.needsDateAttestation, false);
  assert.equal(hiddenNext.dateComparable, false);
  // Deux onglets ramenés au lendemain : ambigu, lecture indisponible, confirmation sans objet.
  const twins = read([{ name: `${tab} `, rows: ROWS }, { name: tab, rows: ROWS }], confirm);
  assert.equal(twins.available, false);
  assert.equal(twins.reason, 'TAB_AMBIGUOUS');
  assert.equal(twins.needsDateAttestation, false);
  // Champ « Situation au » invalide (écrit deux fois, mal formé, sans valeur) : la confirmation n'est pas
  // proposée et ne débloque rien.
  const invalid: SyntheticFundPositionReference[] = [
    { date: D, texts: ['Situation au 03/06/2026'] }, { dateText: 'Situation au 03/06/2026 (provisoire)' }, { texts: ['Situation au'] },
  ];
  for (const reference of invalid) {
    const blocked = read([{ name: tab, rows: ROWS, reference }], confirm);
    assert.equal(blocked.dateField, 'INVALID', JSON.stringify(reference));
    assert.equal(blocked.needsDateAttestation, false, JSON.stringify(reference));
    assert.deepEqual([blocked.referenceDate, blocked.dateProof, blocked.dateComparable], [null, null, false], JSON.stringify(reference));
  }
  // Champ valide mais contraire à D : il bloque la comparaison, la confirmation ne le remplace pas.
  const contrary = read([{ name: tab, rows: ROWS, reference: { date: '2026-06-02' } }], confirm);
  assert.deepEqual([contrary.dateField, contrary.referenceDate, contrary.dateProof, contrary.dateComparable], ['VALID', '2026-06-02', 'FILE', false]);
  assert.equal(contrary.needsDateAttestation, false);
  // Champ valide égal à D : il suffit, même sur un onglet daté plus tard, sans aucune confirmation.
  const explicit = read([{ name: dayAfterNext, rows: ROWS, reference: { date: D } }]);
  assert.deepEqual([explicit.referenceDate, explicit.dateProof, explicit.dateComparable], [D, 'FILE', true]);
});

test('champ « Situation au » : libellé explicite, une date au jour près, écrit une seule fois', () => {
  const FIELDS = { currency: 'XOF', unit: 'francs entiers' };
  const read = (reference: SyntheticFundPositionReference) => reading([{ name: tabName('2026-06-04'), rows: ROWS, reference: { ...FIELDS, ...reference } }]);
  // Témoins : le champ dans deux cellules voisines ou dans une seule, sous plusieurs écritures de date.
  const witnesses: SyntheticFundPositionReference[] = [
    { date: D }, { dateText: 'Situation au 3 juin 2026' }, { dateText: 'Situation au : 03/06/2026' },
    { dateText: 'Date de situation : 2026-06-03' }, { texts: ['Situation au', '03/06/26'] },
  ];
  for (const reference of witnesses) {
    const fund = read(reference);
    assert.equal(fund.referenceDate, D, JSON.stringify(reference));
    assert.equal(fund.dateComparable, true, JSON.stringify(reference));
  }
  // Les autres dates de l'onglet (impression, échéances) ne comptent pas : seule la cellule libellée dit la date.
  const amongOtherDates = reading([{
    name: tabName('2026-06-04'),
    reference: { ...AT_D, otherDate: '2026-06-02', texts: ['Imprimé le 04/06/2026', 'Echéance 12/12/2025'] },
    rows: ROWS.map((row) => (row.label === 'BDK' ? { ...row, note: 'Echéance 05/10/2025' } : row)),
  }]);
  assert.equal(amongOtherDates.referenceDate, D);
  assert.equal(amongOtherDates.dateComparable, true);
  assert.equal(compareFundPosition(amongOtherDates, D, bdkBalances(), [bdkWorkbook()])
    .find((entry) => entry.bank === 'BDK' && entry.indicator === 'FUND_APPLIED_VS_WORKBOOK')!.delta, 20);
  const refused: Array<[string, SyntheticFundPositionReference]> = [
    ['date écrite sans libellé', { dateText: '03/06/2026' }],
    ['autre libellé', { dateText: 'Imprimé le 03/06/2026' }],
    ['libellé qui n’ouvre pas la cellule', { dateText: 'Voir Situation au 03/06/2026' }],
    ['« date du jour » n’est pas la date de situation', { dateText: 'Date du jour : 03/06/2026' }],
    ['libellé non prévu', { dateText: 'As of 2026-06-03' }],
    ['champ suivi d’une mention', { dateText: 'Situation au 03/06/2026 (provisoire)' }],
    ['champ portant une période', { dateText: 'Situation au 03/06/2026 - 04/06/2026' }],
    ['champ au mois près', { dateText: 'Situation au juin 2026' }],
    ['champ sans année', { dateText: 'Situation au 3 juin' }],
    ['champ sans valeur', { texts: ['Situation au'] }],
    ['champ écrit deux fois, même date', { date: D, texts: ['Situation au 03/06/2026'] }],
    ['deux champs contradictoires', { date: D, texts: ['Situation au 02/06/2026'] }],
  ];
  const balances = bdkBalances();
  const workbook = bdkWorkbook();
  for (const [label, reference] of refused) {
    const fund = read(reference);
    assert.equal(fund.available, true, label);
    assert.equal(fund.referenceDate, null, label);
    assert.equal(fund.dateComparable, false, label);
    for (const comparison of compareFundPosition(fund, D, balances, [workbook])) {
      assert.equal(comparison.status, 'NOT_COMPARABLE', label);
      assert.equal(comparison.reason, 'DATE_NOT_COMPARABLE', label);
      assert.equal(comparison.delta, null, label);
    }
  }
  // Un second champ écrit SOUS l'en-tête, sur la ligne d'une banque : le champ n'est plus unique.
  const below = reading([{
    name: tabName('2026-06-04'), reference: AT_D,
    rows: ROWS.map((row) => (row.label === 'BDK' ? { ...row, note: 'Situation au 02/06/2026' } : row)),
  }]);
  assert.equal(below.referenceDate, null);
  assert.equal(below.dateComparable, false);
});

test('devise : champ explicite ou convention SODATRA ; mention contraire, ambiguë ou invalide, aucune comparaison', () => {
  const tab = tabName('2026-06-04');
  const withNote = (note: string) => ROWS.map((row) => (row.label === 'BDK' ? { ...row, note } : row));
  // Champ absent et rien de contraire : convention SODATRA, y compris quand la même devise est écrite sans libellé.
  const conventional: FundTab[] = [
    { name: tab, rows: ROWS, reference: { date: D } },
    { name: tab, rows: withNote('FCFA'), reference: { date: D } },
    { name: tab, rows: ROWS, reference: { date: D, texts: ['XOF'] } },
    { name: tab, rows: ROWS, reference: { date: D, texts: ['Montants - Devise : XOF'] } },
  ];
  for (const fundTab of conventional) {
    const fund = reading([fundTab]);
    assert.deepEqual([fund.currency, fund.currencyProvenance], ['XOF', 'CONVENTION'], JSON.stringify(fundTab.reference));
  }
  // Champ valide : lu dans le fichier ; la même devise répétée ailleurs ne le contredit pas.
  const same = reading([{ name: tab, rows: withNote('FCFA'), reference: AT_D }]);
  assert.deepEqual([same.currency, same.currencyProvenance], ['XOF', 'FILE']);
  const cases: Array<[string, FundTab]> = [
    ['champ écrit deux fois', { name: tab, rows: ROWS, reference: { ...AT_D, texts: ['Devise : XOF'] } }],
    ['champ suivi d’une mention', { name: tab, rows: ROWS, reference: { date: D, texts: ['Devise : XOF provisoire'] } }],
    ['champ contredit par une autre devise dans l’en-tête', { name: tab, rows: ROWS, reference: { ...AT_D, texts: ['USD'] } }],
    ['champ contredit sur la ligne d’une banque', { name: tab, rows: withNote('USD'), reference: AT_D }],
    ['champ contredit par un symbole', { name: tab, rows: ROWS, reference: { ...AT_D, texts: ['Montants en €'] } }],
    ['champ absent, autre devise écrite dans l’en-tête', { name: tab, rows: ROWS, reference: { date: D, texts: ['USD'] } }],
    ['champ absent, autre devise sur la ligne d’une banque', { name: tab, rows: withNote('Contre-valeur EUR'), reference: { date: D } }],
    ['libellé « Devise » qui n’ouvre pas la cellule, autre devise', { name: tab, rows: ROWS, reference: { date: D, texts: ['Montants - Devise : EUR'] } }],
  ];
  for (const [label, fundTab] of cases) {
    const fund = reading([fundTab]);
    assert.deepEqual([fund.currency, fund.currencyProvenance], [null, null], label);
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
    bank: 'BDK', currency: 'EUR', status: 'AVAILABLE', amount: 1050, balanceDate: D, identityProof: 'OPERATOR', currencyProof: 'CONTENT', reasons: [], sources: [], observed: null,
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

test('solde seulement observé : jamais comparé à la Fund Position', () => {
  // Relevé sans opération postérieure à D : clôture non prouvée, dernier solde observé daté de D.
  const observedOnly = buildAccountBalances([evaluateStatement({
    name: 'SYNTHETIC BDK ONLINE.csv',
    attestation: { identityAttested: true },
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000,
      movements: [{ date: '2026-06-01', amount: -100 }, { date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 }],
    }),
  }, D, TODAY)]);
  const bdk = observedOnly.find((balance) => balance.bank === 'BDK')!;
  assert.equal(bdk.status, 'TO_REVIEW');
  assert.equal(bdk.amount, null);
  assert.deepEqual(bdk.observed, { amount: 1050, date: D });
  // La Fund Position déclare exactement ce montant : la comparaison reste fermée, sans source ni écart.
  const statement = compareFundPosition(reading(), D, observedOnly, [bdkWorkbook()])
    .find((entry) => entry.bank === 'BDK' && entry.indicator === 'BANK_BALANCE_VS_STATEMENT')!;
  assert.equal(statement.status, 'NOT_COMPARABLE');
  assert.equal(statement.reason, 'SOURCE_UNAVAILABLE');
  assert.equal(statement.source, null);
  assert.equal(statement.delta, null);
});

test('classeur mensuel : devise ou unité contraire ou invalide, non comparable ; champ absent, convention SODATRA', () => {
  const fund = reading();
  const balances = bdkBalances();
  const tab = tabName('2026-06-04');
  const workbookIndicators = ['BANK_BALANCE_VS_WORKBOOK', 'FUND_APPLIED_VS_WORKBOOK', 'NON_VALIDATED_VS_WORKBOOK'];
  // Témoins : champs écrits dans le classeur, puis classeur sans aucun champ (convention SODATRA) : écart chiffré.
  for (const [currency, unit, provenance] of [['XOF', 'francs entiers', 'FILE'], [null, null, 'CONVENTION']] as const) {
    const workbook = bdkWorkbook(D, tab, currency, unit);
    assert.deepEqual([workbook.currency, workbook.currencyProvenance, workbook.unit, workbook.unitProvenance], ['XOF', provenance, 'UNITS', provenance]);
    const witness = compareFundPosition(fund, D, balances, [workbook]);
    assert.equal(witness.find((entry) => entry.bank === 'BDK' && entry.indicator === 'FUND_APPLIED_VS_WORKBOOK')!.delta, 20);
  }
  const blocked: Array<[string, string | null, string | null, string]> = [
    ['classeur dans une autre devise', 'EUR', 'francs entiers', 'CURRENCY_NOT_COMPARABLE'],
    ['classeur au champ « Devise » invalide', 'XOF / EUR', 'francs entiers', 'CURRENCY_NOT_COMPARABLE'],
    ['classeur en milliers', 'XOF', 'milliers', 'UNIT_NOT_COMPARABLE'],
    ['classeur au champ « Unité » invalide', 'XOF', 'francs', 'UNIT_NOT_COMPARABLE'],
  ];
  for (const [label, currency, unit, reason] of blocked) {
    const workbook = bdkWorkbook(D, tab, currency, unit);
    assert.equal(workbook.available, true, label);
    assert.equal(workbook.balanceDate, D, label);
    const comparisons = compareFundPosition(fund, D, balances, [workbook]).filter((entry) => entry.bank === 'BDK');
    for (const indicator of workbookIndicators) {
      const comparison = comparisons.find((entry) => entry.indicator === indicator)!;
      assert.equal(comparison.status, 'NOT_COMPARABLE', `${label} ${indicator}`);
      assert.equal(comparison.reason, reason, `${label} ${indicator}`);
      assert.equal(comparison.delta, null, `${label} ${indicator}`);
    }
    // La comparaison au relevé reste chiffrée : seul le classeur est écarté.
    assert.equal(comparisons.find((entry) => entry.indicator === 'BANK_BALANCE_VS_STATEMENT')!.status, 'EQUAL', label);
  }
});

test('unité : champ explicite ou convention SODATRA ; indication d’échelle ou mention contraire, aucun écart chiffré', () => {
  const balances = bdkBalances();
  const tab = tabName('2026-06-04');
  const pick = (comparisons: ReturnType<typeof compareFundPosition>, indicator: string) => comparisons.find((entry) => entry.bank === 'BDK' && entry.indicator === indicator)!;
  // Champ absent et rien de contraire : convention SODATRA, y compris quand « francs entiers » est écrit sans libellé.
  for (const reference of [{ date: D, currency: 'XOF' }, { date: D, currency: 'XOF', texts: ['en francs entiers'] }]) {
    const byConvention = reading([{ name: tab, rows: ROWS, reference }]);
    assert.deepEqual([byConvention.unit, byConvention.unitProvenance], ['UNITS', 'CONVENTION'], JSON.stringify(reference));
    const comparisons = compareFundPosition(byConvention, D, balances, [bdkWorkbook(D, tab, 'XOF', null)]);
    assert.equal(pick(comparisons, 'BANK_BALANCE_VS_STATEMENT').status, 'EQUAL');
    assert.equal(pick(comparisons, 'FUND_APPLIED_VS_WORKBOOK').delta, 20);
  }
  // Champ valide, lu dans le fichier, même écrit au-delà de la colonne P.
  const far = reading([{ name: tab, rows: ROWS, reference: { ...AT_D, texts: ['', '', '', '', '', '', ''] } }]);
  assert.deepEqual([far.unit, far.unitProvenance], ['UNITS', 'FILE']);
  // Champ invalide ou contredit, ou indication d'échelle écrite dans l'onglet : aucune unité, aucune convention.
  const noUnit: Array<[string, SyntheticFundPositionReference]> = [
    ['champ mal formé', { date: D, currency: 'XOF', unit: 'francs' }],
    ['champ écrit deux fois', { ...AT_D, texts: ['Unité : francs entiers'] }],
    ['champ contredit par une autre mention', { ...AT_D, texts: ['(en milliers)'] }],
    ['champ absent, « en milliers » écrit dans l’onglet', { date: D, currency: 'XOF', texts: ['Montants en milliers'] }],
    ['champ absent, « K FCFA » dans un en-tête de montants', { date: D, texts: ['Montants K FCFA'] }],
    ['champ absent, « (000) » dans un en-tête de montants', { date: D, currency: 'XOF', texts: ['Montants (000)'] }],
    ['libellé « Unité » qui n’ouvre pas la cellule, autre unité', { date: D, currency: 'XOF', texts: ['Note - Unité : milliers'] }],
  ];
  for (const [label, reference] of noUnit) {
    const fund = reading([{ name: tab, rows: ROWS, reference }]);
    assert.deepEqual([fund.unit, fund.unitProvenance], [null, null], label);
    assert.equal(fund.currency, 'XOF', label);
    assert.equal(fund.dateComparable, true, label);
    // Y compris face à un classeur dont l'unité n'est pas établie non plus : deux absences ne font pas un accord.
    for (const workbook of [bdkWorkbook(), bdkWorkbook(D, tab, 'XOF', 'francs')]) {
      const comparisons = compareFundPosition(fund, D, balances, [workbook]);
      assert.ok(comparisons.length > 0, label);
      for (const comparison of comparisons) {
        assert.equal(comparison.status, 'NOT_COMPARABLE', label);
        assert.equal(comparison.reason, 'UNIT_NOT_COMPARABLE', label);
        assert.equal(comparison.delta, null, label);
      }
    }
  }
  // Variantes d'écriture de l'échelle, champ absent : toutes retirent la convention « francs entiers ».
  const scales = [
    'Montants en milliers', 'K FCFA', 'KFCFA', 'kXOF', 'K F CFA', 'KCFA', 'KF', 'K F', 'K FRS', 'Montants (K)', 'en K',
    '(000)', '(000 FCFA)', '000 FCFA', '(en 000)', "'000", "000's", 'x1000', 'x 1 000', '×1000', '/1000', 'en mille', 'mille FCFA',
    'M FCFA', 'MFCFA', 'Mio', 'en millions', 'MXOF', 'Mds FCFA', 'milliards', 'Thousands',
  ];
  for (const scale of scales) {
    const fund = reading([{ name: tab, rows: ROWS, reference: { date: D, texts: [scale] } }]);
    assert.deepEqual([fund.unit, fund.unitProvenance], [null, null], scale);
    for (const comparison of compareFundPosition(fund, D, balances, [bdkWorkbook()])) {
      assert.equal(comparison.status, 'NOT_COMPARABLE', scale);
      assert.equal(comparison.delta, null, scale);
    }
  }
  // Témoins : un montant écrit avec ses milliers, ou un mot voisin, n'est pas une indication d'échelle.
  for (const harmless of ['Plafond 1 000 FCFA', 'Total 25 000 XOF', 'Référence 000123', 'KFW', 'Skf', 'MILLENIUM', 'Taux x 1,05']) {
    const fund = reading([{ name: tab, rows: ROWS, reference: { date: D, texts: [harmless] } }]);
    assert.deepEqual([fund.unit, fund.unitProvenance], ['UNITS', 'CONVENTION'], harmless);
  }
  // Fund Position en milliers (champ valide) : un relevé, en francs entiers, n'est pas comparé ; un classeur en
  // milliers l'est, sans conversion ; un classeur en francs entiers par convention ne l'est pas.
  const thousands = reading([{ name: tab, rows: ROWS, reference: { ...AT_D, unit: 'milliers' } }]);
  assert.deepEqual([thousands.unit, thousands.unitProvenance], ['THOUSANDS', 'FILE']);
  const mixed = compareFundPosition(thousands, D, balances, [bdkWorkbook(D, tab, 'XOF', 'milliers')]);
  assert.equal(pick(mixed, 'BANK_BALANCE_VS_STATEMENT').status, 'NOT_COMPARABLE');
  assert.equal(pick(mixed, 'BANK_BALANCE_VS_STATEMENT').reason, 'UNIT_NOT_COMPARABLE');
  assert.equal(pick(mixed, 'BANK_BALANCE_VS_STATEMENT').delta, null);
  assert.equal(pick(mixed, 'FUND_APPLIED_VS_WORKBOOK').status, 'DIFFERENT');
  assert.equal(pick(mixed, 'BANK_BALANCE_VS_WORKBOOK').status, 'EQUAL');
  const conventionalWorkbook = compareFundPosition(thousands, D, balances, [bdkWorkbook(D, tab, null, null)]);
  assert.equal(pick(conventionalWorkbook, 'FUND_APPLIED_VS_WORKBOOK').reason, 'UNIT_NOT_COMPARABLE');
  assert.equal(pick(conventionalWorkbook, 'FUND_APPLIED_VS_WORKBOOK').delta, null);
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
