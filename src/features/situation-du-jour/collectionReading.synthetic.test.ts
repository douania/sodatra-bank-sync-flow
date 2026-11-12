import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCollectionRows, readCollectionReport, summarizeCollections } from './collectionReading';
import { readMonthlyWorkbook } from './monthlyWorkbook';
import { collectionReportBytes, monthlyWorkbookBytes, tabName } from './situationSyntheticFixtures';
import type { SyntheticCollectionRow } from './situationSyntheticFixtures';

const D = '2026-06-03';
const TODAY = '2026-06-05';
const classify = (rows: Parameters<typeof classifyCollectionRows>[0], workbooks: Parameters<typeof classifyCollectionRows>[1]) =>
  classifyCollectionRows(rows, workbooks, D, TODAY);

function bicisWorkbook(deposits: Array<{ dueDate?: string; number?: number; client: string; amount: number }>) {
  return readMonthlyWorkbook({
    name: 'SYNTHETIC BICIS 2026.xlsx',
    bytes: monthlyWorkbookBytes([{
      name: tabName('2026-06-04'), labelDate: D, titleBank: 'BICIS', opening: 1000,
      deposits: deposits.map((deposit) => ({ date: D, ...deposit })), cheques: [],
    }]),
  }, D, TODAY);
}

const ROWS: SyntheticCollectionRow[] = [
  // 2 : effet déjà crédité avant son échéance (escompté).
  { date: '2026-05-20', instrument: { date: '2026-09-01' }, clientBank: 'SYNTHBANK A', client: 'SYNTHETIC CLIENT A', amount: 5000, depositBank: 'BICIS', validity: { date: '2026-05-25' }, commission: 120 },
  // 3 : effet déposé, en attente de crédit (présent dans le classeur).
  { date: '2026-06-02', instrument: { date: '2026-10-01' }, clientBank: 'SYNTHBANK B', client: 'SYNTHETIC CLIENT B', amount: 700, depositBank: 'BICIS' },
  // 4 : chèque remis à la perception, hors banque.
  { date: '2026-06-01', instrument: 4440001, clientBank: 'SYNTHBANK C', client: 'SYNTHETIC CLIENT C', amount: 90, depositBank: 'PDP', validity: { date: '2026-06-02' } },
  // 5 : date de validité antérieure à la ligne.
  { date: '2026-06-02', instrument: 4440002, clientBank: 'SYNTHBANK C', client: 'SYNTHETIC CLIENT C', amount: 60, depositBank: 'BDK', validity: { date: '2026-05-01' } },
  // 6 : texte dans la date de validité.
  { date: '2026-06-02', instrument: 4440004, clientBank: 'SYNTHBANK D', client: 'SYNTHETIC CLIENT D', amount: 40, depositBank: 'BDK', validity: 'A REMPLACER' },
  // 7 : sans date de validité ni trace de dépôt.
  { date: '2026-06-02', instrument: { date: '2026-11-01' }, clientBank: 'SYNTHBANK E', client: 'SYNTHETIC CLIENT E', amount: 333, depositBank: 'BICIS' },
  // 8 : chèque crédité.
  { date: '2026-05-28', instrument: 4440003, clientBank: 'SYNTHBANK F', client: 'SYNTHETIC CLIENT F', amount: 800, depositBank: 'BDK', validity: { date: '2026-06-01' } },
];

test('lecture isolée : échéance, banque du client et banque de dépôt conservées séparément', () => {
  const reading = readCollectionReport(collectionReportBytes(ROWS, { hiddenPivotFirst: true }));
  assert.equal(reading.available, true);
  // La feuille masquée du tableau croisé est ignorée.
  assert.equal(reading.sheetName, 'Feuil1');
  assert.equal(reading.rows.length, ROWS.length);
  const effet = reading.rows[0];
  assert.equal(effet.instrument, 'EFFET');
  assert.equal(effet.dueDate, '2026-09-01');
  assert.equal(effet.chequeNumber, null);
  assert.equal(effet.clientBank, 'SYNTHBANK A');
  assert.equal(effet.depositBankRaw, 'BICIS');
  assert.equal(effet.depositBank, 'BICIS');
  assert.equal(effet.validityDate, '2026-05-25');
  assert.equal(effet.bankCommission, 120);
  const cheque = reading.rows[2];
  assert.equal(cheque.instrument, 'CHEQUE');
  assert.equal(cheque.chequeNumber, '4440001');
  assert.equal(cheque.dueDate, null);
  assert.equal(reading.rows[4].instrument, 'CHEQUE');
});

test('les quatre états, fondés sur une preuve', () => {
  const reading = readCollectionReport(collectionReportBytes(ROWS));
  const workbook = bicisWorkbook([{ dueDate: '2026-10-01', client: 'SYNTHETIC CLIENT B', amount: 700 }]);
  const rows = classify(reading.rows, [workbook]);
  assert.deepEqual(rows.map((row) => row.state), [
    'CREDITE_DECLARE', 'DEPOSE_EN_ATTENTE', 'HORS_BANQUE', 'A_VERIFIER', 'A_VERIFIER', 'A_VERIFIER', 'CREDITE_DECLARE',
  ]);
  assert.deepEqual(rows.map((row) => row.checkReason), [
    null, null, null, 'VALIDITY_BEFORE_RECEIPT', 'VALIDITY_NOT_A_DATE', 'NO_DEPOSIT_PROOF', null,
  ]);
});

test('un effet « Crédité déclaré » contribue zéro aux entrées attendues', () => {
  const reading = readCollectionReport(collectionReportBytes(ROWS));
  const workbook = bicisWorkbook([{ dueDate: '2026-10-01', client: 'SYNTHETIC CLIENT B', amount: 700 }]);
  const summary = summarizeCollections(classify(reading.rows, [workbook]), D);
  assert.deepEqual(summary.countByState, { CREDITE_DECLARE: 2, DEPOSE_EN_ATTENTE: 1, HORS_BANQUE: 1, A_VERIFIER: 3 });
  // Seul le dépôt en attente est une entrée attendue : ni l'effet crédité (5000), ni les lignes à vérifier.
  assert.deepEqual(summary.expectedInflows, [{ bank: 'BICIS', count: 1, amount: 700 }]);
  assert.equal(summary.expectedInflowsTotal, 700);
  assert.equal(summary.toVerifyAmount, 60 + 40 + 333);
  // L'échéance de l'effet déjà crédité n'apparaît que dans le suivi du risque.
  assert.deepEqual(summary.creditedEffetMaturities, [{ dueDate: '2026-09-01', bank: 'BICIS', count: 1, amount: 5000 }]);
});

test('information ambiguë : « À vérifier », hors total prévisionnel', () => {
  const twins: SyntheticCollectionRow[] = [
    { date: '2026-06-02', instrument: { date: '2026-10-01' }, clientBank: 'SYNTHBANK B', client: 'SYNTHETIC CLIENT B', amount: 700, depositBank: 'BICIS' },
    { date: '2026-06-02', instrument: { date: '2026-10-01' }, clientBank: 'SYNTHBANK B', client: 'SYNTHETIC CLIENT B', amount: 700, depositBank: 'BICIS' },
  ];
  const reading = readCollectionReport(collectionReportBytes(twins));
  // Un seul dépôt en attente pour deux lignes identiques : impossible de dire laquelle.
  const oneDeposit = classify(reading.rows, [bicisWorkbook([{ dueDate: '2026-10-01', client: 'SYNTHETIC CLIENT B', amount: 700 }])]);
  assert.deepEqual(oneDeposit.map((row) => row.state), ['A_VERIFIER', 'A_VERIFIER']);
  assert.deepEqual(oneDeposit.map((row) => row.checkReason), ['AMBIGUOUS_DEPOSIT_MATCH', 'AMBIGUOUS_DEPOSIT_MATCH']);
  const summary = summarizeCollections(oneDeposit, D);
  assert.equal(summary.expectedInflowsTotal, 0);
  assert.equal(summary.toVerifyAmount, 1400);

  // Classeur de la banque absent : la ligne reste à vérifier.
  const noWorkbook = classify(reading.rows.slice(0, 1), []);
  assert.equal(noWorkbook[0].state, 'A_VERIFIER');
  assert.equal(noWorkbook[0].checkReason, 'NO_WORKBOOK_FOR_BANK');

  // Échéance différente ou client différent : aucune preuve de dépôt.
  const otherDue = classify(reading.rows.slice(0, 1), [bicisWorkbook([{ dueDate: '2026-10-02', client: 'SYNTHETIC CLIENT B', amount: 700 }])]);
  assert.equal(otherDue[0].checkReason, 'NO_DEPOSIT_PROOF');
  const otherClient = classify(reading.rows.slice(0, 1), [bicisWorkbook([{ dueDate: '2026-10-01', client: 'SYNTHETIC CLIENT Z', amount: 700 }])]);
  assert.equal(otherClient[0].checkReason, 'NO_DEPOSIT_PROOF');
});

test('banque de dépôt absente, ambiguë ou inconnue : « À vérifier », jamais « Hors banque »', () => {
  const base = { date: '2026-06-01', instrument: 4440009, clientBank: 'SYNTHBANK G', client: 'SYNTHETIC CLIENT G', amount: 10, validity: { date: '2026-06-02' } };
  const reading = readCollectionReport(collectionReportBytes([
    { ...base, depositBank: '' }, { ...base, depositBank: 'BDK / ORA' }, { ...base, depositBank: 'BDKK' }, { ...base, depositBank: 'BDK USD' },
    { ...base, depositBank: 'PDP' }, { ...base, depositBank: 'CASH' }, { ...base, depositBank: 'UEMOA' },
  ]));
  const rows = classify(reading.rows, []);
  assert.deepEqual(rows.map((row) => row.state), ['A_VERIFIER', 'A_VERIFIER', 'A_VERIFIER', 'A_VERIFIER', 'HORS_BANQUE', 'HORS_BANQUE', 'HORS_BANQUE']);
  assert.deepEqual(rows.slice(0, 4).map((row) => row.checkReason), ['DEPOSIT_BANK_UNKNOWN', 'DEPOSIT_BANK_UNKNOWN', 'DEPOSIT_BANK_UNKNOWN', 'DEPOSIT_BANK_UNKNOWN']);
  assert.equal(summarizeCollections(rows, D).toVerifyAmount, 40);
});

test('date de validité future ou postérieure à D : jamais « Crédité déclaré » à D', () => {
  const effet = (validity: string): SyntheticCollectionRow => ({
    date: '2026-06-02', instrument: { date: '2026-10-01' }, clientBank: 'SYNTHBANK B', client: 'SYNTHETIC CLIENT B', amount: 700, depositBank: 'BICIS', validity: { date: validity },
  });
  const reading = readCollectionReport(collectionReportBytes([effet('2027-01-15'), effet('2026-06-04'), effet(D)]));
  const withoutProof = classify(reading.rows, []);
  assert.deepEqual(withoutProof.map((row) => row.state), ['A_VERIFIER', 'A_VERIFIER', 'CREDITE_DECLARE']);
  assert.deepEqual(withoutProof.map((row) => row.checkReason), ['VALIDITY_IN_FUTURE', 'NO_WORKBOOK_FOR_BANK', null]);
  // Crédité le lendemain de D : à D, le dépôt était encore en attente si le classeur le prouve.
  const pendingAtD = classify(reading.rows.slice(1, 2), [bicisWorkbook([{ dueDate: '2026-10-01', client: 'SYNTHETIC CLIENT B', amount: 700 }])]);
  assert.equal(pendingAtD[0].state, 'DEPOSE_EN_ATTENTE');
});

test('chèque : deux numéros connus et différents ne sont pas rapprochés', () => {
  const cheque: SyntheticCollectionRow = { date: '2026-06-02', instrument: 4449999, clientBank: 'SYNTHBANK H', client: 'SYNTHETIC CLIENT H', amount: 500, depositBank: 'BICIS' };
  const reading = readCollectionReport(collectionReportBytes([cheque]));
  const other = classify(reading.rows, [bicisWorkbook([{ number: 1111111, client: 'SYNTHETIC CLIENT H', amount: 500 }])]);
  assert.equal(other[0].state, 'A_VERIFIER');
  assert.equal(other[0].checkReason, 'NO_DEPOSIT_PROOF');
  const same = classify(reading.rows, [bicisWorkbook([{ number: 4449999, client: 'SYNTHETIC CLIENT H', amount: 500 }])]);
  assert.equal(same[0].state, 'DEPOSE_EN_ATTENTE');
});

test('rapprochement strict : numéro pour le chèque, échéance pour l’effet, jamais pour un autre instrument', () => {
  const cheque = (instrument: SyntheticCollectionRow['instrument']): SyntheticCollectionRow => ({
    date: '2026-06-02', instrument, clientBank: 'SYNTHBANK H', client: 'SYNTHETIC CLIENT H', amount: 500, depositBank: 'BICIS',
  });
  const reading = readCollectionReport(collectionReportBytes([cheque(4449999), cheque('VIREMENT'), cheque('')]));
  // Le dépôt du classeur ne porte pas de numéro : même client et même nominal ne suffisent pas.
  const noNumber = classify(reading.rows, [bicisWorkbook([{ client: 'SYNTHETIC CLIENT H', amount: 500 }])]);
  assert.deepEqual(noNumber.map((row) => row.state), ['A_VERIFIER', 'A_VERIFIER', 'A_VERIFIER']);
  assert.deepEqual(noNumber.map((row) => row.checkReason), ['NO_DEPOSIT_PROOF', 'INSTRUMENT_NOT_IDENTIFIED', 'INSTRUMENT_NOT_IDENTIFIED']);
  assert.equal(summarizeCollections(noNumber, D).expectedInflowsTotal, 0);
  // Même avec un numéro au classeur, un virement ou un instrument inconnu n'est jamais rapproché.
  const withNumber = classify(reading.rows, [bicisWorkbook([{ number: 4449999, client: 'SYNTHETIC CLIENT H', amount: 500 }])]);
  assert.deepEqual(withNumber.map((row) => row.state), ['DEPOSE_EN_ATTENTE', 'A_VERIFIER', 'A_VERIFIER']);
});

test('ligne reçue après D : hors de la situation à D, jamais une entrée attendue', () => {
  const reading = readCollectionReport(collectionReportBytes([
    { date: '2026-06-04', instrument: { date: '2026-10-01' }, clientBank: 'SYNTHBANK B', client: 'SYNTHETIC CLIENT B', amount: 700, depositBank: 'BICIS' },
    { date: D, instrument: { date: '2026-10-05' }, clientBank: 'SYNTHBANK B', client: 'SYNTHETIC CLIENT B', amount: 300, depositBank: 'BICIS' },
  ]));
  const rows = classify(reading.rows, [bicisWorkbook([
    { dueDate: '2026-10-01', client: 'SYNTHETIC CLIENT B', amount: 700 },
    { dueDate: '2026-10-05', client: 'SYNTHETIC CLIENT B', amount: 300 },
  ])]);
  assert.deepEqual(rows.map((row) => row.state), ['A_VERIFIER', 'DEPOSE_EN_ATTENTE']);
  assert.equal(rows[0].checkReason, 'RECEIPT_AFTER_ACCOUNTING_DATE');
  assert.equal(summarizeCollections(rows, D).expectedInflowsTotal, 300);
});

test('deux feuilles visibles aux en-têtes compatibles : lecture ambiguë', () => {
  const row: SyntheticCollectionRow = { date: '2026-06-02', instrument: 4440001, clientBank: 'SYNTHBANK A', client: 'SYNTHETIC CLIENT A', amount: 10, depositBank: 'BDK' };
  const reading = readCollectionReport(collectionReportBytes([row], { visibleSecondSheetRows: [{ ...row, amount: 20 }] }));
  assert.equal(reading.available, false);
  assert.equal(reading.reason, 'SHEET_AMBIGUOUS');
  assert.deepEqual(reading.rows, []);
});

test('montant ou date de ligne absents : « À vérifier »', () => {
  const reading = readCollectionReport(collectionReportBytes([
    { date: '2026-06-02', instrument: 4440010, clientBank: 'SYNTHBANK I', client: 'SYNTHETIC CLIENT I', amount: null, depositBank: 'BDK' },
    { date: '', instrument: 4440011, clientBank: 'SYNTHBANK I', client: 'SYNTHETIC CLIENT I', amount: 20, depositBank: 'BDK' },
  ]));
  assert.deepEqual(classify(reading.rows, []).map((row) => row.checkReason), ['AMOUNT_MISSING', 'RECEIPT_DATE_MISSING']);
});

test('feuille masquée aux bons en-têtes : ignorée ; échéances passées hors suivi', () => {
  const decoy: SyntheticCollectionRow = { date: '2026-06-01', instrument: 9990001, clientBank: 'SYNTHBANK X', client: 'SYNTHETIC DECOY', amount: 999_999, depositBank: 'BDK', validity: { date: '2026-06-02' } };
  const reading = readCollectionReport(collectionReportBytes([
    { date: '2026-03-01', instrument: { date: '2026-05-15' }, clientBank: 'SYNTHBANK A', client: 'SYNTHETIC CLIENT A', amount: 300, depositBank: 'BDK', validity: { date: '2026-03-05' } },
    { date: '2026-05-01', instrument: { date: '2026-08-15' }, clientBank: 'SYNTHBANK A', client: 'SYNTHETIC CLIENT A', amount: 400, depositBank: 'BDK', validity: { date: '2026-05-05' } },
  ], { hiddenDecoyRows: [decoy] }));
  assert.equal(reading.sheetName, 'Feuil1');
  assert.equal(reading.rows.some((row) => row.client === 'SYNTHETIC DECOY'), false);
  const summary = summarizeCollections(classify(reading.rows, []), D);
  // Seule l'échéance postérieure à D figure dans le suivi du risque.
  assert.deepEqual(summary.creditedEffetMaturities, [{ dueDate: '2026-08-15', bank: 'BDK', count: 1, amount: 400 }]);
});

test('feuille introuvable ou classeur illisible : aucune ligne', () => {
  const unreadable = readCollectionReport(new Uint8Array([9, 9, 9]).buffer);
  assert.equal(unreadable.available, false);
  assert.deepEqual(unreadable.rows, []);
  const noHeader = readCollectionReport(monthlyWorkbookBytes([{ name: '040626', labelDate: D, titleBank: 'BDK', opening: 1 }]));
  assert.equal(noHeader.available, false);
  assert.equal(noHeader.reason, 'SHEET_NOT_FOUND');
});
