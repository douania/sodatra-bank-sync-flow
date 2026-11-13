import assert from 'node:assert/strict';
import test from 'node:test';

import { compareFundPosition, readFundPosition } from './fundPositionReading';
import { readMonthlyWorkbook } from './monthlyWorkbook';
import { csvStatementBytes, fundPositionBytes, monthlyWorkbookBytes, sheetFromRows, tabName, workbookBytes } from './situationSyntheticFixtures';
import type { CellInput, SyntheticFundPositionReference, SyntheticFundPositionRow } from './situationSyntheticFixtures';
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

type FundTab = { name: string; rows: SyntheticFundPositionRow[]; hidden?: boolean; reference?: SyntheticFundPositionReference; footerRows?: CellInput[][] };

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
    ['champ « Unité » en milliers', { ...AT_D, unit: 'milliers' }, 'UNIT_NOT_COMPARABLE'],
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
  // proposée et ne débloque rien. Il en va de même d'un champ de position illisible : il n'est pas absent.
  const invalid: SyntheticFundPositionReference[] = [
    { date: D, texts: ['Situation au 03/06/2026'] }, { dateText: 'Situation au 03/06/2026 (provisoire)' }, { texts: ['Situation au'] },
    { dateText: 'Position arrêtée au N/A' }, { dateText: 'Situation au N/A' }, { dateText: 'Situation au : à préciser' }, { dateText: 'As at N/A' },
    { dateText: 'Date de situation : inconnue' }, { dateText: 'Arrêté au -' }, { dateText: 'Fund Position as of ??' }, { dateText: 'Position au xx/xx/xxxx' },
    { texts: ['Position arrêtée au', 'N/A'] }, { dateText: 'Situation au : niveau' },
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
  // Date de position contraire écrite sous un autre libellé de l'en-tête : même effet, la case n'est pas proposée.
  for (const dateText of ['Position arrêtée au 02/06/2026', 'Situation du 02/06/2026', 'As at 02/06/2026', 'Fund Position as of 02/06/2026', 'Arrêté au 02/06/2026', 'Position au 2 juin 2026']) {
    const other = read([{ name: tab, rows: ROWS, reference: { dateText } }], confirm);
    assert.deepEqual([other.dateField, other.referenceDate, other.dateProof, other.dateComparable], ['VALID', '2026-06-02', 'FILE', false], dateText);
    assert.equal(other.needsDateAttestation, false, dateText);
    for (const comparison of compareFundPosition(other, D, bdkBalances(), [bdkWorkbook()])) {
      assert.equal(comparison.status, 'NOT_COMPARABLE', dateText);
      assert.equal(comparison.reason, 'DATE_NOT_COMPARABLE', dateText);
      assert.equal(comparison.delta, null, dateText);
    }
  }
  // Témoins : une date d'échéance, d'impression ou de validité n'est pas la date de position ; la confirmation
  // reste proposée et suffit.
  for (const dateText of ['Echéance 02/06/2026', 'Imprimé le 02/06/2026', 'Valable jusqu’au 02/06/2026', 'Prochaine revue au 02/06/2026', 'Situation du compte']) {
    const ignored = read([{ name: tab, rows: ROWS, reference: { dateText } }], confirm);
    assert.equal(ignored.dateField, 'ABSENT', dateText);
    assert.equal(ignored.needsDateAttestation, true, dateText);
    assert.deepEqual([ignored.referenceDate, ignored.dateProof, ignored.dateComparable], [D, 'OPERATOR', true], dateText);
  }
  // Champ valide égal à D : il suffit, même sur un onglet daté plus tard, sans aucune confirmation.
  const explicit = read([{ name: dayAfterNext, rows: ROWS, reference: { date: D } }]);
  assert.deepEqual([explicit.referenceDate, explicit.dateProof, explicit.dateComparable], [D, 'FILE', true]);
});

test('date de position écrite : libellé explicite, une date au jour près, écrit une seule fois', () => {
  const FIELDS = { currency: 'XOF', unit: 'francs entiers' };
  const read = (reference: SyntheticFundPositionReference) => reading([{ name: tabName('2026-06-04'), rows: ROWS, reference: { ...FIELDS, ...reference } }]);
  // Témoins : le champ dans deux cellules voisines ou dans une seule, sous plusieurs écritures de date.
  const witnesses: SyntheticFundPositionReference[] = [
    { date: D }, { dateText: 'Situation au 3 juin 2026' }, { dateText: 'Situation au : 03/06/2026' },
    { dateText: 'Date de situation : 2026-06-03' }, { texts: ['Situation au', '03/06/26'] },
    // Autres libellés qui désignent la date de position.
    { dateText: 'Position arrêtée au 03/06/2026' }, { dateText: 'Situation arrêtée au 3 juin 2026' }, { dateText: 'Position au 03/06/2026' },
    { dateText: 'Situation du 03/06/26' }, { dateText: 'Arrêté au 03/06/2026' }, { dateText: 'Date de la position : 03/06/2026' },
    { dateText: 'As at 3 June 2026' }, { dateText: 'As of 2026-06-03' }, { dateText: 'Fund Position as at 03/06/2026' },
    { texts: ['Position arrêtée au', '03/06/2026'] },
  ];
  for (const reference of witnesses) {
    const fund = read(reference);
    assert.equal(fund.referenceDate, D, JSON.stringify(reference));
    assert.equal(fund.dateComparable, true, JSON.stringify(reference));
  }
  // Ne contredisent pas le champ : une date explicitement libellée autrement (impression, échéance), dans sa
  // cellule ou dans la cellule de gauche — y compris la date du nom de l'onglet ; le mois de D ; les dates
  // écrites sous le bloc des banques (échéances des facilités).
  const amongOtherDates = reading([{
    name: tabName('2026-06-04'),
    reference: { ...AT_D, texts: ['Imprimé le 01/06/2026', 'Echéance 12/12/2025', 'Maturity', { date: '2025-11-30' }, 'Edité le 04/06/2026', 'Juin 2026'] },
    rows: ROWS.map((row) => (row.label === 'BDK' ? { ...row, note: 'Echéance 05/10/2025' } : row)),
    footerRows: [['Facility', { date: '2025-03-31' }, { date: '2024-12-31' }], ['', 'Renouvelée le 15/01/2025', '2 mars']],
  }]);
  assert.equal(amongOtherDates.dateField, 'VALID');
  assert.deepEqual(amongOtherDates.dateConflictCells, []);
  assert.equal(amongOtherDates.referenceDate, D);
  assert.equal(amongOtherDates.dateComparable, true);
  assert.equal(compareFundPosition(amongOtherDates, D, bdkBalances(), [bdkWorkbook()])
    .find((entry) => entry.bank === 'BDK' && entry.indicator === 'FUND_APPLIED_VS_WORKBOOK')!.delta, 20);
  const refused: Array<[string, SyntheticFundPositionReference]> = [
    ['date écrite sans libellé', { dateText: '03/06/2026' }],
    ['autre libellé', { dateText: 'Imprimé le 03/06/2026' }],
    ['libellé qui n’ouvre pas la cellule', { dateText: 'Voir Situation au 03/06/2026' }],
    ['« date du jour » n’est pas la date de situation', { dateText: 'Date du jour : 03/06/2026' }],
    ['libellé qui n’est pas une date de position', { dateText: 'Valable jusqu’au 03/06/2026' }],
    ['« Situation du » sans date', { dateText: 'Situation du compte 03/06/2026' }],
    ['deux libellés de date de position', { date: D, texts: ['Position arrêtée au 03/06/2026'] }],
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

test('date de position : toute autre date écrite dans l’en-tête ou sur les lignes des banques bloque, quel que soit son libellé', () => {
  const tab = tabName('2026-06-04');
  const confirm: FundPositionDateAttestation = { tabName: tab, accountingDate: D };
  const balances = bdkBalances();
  const workbook = bdkWorkbook();
  const read = (tabs: FundTab[], attestation?: FundPositionDateAttestation) => readFundPosition(fundPositionBytes(tabs), D, TODAY, attestation);
  // Bloquée : aucune case proposée, la confirmation donnée ne débloque rien, aucun écart chiffré, cellule indiquée.
  const assertBlocked = (tabs: FundTab[], label: string, cell?: string | string[]) => {
    const fund = read(tabs, confirm);
    assert.equal(fund.available, true, label);
    assert.equal(fund.dateField, 'CONTRADICTED', label);
    assert.equal(fund.needsDateAttestation, false, label);
    assert.deepEqual([fund.referenceDate, fund.dateProof, fund.dateComparable], [null, null, false], label);
    if (cell) assert.deepEqual(fund.dateConflictCells, [cell].flat(), label);
    else assert.ok(fund.dateConflictCells.length > 0, label);
    const comparisons = compareFundPosition(fund, D, balances, [workbook]);
    assert.ok(comparisons.length > 0, label);
    for (const comparison of comparisons) {
      assert.equal(comparison.status, 'NOT_COMPARABLE', label);
      assert.equal(comparison.reason, 'DATE_NOT_COMPARABLE', label);
      assert.equal(comparison.delta, null, label);
    }
  };
  // Rien de contredit, rien de prouvé : la case reste demandée, et elle suffit.
  const assertStillAsked = (tabs: FundTab[], label: string) => {
    const asked = read(tabs);
    assert.deepEqual([asked.dateField, asked.needsDateAttestation, asked.referenceDate, asked.dateComparable], ['ABSENT', true, null, false], label);
    assert.deepEqual(asked.dateConflictCells, [], label);
    const confirmed = read(tabs, confirm);
    assert.deepEqual([confirmed.referenceDate, confirmed.dateProof, confirmed.dateComparable], [D, 'OPERATOR', true], label);
  };
  // Libellés que l'écran ne reconnaît pas comme le champ de date de position, et date écrite sans libellé.
  const unknownLabels = ['Situation de trésorerie au', 'Date :', 'FUND POSITION', 'Report date:', 'Etat au', 'Soldes au', 'Bank balance as at', 'Trésorerie du', 'Daily cash', 'Position bancaire', ''];
  for (const label of unknownLabels) {
    // Date contraire sous toutes ses écritures : au jour près, au mois près, sans année.
    for (const written of ['02/06/2026', '2 juin 2026', '2026-06-02', 'June 2, 2026', 'mai 2026', '2 juin', 'June 2', '02/06']) {
      const dateText = `${label} ${written}`.trim();
      assertBlocked([{ name: tab, rows: ROWS, reference: { dateText } }], dateText, 'J1');
    }
    // Cellule date contraire à droite du libellé.
    assertBlocked([{ name: tab, rows: ROWS, reference: { texts: [label, { date: '2026-06-02' }] } }], `${label} + cellule date`);
    // Le même libellé avec D : pas une preuve, la case reste demandée.
    for (const written of ['03/06/2026', '3 juin 2026', 'June 3, 2026', 'juin 2026']) {
      assertStillAsked([{ name: tab, rows: ROWS, reference: { dateText: `${label} ${written}`.trim() } }], `${label} ${written}`);
    }
  }
  // Même règle sur la ligne d'une banque, y compris pour un libellé reconnu : hors de l'en-tête, il ne prouve rien.
  const withNote = (note: string) => ROWS.map((row) => (row.label === 'BDK' ? { ...row, note } : row));
  for (const note of ['Solde au 02/06/2026', '02/06/2026', 'Situation au 02/06/2026', 'Position arrêtée au 2 juin']) {
    assertBlocked([{ name: tab, rows: withNote(note) }], `ligne de banque : ${note}`, 'H3');
  }
  for (const note of ['Solde au 03/06/2026', 'Situation au 03/06/2026', 'As of 03/06/2026', 'Imprimé le 04/06/2026', 'Juin 2026']) {
    assertStillAsked([{ name: tab, rows: withNote(note) }], `ligne de banque : ${note}`);
  }
  // La date du nom de l'onglet n'est pas la date de position : écrite dans la zone, elle bloque comme une autre.
  for (const dateText of ['Soldes au 04/06/2026', 'Onglet du 04/06/2026', '04/06/2026', 'Fund Position 4 June 2026', 'Juillet 2026']) {
    assertBlocked([{ name: tab, rows: ROWS, reference: { dateText } }], dateText, 'J1');
  }
  assertBlocked([{ name: tab, rows: withNote('Vu le 04/06/2026') }], 'ligne de banque : date de l’onglet', 'H3');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['', { date: '2026-06-04' }] } }], 'cellule date : date de l’onglet', 'N1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { ...AT_D, texts: ['Soldes au 04/06/2026'] } }], 'champ valide, date de l’onglet à côté', 'M1');
  // Chaque date est rattachée à SON libellé : un mot écrit ailleurs dans la cellule ne la couvre pas.
  for (const dateText of [
    'Soldes au 02/06/2026 – imprimé le 04/06/2026', 'Imprimé le 04/06/2026 – soldes au 02/06/2026', 'Soldes au 02/06/2026 (imprimé)',
    'Edition des soldes au 02/06/2026', 'Valeur des soldes au 02/06/2026', 'Echéance 30/06/2026 - situation 02/06/2026',
    'Imprimé le 04/06/2026 - 02/06/2026', 'Soldes au 2 juin – imprimé le 4 juin', 'Imprimé à Dakar le 02/06/2026', '02/06/2026 (date d’impression)',
    'Valable du 01/06/2026 au 02/06/2026',
    // Un libellé qui parle de soldes ou de position n'exempte jamais sa date, même si un mot d'impression ou de valeur la précède.
    'Soldes en valeur au 02/06/2026', 'Position en date de valeur du 02/06/2026', 'Situation valeur 02/06/2026', 'Soldes (édition) 02/06/2026',
    'Soldes après édition du 02/06/2026', 'Valeur 02/06/2026', 'Echéance 30/06/2026 - valeur 02/06/2026', 'Comptes arrêtés, date de valeur 02/06/2026',
    // Jour et mois sans année, le mois sur un chiffre.
    'Soldes du 2/6', 'Date : 2/6', 'Date : 12/6', 'Arrêté le 2/6', 'Fund position 2/6', '2/6', 'Relevés du 3/6',
  ]) {
    assertBlocked([{ name: tab, rows: ROWS, reference: { dateText } }], dateText, 'J1');
  }
  // Libellé venu de la cellule de gauche : seulement ce qu'elle écrit après sa dernière date.
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Imprimé le 04/06/2026 – soldes au', { date: '2026-06-02' }] } }], 'gauche : impression puis soldes', 'N1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Soldes au 02/06/2026 – imprimé le', { date: '2026-06-04' }] } }], 'gauche : soldes puis impression', 'M1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Imprimé', { date: '2026-06-01' }, { date: '2026-06-02' }] } }], 'deux cellules date, un seul libellé', 'O1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Imprimé', 'Soldes au 02/06/2026'] } }], 'mot de gauche, libellé propre', 'N1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Imprimé', 'le 04/06/2026 - 02/06/2026'] } }], 'mot de gauche, seconde date sans libellé', 'N1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Imprimé le 01/06/2026', { date: '2026-06-02' }] } }], 'cellule date après une date imprimée', 'N1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Soldes (imprimé)', { date: '2026-06-02' }] } }], 'gauche : soldes et impression', 'N1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Valeur', { date: '2026-06-02' }] } }], 'gauche : valeur seule', 'N1');
  assertBlocked([{ name: tab, rows: withNote('Solde en valeur au 02/06/2026') }], 'ligne de banque : solde en valeur', 'H3');
  assertBlocked([{ name: tab, rows: withNote('Soldes du 2/6') }], 'ligne de banque : mois sur un chiffre', 'H3');
  // Une date d'impression seule reste admise, y compris celle du nom de l'onglet et sous toutes ses écritures.
  for (const texts of [
    ['Imprimé le 04/06/2026'], ['Date d’impression : 04/06/2026'], ['Printed on Thursday 4 June 2026'], ['Edité le jeudi 04/06/2026 à 18h05'],
    ['Print date: 2026-06-04'], ['Imprimé le 04.06'], ['Imprimé le 04 06 2026'], ['Imprimé', 'le 04/06/2026'], ['Imprimé le', '04/06/2026'],
    ['Imprimé le 04/06/2026 – édité le 05/06/2026'], ['Imprimé pour le 04/06/2026'],
    ['Soldes au 03/06/2026 – imprimé le 04/06/2026'], ['Soldes au 03/06/2026 – imprimé le', { date: '2026-06-04' }],
    // La mention d'impression suit un titre, dans la même cellule ou dans celle de gauche : c'est toujours la date d'impression.
    ['FUND POSITION - Imprimé le 04/06/2026'], ['Fund Position printed on 04/06/2026'], ['Etat imprimé le 04/06/2026'], ['Etat imprimé 02/06/2026'],
    ['Etat de trésorerie édité le 04/06/2026 à 18h05'], ['Situation de trésorerie - édition du 04/06/2026'], ['Soldes bancaires - imprimé le 04/06/2026'],
    ['Fund position printed on', { date: '2026-06-04' }], ['Etat (provisoire) imprimé le 04/06/2026'],
    // Le libellé d'une date s'arrête à la date précédente, dans la cellule comme dans celle de gauche.
    ['Soldes au 03/06/2026, échéance 30/06/2026'], ['Soldes au 03/06/2026, échéance', { date: '2026-06-30' }], ['Echéance 30/06/2026 - date de valeur 02/06/2026'], ['Value date', { date: '2026-06-02' }], ['Taux 12.05'], ['Ratio 2.06'],
    // Textes ordinaires qui ne sont pas des dates.
    ['Commission 12.05 %'], ['Compte 01-02'], ['Agence 01-12 Plateau'], ['Tél 33 12 05 2026'], ['Réf. 12-05'],
  ] as CellInput[][]) {
    assertStillAsked([{ name: tab, rows: ROWS, reference: { texts } }], JSON.stringify(texts));
  }
  // Un libellé de date de position que ne suit aucune date lisible bloque : valeur illisible, ou écriture de
  // date que l'écran ne sait pas lire, même écrite à D.
  for (const dateText of [
    'Soldes au 02.06', 'Soldes au 02-06', 'Soldes au 02 06 2026', 'Soldes au 03.06', 'Soldes au 03 06 2026',
    'Soldes au N/A', 'Solde au : à préciser', 'Soldes arrêtés au N/A', 'Balances as at N/A', 'Bank balances as of TBD', 'Etat de trésorerie au N/A',
    'Date des soldes : N/A', 'Soldes au 2/6', 'Soldes au 2.6', 'Soldes au 2-6', 'Soldes au 02/6', 'Soldes au 020626', 'Soldes au 02062026',
    'Soldes au 2 6 2026', 'Soldes au 2 VI 2026', 'Soldes au mardi 2', 'Soldes au 3/6', 'Soldes au', 'Soldes au voir 03/06/2026',
    'Soldes des comptes bancaires au N/A', 'Soldes au ?', 'Soldes au xx/xx/xxxx', 'Soldes au -', 'Balances as at n.a.',
  ]) {
    assertBlocked([{ name: tab, rows: ROWS, reference: { dateText } }], dateText, 'J1');
  }
  assertBlocked([{ name: tab, rows: ROWS, reference: { texts: ['Soldes au', 'N/A'] } }], 'libellé puis cellule illisible', 'M1');
  assertBlocked([{ name: tab, rows: ROWS, reference: { ...AT_D, texts: ['Soldes au N/A'] } }], 'champ valide, soldes illisibles à côté', 'M1');
  assertBlocked([{ name: tab, rows: withNote('Solde au N/A') }], 'ligne de banque : solde illisible', 'H3');
  // Témoins : le même libellé suivi de D, dans la cellule ou dans celle de droite ; un intitulé.
  for (const texts of [
    ['Soldes au', { date: '2026-06-03' }], ['Soldes au', '03/06/2026'], ['Soldes au mercredi 03/06/2026'], ['Soldes arrêtés au : 3 juin 2026'],
    ['Bank balances as at June 3, 2026'], ['Date des soldes : 03/06/2026'], ['Soldes au niveau des banques'], ['Balance générale'], ['Net Balance (XOF)'], ['Position bancaire'],
    // Des mots seuls après le libellé font un intitulé ; au-delà de trois mots avant « au », ce n'est plus un libellé de date.
    ['Solde au débit'], ['Soldes au bilan'], ['Balance as at bank'], ['Etat des comptes au quotidien'], ['Soldes des comptes bancaires courants au N/A'],
  ] as CellInput[][]) {
    assertStillAsked([{ name: tab, rows: ROWS, reference: { texts } }], JSON.stringify(texts));
  }
  // Champ de position illisible sous l'en-tête : il bloque aussi.
  assertBlocked([{ name: tab, rows: withNote('Position arrêtée au N/A') }], 'ligne de banque : champ illisible', 'H3');
  assertBlocked([{ name: tab, rows: ROWS, footerRows: [['', 'Situation au N/A']] }], 'bas d’onglet : champ illisible', 'B10');
  // Sous le bloc des banques : un libellé de date de position qui OUVRE sa cellule et que suit une autre date bloque.
  for (const footer of ['Soldes au 02/06/2026', 'Bank balances as at 02/06/2026', 'Etat de trésorerie au 2 juin 2026', 'Solde au 04/06/2026', 'Soldes au 2 juin', 'Soldes arrêtés au 02/06/2026']) {
    assertBlocked([{ name: tab, rows: ROWS, footerRows: [['', footer]] }], `bas d'onglet : ${footer}`, 'B10');
  }
  assertBlocked([{ name: tab, rows: ROWS, footerRows: [['Soldes au', { date: '2026-06-02' }]] }], 'bas d’onglet : soldes et cellule date', 'A10');
  // Témoins sous le bloc, où vivent les facilités et leurs dates : la même date à D ; le solde d'une facilité à une
  // date, qui n'ouvre pas sa cellule par le libellé ; une échéance ; une date sans libellé ; un libellé sans date.
  for (const footer of [
    ['', 'Soldes au 03/06/2026'], ['', 'Solde juin 2026'], ['', 'Renouvelée le 02/06/2026'], ['Facility', { date: '2026-06-02' }],
    ['', 'Echéance 02/06/2026'], ['', { date: '2026-06-02' }], ['', '02/06/2026'], ['', 'Vu le 04/06/2026'],
    ['', 'Facilité : solde au 30/06/2026'], ['', 'Outstanding balance as at 30/06/2026'], ['', 'Maturity as at 15/09/2026'], ['', 'Solde au N/A'],
    ['Soldes au', { date: '2026-06-03' }], ['', 'Loan balance 30/06/2026'], ['', 'Solde au débit'], ['', 'Soldes au titre de la facilité 30/06/2026'],
  ] as CellInput[][]) {
    assertStillAsked([{ name: tab, rows: ROWS, footerRows: [footer] }], `bas d'onglet : ${JSON.stringify(footer)}`);
  }
  // Un champ valide égal à D ne couvre pas une autre date écrite à côté de lui.
  for (const reference of [{ ...AT_D, otherDate: '2026-06-02' }, { ...AT_D, texts: ['Soldes au 02/06/2026'] }, { ...AT_D, texts: ['Mai 2026'] }, { ...AT_D, texts: ['2 juin'] }] as SyntheticFundPositionReference[]) {
    assertBlocked([{ name: tab, rows: ROWS, reference }], JSON.stringify(reference));
  }
  assertBlocked([{ name: tab, rows: withNote('Soldes au 02/06/2026'), reference: AT_D }], 'champ valide, ligne de banque contraire', 'H3');
  // Sous le bloc des banques : un libellé de date de position reconnu qui porte une autre date, ou une date
  // illisible, bloque encore ; avec D, il ne prouve rien et la case reste demandée.
  for (const footer of ['Position arrêtée au 02/06/2026', 'Situation au 2 juin', 'As at 02/06/2026', 'Fund Position as of 1 June 2026']) {
    assertBlocked([{ name: tab, rows: ROWS, footerRows: [['', footer]] }], `bas d'onglet : ${footer}`, 'B10');
  }
  assertBlocked([{ name: tab, rows: ROWS, footerRows: [['Situation au', { date: '2026-06-02' }]] }], 'bas d’onglet : libellé et cellule date', 'A10');
  assertStillAsked([{ name: tab, rows: ROWS, footerRows: [['', 'Position arrêtée au 03/06/2026']] }], 'bas d’onglet : libellé à D');
  // Témoins sous le bloc des banques : échéances des facilités (cellules date sans libellé) et notes datées.
  assertStillAsked([{
    name: tab, rows: ROWS,
    footerRows: [['Facility', { date: '2025-03-31' }, { date: '2024-12-31' }], ['', 'Renouvelée le 15/01/2025'], ['', '12/2025', '2 mars', 'Mai 2025']],
  }], 'bas d’onglet : échéances');
  // Témoins dans la zone : dates explicitement libellées autrement, dans la cellule ou dans la cellule de gauche.
  for (const texts of [
    ['Echéance 02/06/2026'], ['Maturity', { date: '2026-06-02' }], ['Imprimé le 2 juin'], ['Printed 02/06'], ['Date de valeur 02/06/2026'],
    ['Taux du 02/06/2026'], ['Validité : mai 2026'], ['Edition du 01/06/2026'],
  ] as CellInput[][]) {
    assertStillAsked([{ name: tab, rows: ROWS, reference: { texts } }], JSON.stringify(texts));
  }
  // Un intitulé qui ressemble au libellé mais n'introduit aucune date n'est pas le champ : il ne bloque rien.
  for (const dateText of ['Position au niveau des banques', 'Situation au jour le jour', 'Position du groupe', 'Fund Position', 'Situation du compte 03/06/2026', 'Position du groupe au 03/06/2026']) {
    assertStillAsked([{ name: tab, rows: ROWS, reference: { dateText } }], dateText);
  }
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
    // Variantes dans un en-tête de montants.
    'Montants K-FCFA', 'Montants en M', 'Montants K', 'Montants M', 'Montants MF', 'Bank Balance (M)', 'Solde en MM', 'Balance K€',
    'K-FCFA', 'K/FCFA', 'kilo francs', '(M)', 'en M', 'en MM', '(,000)', '10^3', 'x10^3', '*1000', '1000s', 'MM FCFA', 'M-FCFA', 'Md FCFA', 'Mrd', 'mln',
    // Écritures anglaises, signes typographiques et abréviations de fin d'intitulé.
    'Bank Balance (in 000)', 'Amounts in 000', 'Bank Balance 000', 'Amount (FCFA 000)', 'Balance bn', 'Amount (th)', 'Solde Mn', 'Balance (Mn)',
    'Montants ’000', '’000', 'Montants en Kilo FCFA', 'Kilo FCFA', 'Mios', 'Montants en Mios', '10³', 'x 10³', 'Montants ÷ 1000', '÷1000',
    'en centaines', 'Hundreds', 'K.FCFA', '(in 000)', 'Solde Mn XOF', 'Solde (K) FCFA', 'Balance M XOF', 'Montants en M.', 'Deposits K', 'Fund Applied M FCFA',
    // Puissance de mille introduite par une préposition, un opérateur ou une parenthèse, dans un en-tête de montants.
    'Montants in 1,000', 'Amounts in 1000', 'Soldes en 1 000 FCFA', 'Balance (1,000)', 'Montants x 1,000', 'Montants ×1 000 000', 'Montants in 1,000,000',
    'Amounts in 1000s', "Balance in 1'000", 'Montants par 1000', 'Amounts per 1,000', 'Montants/1.000', 'Bank Balance in 1 000 000 000', 'Montants in 10,000',
    'Chiffres en 1 000', 'Figures in 1,000 FCFA', 'Valeurs en 100 000', 'Sommes (1000 FCFA)', 'Totaux x 1.000', 'Montants in 1,000 FCFA',
    // Autres abréviations de fin d'intitulé.
    'Montants 1,000s', "Amounts 1 000 000's", 'Balance 1000S', 'Montants en milles', 'Montants (mill.)', 'Balance (tsd)', 'Balance in ths', 'Balance (thou)', 'Amount (thsd)', 'Balance thous.', 'Montants E3', 'Montants x1k', 'Solde 1k', 'Amounts 1E6', 'Balance E9',
    // Tout ce qui sépare le mot d'intitulé de la puissance de mille en fait une échelle : devise, mot d'unité, signe.
    'Amounts in XOF 1,000', 'Montants en unités de 1000', 'Montants (unité : 1000 F)', 'Amounts 1:1000', 'Montants en FCFA 1 000', 'Amounts (XOF 1,000)',
    'Amounts in units of 1,000', 'Montants : 1000 FCFA', 'Montants in 10^6', 'Balance 10^9', 'Unit: 1,000', 'Unités de 1 000', 'Montants (3 zéros omis)',
    'Amounts (three zeroes omitted)', 'Solde FCFA 1 000', 'Deposit (1 000 000)',
    // Un mot de total fait un en-tête de montants pour les puissances de mille.
    'Total in 1,000', 'Totaux en 1 000 FCFA', 'TOTAL (1,000)', 'Total in XOF 1,000', 'Total in 10,000', 'Balance T', 'Montants en T',
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
  for (const harmless of ['Plafond 1 000 FCFA', 'Total 25 000 XOF', 'Solde 1 000 FCFA', 'Montant 10 000 000 FCFA', 'Référence 000123', 'KFW', 'Skf', 'MILLENIUM', 'Taux x 1,05', 'M. DIOP', 'K. FALL', 'Lot K', 'KM 5', 'Agence M',
    // Dans un intitulé de montants : une initiale au milieu du libellé, un rang de mois, un montant écrit en entier.
    'CREDIT M DIOP', 'SOLDE M. FALL', 'Solde M-1', 'REMISE EN M. FALL', 'ETS K.F', 'Credit K. FALL', 'Solde K FALL', 'Montant 25 000', 'Balance 1,000,000',
    'Solde au 1 000 000 XOF', 'Deposit 2000', 'Amount 100 000', 'Solde compte 000123', 'Balance 1.000.000 FCFA', 'Credit M 12',
    // Un montant que rien n'introduit, ou qui n'est pas une puissance de mille, n'est pas une échelle.
    'Solde 1,000', 'Montant 1 000', 'Total 1 000 000 FCFA', 'Balance 10,000', 'Amount 1000', 'Montant en 1 000 500', 'Solde in 1,000,500 FCFA',
    'Montants en 2 000', 'Solde (2000)', 'Total in XOF', 'Solde en FCFA', 'Credit T. FALL', 'Solde T1', 'Plafond en 1 000 FCFA', 'Plafond 1,000s', 'Total 2,000s', 'Total E3 SARL', 'Montant x 1,05',
    'Solde de 1 000 FCFA', 'Solde du 1 000 000', 'Total T', 'Total M', 'TOTAL K', 'Total BIS K', 'Unités vendues 1000', 'Solde 3 zones', 'Montant 10 puissance 2',
    'Prix unité : 1 000 FCFA', 'Coût par unité de 1 000', 'Solde avec zéros', 'Total 1 000 000', 'Total de 1 000 FCFA']) {
    const fund = reading([{ name: tab, rows: ROWS, reference: { date: D, texts: [harmless] } }]);
    assert.deepEqual([fund.unit, fund.unitProvenance], ['UNITS', 'CONVENTION'], harmless);
  }
  // Sous la ligne d'en-tête, un libellé qui porte un montant rond n'est pas une échelle ; une puissance de mille
  // introduite par une préposition ou un opérateur, ou mise au pluriel, en reste une.
  const noted = (note: string) => reading([{ name: tab, rows: ROWS.map((row) => (row.label === 'BDK' ? { ...row, note } : row)), reference: { date: D } }]);
  for (const note of ['Solde : 1 000 000', 'Credit BDK 1 000 000', 'Montant total 1 000 000', 'DEPOSIT BDK 1 000 000', 'Solde reporté 10 000 000', 'Deposit chq 1000', 'Montant : 100 000 FCFA']) {
    assert.deepEqual([noted(note).unit, noted(note).unitProvenance], ['UNITS', 'CONVENTION'], note);
  }
  for (const note of ['Montants in 1,000', 'Total en 1 000 FCFA', 'Montants 1,000s', 'Solde /1000', 'Montants (unité : 1000 F)']) {
    assert.deepEqual([noted(note).unit, noted(note).unitProvenance], [null, null], note);
  }
  // Chaque source doit être en francs entiers. Une Fund Position en milliers (champ valide) n'est comparée à
  // rien, pas même à un classeur qui déclare lui aussi des milliers : aucune conversion, aucun écart chiffré.
  const thousands = reading([{ name: tab, rows: ROWS, reference: { ...AT_D, unit: 'milliers' } }]);
  assert.deepEqual([thousands.unit, thousands.unitProvenance], ['THOUSANDS', 'FILE']);
  for (const workbook of [bdkWorkbook(D, tab, 'XOF', 'milliers'), bdkWorkbook(D, tab, null, null), bdkWorkbook()]) {
    const comparisons = compareFundPosition(thousands, D, balances, [workbook]);
    assert.ok(comparisons.length > 0);
    for (const comparison of comparisons) {
      assert.equal(comparison.status, 'NOT_COMPARABLE');
      assert.equal(comparison.reason, 'UNIT_NOT_COMPARABLE');
      assert.equal(comparison.delta, null);
    }
  }
  // Même règle pour la devise : deux documents qui déclarent tous deux des euros ne sont pas comparés.
  const euros = reading([{ name: tab, rows: ROWS, reference: { ...AT_D, currency: 'EUR' } }]);
  for (const comparison of compareFundPosition(euros, D, balances, [bdkWorkbook(D, tab, 'EUR', 'francs entiers')])) {
    assert.equal(comparison.status, 'NOT_COMPARABLE');
    assert.equal(comparison.reason, 'CURRENCY_NOT_COMPARABLE');
    assert.equal(comparison.delta, null);
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
