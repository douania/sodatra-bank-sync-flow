import assert from 'node:assert/strict';
import test from 'node:test';

import * as XLSX from 'xlsx';

import { extractBankReportFromGrid } from './bankReportGridExtractor';
import { worksheetToGrid, type ExcelSheetGrid } from './excelSheetGrid';

const ACCOUNTING = '_-* #,##0\\ _€_-;\\-* #,##0\\ _€_-;_-* "-"??\\ _€_-;_-@_-';
const DATE_FORMAT = 'm/d/yy';

type Cell = string | number | { date: string } | { amount: number } | { ref: number } | { error: string } | null;

function serialOf(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((Date.UTC(year, month - 1, day) - epoch) / 86_400_000);
}

/** Construit une grille synthétique typée : `{date}` = cellule date Excel, `{amount}` = montant formaté. */
function gridOf(rows: Cell[][], sheetName = '090726'): ExcelSheetGrid {
  const sheet: XLSX.WorkSheet = {};
  let maxColumn = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === null) return;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (typeof value === 'string') sheet[address] = { t: 's', v: value };
      else if (typeof value === 'number') sheet[address] = { t: 'n', v: value };
      else if ('date' in value) sheet[address] = { t: 'n', v: serialOf(value.date), z: DATE_FORMAT };
      else if ('amount' in value) sheet[address] = { t: 'n', v: value.amount, z: ACCOUNTING };
      else if ('ref' in value) sheet[address] = { t: 'n', v: value.ref, z: 'General' };
      else sheet[address] = { t: 'e', v: 23, w: value.error };
      maxColumn = Math.max(maxColumn, columnIndex);
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: maxColumn } });
  return worksheetToGrid(sheet, sheetName);
}

const D = (iso: string): Cell => ({ date: iso });
const A = (amount: number): Cell => ({ amount });

function englishReport(title: string): Cell[][] {
  return [
    [null, null, null, title],
    ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT', 'AMOUNT 2'],
    ['OPENING BALANCE 09/07/26', null, null, null, null, null, A(1_000_000)],
    ['ADD :', 'DEPOSIT NOT YET CLEARED'],
    [D('2026-07-08'), D('2026-07-09'), 'REGLEMENT FAC. 01/07/26', 'FOURNISSEUR', 'CLIENT SYNTHETIQUE', null, A(250_000)],
    [null, null, null, 'TOTAL DEPOSIT', null, null, A(250_000)],
    [null, null, null, 'TOTAL BALANCE (A)', null, null, A(1_250_000)],
    ['LESS :', null, null, 'CHECK Not yet cleared'],
    [D('2026-07-01'), { ref: 1234567 }, 'CHQ FOURNISSEUR', 'BENEFICIAIRE', 'CLIENT', { ref: 99999 }, null, A(150_000)],
    [D('2026-07-02'), { ref: 1234568 }, 'CHQ AUTRE', 'BENEFICIAIRE 2', null, null, A(50_000)],
    [null, null, null, 'TOTAL (B)', null, null, A(200_000)],
    [null, null, 'CLOSING BALANCE as per Book : C=(A-B)', null, null, null, A(1_050_000)],
    [],
    [D('2026-01-01'), null, null, 'BANK FACILITY (180 jrs)', null, null, D('2026-07-09')],
    [null, null, null, 'Limit', 'Used', null, 'Balance'],
    [null, D('2026-07-09'), 'SPN', A(1_000_000_000), A(400_000_000), null, A(600_000_000)],
    [null, null, 'OVERDRAFT', A(200_000_000), A(0), null, A(200_000_000)],
    [null, null, null, null, A(1_200_000_000)],
    [],
    [null, null, null, 'IMPAYE'],
    [D('2026-06-30'), D('2026-07-05'), 'IMPAYE', 'CL01', 'CLIENT SYNTHETIQUE', '123456-654321', A(75_000)],
    [D('2026-07-01'), { ref: 7654321 }, 'IMPAYE', 'CL02', 'AUTRE CLIENT', null, A(25_000)],
    [null, null, null, null, null, null, A(100_000)],
  ];
}

test('BDK : un rapport quotidien réel est extrait avec dates de cellule, montants formatés et sections', async () => {
  const result = await extractBankReportFromGrid(gridOf(englishReport('BDK')), 'BDK');
  assert.equal(result.success, true, result.errors?.join(' '));
  const report = result.data!;
  assert.equal(report.bank, 'BDK');
  assert.equal(report.date, '2026-07-09');
  assert.equal(report.openingBalance, 1_000_000);
  assert.equal(report.closingBalance, 1_050_000);
  assert.equal(report.depositsNotCleared.length, 1);
  assert.equal(report.depositsNotCleared[0].dateDepot, '2026-07-08');
  assert.equal(report.depositsNotCleared[0].dateValeur, '2026-07-09');
  assert.equal(report.depositsNotCleared[0].clientCode, 'CLIENT SYNTHETIQUE');
  assert.equal(report.depositsNotCleared[0].montant, 250_000);
  assert.equal(report.checksNotCleared?.length, 2);
  assert.equal(report.checksNotCleared?.[0].numeroCheque, '1234567');
  assert.equal(report.checksNotCleared?.[0].montant, 150_000, 'le montant formaté prime sur la référence numérique');
  assert.equal(report.bankFacilities.length, 2);
  assert.deepEqual(report.bankFacilities[0], {
    facilityType: 'SPN', limitAmount: 1_000_000_000, usedAmount: 400_000_000, availableAmount: 600_000_000,
  });
  assert.equal(report.impayes.length, 2);
  assert.equal(report.impayes[0].dateRetour, '2026-06-30');
  assert.equal(report.impayes[0].dateEcheance, '2026-07-05');
  assert.equal(report.impayes[0].clientCode, 'CL01');
  assert.equal(report.impayes[1].dateRetour, undefined);
  assert.equal(report.impayes[1].dateEcheance, '2026-07-01');
  assert.deepEqual(result.warnings, []);
});

test('aucune perte silencieuse : toute ligne après le total des facilités ou hors section refuse', async () => {
  const labelledAdjustment = englishReport('BDK');
  labelledAdjustment.splice(18, 0, [null, null, 'AJUSTEMENT', null, A(-5_000_000)]);
  const labelled = await extractBankReportFromGrid(gridOf(labelledAdjustment), 'BDK');
  assert.equal(labelled.success, false);
  assert.match(labelled.errors?.join(' ') ?? '', /après le total des facilités/);

  const numericAdjustment = englishReport('BDK');
  numericAdjustment.splice(18, 0, [null, null, null, null, A(-5_000_000)]);
  assert.equal((await extractBankReportFromGrid(gridOf(numericAdjustment), 'BDK')).success, false);

  // Ligne datée après le total des chèques (avant le solde de clôture) : hors section.
  const datedOutside = englishReport('BDK');
  datedOutside.splice(11, 0, [D('2026-07-03'), { ref: 999 }, 'CHQ TARDIF', 'BENEF', null, null, A(10_000)]);
  const outside = await extractBankReportFromGrid(gridOf(datedOutside), 'BDK');
  assert.equal(outside.success, false);
  assert.match(outside.errors?.join(' ') ?? '', /hors section/);

  // Ligne financière sans libellé après le total des impayés : hors section.
  const numericOutside = englishReport('BDK');
  numericOutside.push([null, null, null, null, null, null, A(1)]);
  assert.equal((await extractBankReportFromGrid(gridOf(numericOutside), 'BDK')).success, false);
});

test('le montant est unique dans la zone titrée AMOUNT/MONTANT : ambiguïté refusée, référence hors zone ignorée, colonne « - » tolérée', async () => {
  const ambiguous = englishReport('BDK');
  ambiguous[4] = [D('2026-07-08'), D('2026-07-09'), 'REGLEMENT', 'FOURNISSEUR', 'CLIENT', null, A(250_000), A(1_000)];
  const result = await extractBankReportFromGrid(gridOf(ambiguous), 'BDK');
  assert.equal(result.success, false);
  assert.match(result.errors?.join(' ') ?? '', /montant ambigu/);

  // Une référence formatée en colonne TR NO (hors zone) n'est pas un montant.
  const formattedReference = englishReport('BDK');
  formattedReference[4] = [D('2026-07-08'), D('2026-07-09'), 'REGLEMENT', 'FOURNISSEUR', 'CLIENT', A(123_456), A(250_000)];
  const ignoredReference = await extractBankReportFromGrid(gridOf(formattedReference), 'BDK');
  assert.equal(ignoredReference.success, true, ignoredReference.errors?.join(' '));
  assert.equal(ignoredReference.data?.depositsNotCleared[0].montant, 250_000);

  const withZeroColumn = englishReport('BDK');
  withZeroColumn[4] = [D('2026-07-08'), D('2026-07-09'), 'REGLEMENT', 'FOURNISSEUR', 'CLIENT', null, A(250_000), A(0)];
  const tolerated = await extractBankReportFromGrid(gridOf(withZeroColumn), 'BDK');
  assert.equal(tolerated.success, true, tolerated.errors?.join(' '));
  assert.equal(tolerated.data?.depositsNotCleared[0].montant, 250_000);

  // Un montant porté par une colonne non titrée (hors zone) n'est jamais lu : la ligne refuse.
  const untitledNext = englishReport('BICIS');
  untitledNext[1] = ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT'];
  untitledNext[8] = [D('2026-07-01'), { ref: 1234567 }, 'CHQ', 'BENEF', 'CLIENT', { ref: 99999 }, null, A(150_000)];
  const nextColumn = await extractBankReportFromGrid(gridOf(untitledNext), 'BICIS');
  assert.equal(nextColumn.success, false);
  assert.match(nextColumn.errors?.join(' ') ?? '', /montant absent/);
  // La même ligne avec le montant dans la colonne titrée passe.
  untitledNext[8] = [D('2026-07-01'), { ref: 1234567 }, 'CHQ', 'BENEF', 'CLIENT', { ref: 99999 }, A(150_000)];
  const titledColumn = await extractBankReportFromGrid(gridOf(untitledNext), 'BICIS');
  assert.equal(titledColumn.success, true, titledColumn.errors?.join(' '));
  assert.equal(titledColumn.data?.checksNotCleared?.[0].montant, 150_000);

  // Sans colonne titrée AMOUNT/MONTANT, le document est refusé.
  const noAmountHeader = englishReport('BDK');
  noAmountHeader[1] = ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'VALEUR'];
  const refused = await extractBankReportFromGrid(gridOf(noAmountHeader), 'BDK');
  assert.equal(refused.success, false);
  assert.match(refused.errors?.join(' ') ?? '', /Colonne de montant non titrée/);
});

test('une année courte n’est acceptée que corroborée par les cellules date ou le nom du fichier ; l’écart d’ouverture est borné', async () => {
  // Sans aucune cellule date ni nom de fichier, l'année « 26 » n'est pas corroborée.
  const bare: Cell[][] = [
    [null, null, null, 'BDK'],
    ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT'],
    ['OPENING BALANCE 08/07/26', null, null, null, null, null, A(1_000_000)],
    [null, null, 'CLOSING BALANCE as per Book : C=(A-B)', null, null, null, A(1_000_000)],
  ];
  const uncorroborated = await extractBankReportFromGrid(gridOf(bare, 'Feuil1'), 'BDK');
  assert.equal(uncorroborated.success, false);
  assert.match(uncorroborated.errors?.join(' ') ?? '', /année non corroborée/);
  const byFileName = await extractBankReportFromGrid(gridOf(bare, 'Feuil1'), 'BDK', { fileName: '07-BDK 2026.xlsx' });
  assert.equal(byFileName.success, true, byFileName.errors?.join(' '));
  assert.equal(byFileName.data?.date, '2026-07-08');
  const wrongFileYear = await extractBankReportFromGrid(gridOf(bare, 'Feuil1'), 'BDK', { fileName: '07-BDK 2025.xlsx' });
  assert.equal(wrongFileYear.success, false);

  // Le nom de feuille JJMMAA est corroboré de la même façon ; l'écart ouverture → feuille est borné à 7 jours.
  const sheetUncorroborated = await extractBankReportFromGrid(gridOf(bare, '090726'), 'BDK');
  assert.match(sheetUncorroborated.errors?.join(' ') ?? '', /nom de feuille invalide ou année non corroborée/);
  const tooOld = await extractBankReportFromGrid(gridOf(englishReport('BDK'), '200726'), 'BDK');
  assert.equal(tooOld.success, false);
  assert.match(tooOld.errors?.join(' ') ?? '', /plus de 7 jours/);
  const withinBound = await extractBankReportFromGrid(gridOf(englishReport('BDK'), '150726'), 'BDK');
  assert.equal(withinBound.success, true, withinBound.errors?.join(' '));
});

test('ATB : l’alias ATLANTIQUE BANK et les autres banques citées dans le corps sont acceptés', async () => {
  const rows = englishReport('ATLANTIQUE BANK');
  rows[8][2] = 'CHQ ECOBANK';
  rows[4][2] = 'VIREMENT CBAO';
  const result = await extractBankReportFromGrid(gridOf(rows), 'ATB');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.bank, 'ATB');
});

test('BIS : les dépôts sans titre après le solde d’ouverture forment la section implicite', async () => {
  const rows = englishReport('BIS');
  rows[3] = [];
  const result = await extractBankReportFromGrid(gridOf(rows), 'BIS');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.depositsNotCleared.length, 1);
});

test('ORA : les libellés français strictement listés sont reconnus', async () => {
  const rows: Cell[][] = [
    [null, null, null, 'ORABANK'],
    ['Date', 'Ch.No/Bd', 'DESCRIPTION', 'VENDOR', 'CLIENT', 'REF.', 'MONTANT', 'MONTANT -2'],
    ["SOLDE D'OUVERTURE 09/07/2026", null, null, null, null, null, A(5_000_000), A(0)],
    [null, null, null, 'Dépôts pas encore encaissé'],
    [D('2026-07-08'), D('2026-07-09'), 'REGLEMENT FAC. 01/07/26', 'FOURNISSEUR', 'CLIENT', null, A(100_000)],
    ['TOTAL DEPOSIT', null, null, null, null, null, A(100_000), A(0)],
    ['TOTAL (A)', null, null, null, null, null, A(5_100_000), A(0)],
    ['LESS :', null, null, 'Chéques émis non encaissés'],
    [D('2026-07-01'), { ref: 5555555 }, 'CHQ', 'BENEF', null, { ref: 12345 }, null, A(60_000)],
    [null, null, null, 'TOTAL (B)', null, null, A(0), A(60_000)],
    [null, null, 'SOLDE DE CLÔTURE selon le livre : C=(A-B)', null, null, null, A(5_040_000)],
    [],
    [null, null, null, 'BANK FACILITY (90Jrs)', null, null, D('2026-07-09')],
    [D('2026-07-09'), 'SPN', A(300_000_000), null, A(100_000_000), null, A(200_000_000)],
    [null, null, A(300_000_000), null, A(100_000_000), null, A(200_000_000)],
    [],
    [null, null, null, 'Impayés'],
    [D('2026-06-30'), D('2026-07-05'), 'IMPAYE', 'CL01', 'CLIENT', 'REF', A(40_000), null, { ref: 77777 }],
    [null, null, null, null, null, null, A(40_000)],
  ];
  const result = await extractBankReportFromGrid(gridOf(rows), 'ORA');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.date, '2026-07-09');
  assert.equal(result.data?.openingBalance, 5_000_000);
  assert.equal(result.data?.closingBalance, 5_040_000);
  assert.equal(result.data?.checksNotCleared?.[0].montant, 60_000);
  assert.equal(result.data?.bankFacilities.length, 1);
  assert.equal(result.data?.impayes[0].montant, 40_000, 'un compteur General en fin de ligne n’est pas le montant');

  // Un montant de chèque porté par une colonne non titrée (au-delà de MONTANT -2) refuse la ligne.
  const untitledChequeColumn = rows.map(row => [...row]);
  untitledChequeColumn[8] = [D('2026-07-01'), { ref: 5555555 }, 'CHQ', 'BENEF', null, { ref: 12345 }, null, null, A(60_000)];
  const refused = await extractBankReportFromGrid(gridOf(untitledChequeColumn), 'ORA');
  assert.equal(refused.success, false);
  assert.match(refused.errors?.join(' ') ?? '', /chèques non débités : montant absent/);
});

test('l’identité est lue dans l’en-tête : absence, ambiguïté ou banque inattendue refusent le document', async () => {
  const noTitle = englishReport('BDK');
  noTitle[0] = [];
  assert.equal((await extractBankReportFromGrid(gridOf(noTitle), 'BDK')).success, false);

  const ambiguous = englishReport('BDK');
  ambiguous[0] = [null, null, null, 'BDK', 'SGBS'];
  const ambiguousResult = await extractBankReportFromGrid(gridOf(ambiguous), 'BDK');
  assert.equal(ambiguousResult.success, false);
  assert.match(ambiguousResult.errors?.join(' ') ?? '', /ambigu/i);

  assert.equal((await extractBankReportFromGrid(gridOf(englishReport('BICIS')), 'BDK')).success, false);
});

test('les règles fail-closed : date de feuille incohérente, cellule d’erreur, ligne datée non exploitable, section vide', async () => {
  // Le nom de feuille fait foi ; un solde d'ouverture daté de la veille est accepté,
  // un solde d'ouverture postérieur à la feuille est refusé. (Noms de feuilles synthétiques.)
  const previousDayOpening = await extractBankReportFromGrid(gridOf(englishReport('BDK'), '100726'), 'BDK');
  assert.equal(previousDayOpening.success, true, previousDayOpening.errors?.join(' '));
  assert.equal(previousDayOpening.data?.date, '2026-07-10');
  const sheetMismatch = await extractBankReportFromGrid(gridOf(englishReport('BDK'), '080726'), 'BDK');
  assert.equal(sheetMismatch.success, false);
  assert.match(sheetMismatch.errors?.join(' ') ?? '', /postérieure à la date de la feuille/);
  const noSheetDate = await extractBankReportFromGrid(gridOf(englishReport('BDK'), 'Feuil1'), 'BDK');
  assert.equal(noSheetDate.data?.date, '2026-07-09');

  // Une ligne de facilité sans libellé métier explicite refuse : aucun libellé déduit du titre.
  const unnamedFacility = englishReport('BDK');
  unnamedFacility[15] = [null, D('2026-07-09'), null, A(1_000_000_000), A(400_000_000), null, A(600_000_000)];
  const unnamedResult = await extractBankReportFromGrid(gridOf(unnamedFacility), 'BDK');
  assert.equal(unnamedResult.success, false);
  assert.match(unnamedResult.errors?.join(' ') ?? '', /facilités bancaires sans libellé/);
  assert.doesNotMatch(JSON.stringify(unnamedResult), /BANK FACILITY \(180 jrs\)/);

  // Une date textuelle, un marqueur structurel ou un contenu numérique ne sont jamais un libellé métier.
  for (const nonLabel of [
    '09/07/2026', '09/07/26', 'TOTAL', 'Limit', 'BANK FACILITY (180 jrs)', '1 000', 'LESS :',
    'IMPAYE', 'Impayés', 'UNPAID', '1 000 FCFA', '12,5 €', '250 000 XOF', 'AMOUNT', 'DEPOSIT NOT YET CLEARED',
    'Chéques émis non encaissés', 'CHECK Not yet cleared', 'DESCRIPTION', 'CLIENT',
    // FIX_5 : composition avec un mot structurel, une date ou une séquence monétaire embarquée.
    'DATE 09/07/2026', 'AMOUNT 1 000', 'MONTANT 1 000 FCFA', 'LIMIT 1 000', 'USD 100', 'Découvert 1 000 FCFA',
    'Escompte 12,5', 'Crédit 1.000.000', 'SPOT € 500', 'Avance 2500', 'Impayé client X', 'Solde disponible',
    'Total escompte', 'Facilité au 09-07-26', 'Découvert 100 $',
    // FIX_6 : vocabulaire structurel complet en composition, et tout chiffre dans un libellé générique.
    'LIGNE CHEQUE 100', 'FACILITE DEPOSIT', 'TYPE CHECK', 'LIGNE BANK FACILITY', 'Découvert 999', 'AMT 100',
    'CREDIT SPOT 90 JOURS', 'Escompte de chèques', 'Facilité de caisse', 'Not yet cleared', 'Dépôts pas encore encaissés',
    'Closing book', 'Add escompte', 'Vendor SPN', 'Ch.No 12',
  ]) {
    const disguised = englishReport('BDK');
    disguised[15] = [null, D('2026-07-09'), nonLabel, A(1_000_000_000), A(400_000_000), null, A(600_000_000)];
    const disguisedResult = await extractBankReportFromGrid(gridOf(disguised), 'BDK');
    assert.equal(disguisedResult.success, false, `libellé « ${nonLabel} » refusé`);
    assert.doesNotMatch(JSON.stringify(disguisedResult.data ?? {}), /09\/07\/2026|"facilityType":"TOTAL"/);
  }

  // Section titrée sans ligne : avertissement seulement si aucune ligne n'est ignorée jusqu'à la frontière suivante.
  const emptyThenDated = englishReport('BDK');
  emptyThenDated.splice(20, 3, [null, null, null, null, null, null, A(100_000)]);
  assert.equal((await extractBankReportFromGrid(gridOf(emptyThenDated), 'BDK')).success, true, 'total chiffré seul = frontière');
  const emptyThenStray = englishReport('BDK');
  emptyThenStray.splice(20, 3, ['NOTE LIBRE']);
  assert.equal((await extractBankReportFromGrid(gridOf(emptyThenStray), 'BDK')).success, false);

  const errorCell = englishReport('BDK');
  errorCell[4][6] = { error: '#REF!' };
  assert.equal((await extractBankReportFromGrid(gridOf(errorCell), 'BDK')).success, false);

  const missingAmount = englishReport('BDK');
  missingAmount[8] = [D('2026-07-01'), { ref: 1 }, 'CHQ SANS MONTANT'];
  assert.equal((await extractBankReportFromGrid(gridOf(missingAmount), 'BDK')).success, false);

  const decimalAmount = englishReport('BDK');
  decimalAmount[4][6] = { amount: 250_000.5 };
  assert.equal((await extractBankReportFromGrid(gridOf(decimalAmount), 'BDK')).success, false);

  // Une section titrée sans ligne est un état normal (titre imprimé chaque jour) : avertissement, pas refus.
  const emptySection = englishReport('BDK');
  emptySection.splice(20, 3);
  const emptyResult = await extractBankReportFromGrid(gridOf(emptySection), 'BDK');
  assert.equal(emptyResult.success, true, emptyResult.errors?.join(' '));
  assert.equal(emptyResult.data?.impayes.length, 0);
  assert.match(emptyResult.warnings?.join(' ') ?? '', /titrée\(s\) sans ligne : impayés/);

  const noClosing = englishReport('BDK');
  noClosing[11] = [];
  assert.equal((await extractBankReportFromGrid(gridOf(noClosing), 'BDK')).success, false);

  const badFacility = englishReport('BDK');
  badFacility[15] = [null, D('2026-07-09'), 'SPN', A(1_000_000_000), A(400_000_000)];
  assert.equal((await extractBankReportFromGrid(gridOf(badFacility), 'BDK')).success, false);
});

test('le solde d’ouverture accepte une année sur deux chiffres et refuse le rendu m/d/yy', async () => {
  const shortYear = englishReport('BDK');
  shortYear[2][0] = 'OPENING BALANCE 09/07/26';
  assert.equal((await extractBankReportFromGrid(gridOf(shortYear), 'BDK')).success, true);

  const usRendering = englishReport('BDK');
  usRendering[2][0] = 'OPENING BALANCE 7/9/26';
  assert.equal((await extractBankReportFromGrid(gridOf(usRendering), 'BDK')).success, false);
});
