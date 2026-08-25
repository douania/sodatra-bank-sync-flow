import assert from 'node:assert/strict';
import test from 'node:test';

import type { OperationalBankCode } from './bankIdentity';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';
import { extractBankReport, extractClientReconciliation } from './extractionService';

const nominalFixtures: Record<OperationalBankCode, string> = {
  BDK: 'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
  ATB: 'ATB RAPPORT 05/08/2026\nSOLDE OUVERTURE 05/08/2026 1 000 000\nSOLDE CLOTURE COMPTABLE: 900 000',
  BICIS: 'BICIS RAPPORT 05/08/2026\nSOLDE INITIAL 05/08/2026 1 000 000\nSOLDE FINAL COMPTABLE: 900 000',
  ORA: 'ORABANK RAPPORT 05/08/2026\nBALANCE OPENING 05/08/2026 1 000 000\nBALANCE CLOSING BOOK: 900 000',
  SGBS: 'SGBS RAPPORT 05/08/2026\nSOLDE OUVERTURE 05/08/2026 1 000 000\nSOLDE FERMETURE LIVRE: 900 000',
  BIS: 'BIS RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\nCLOSING BALANCE BOOK: 900 000',
};

for (const [bank, fixture] of Object.entries(nominalFixtures) as [OperationalBankCode, string][]) {
  test(`${bank}: le contrat nominal extrait date et soldes explicites`, async () => {
    const result = await bankReportSectionExtractor.extractBankReportSections(fixture, bank);
    assert.equal(result.success, true, result.errors?.join(' '));
    assert.equal(result.data?.bank, bank);
    assert.equal(result.data?.date, '2026-08-05');
    assert.equal(result.data?.openingBalance, 1000000);
    assert.equal(result.data?.closingBalance, 900000);
  });
}

test('le contrat bancaire refuse texte aplati, banque incohérente et date invalide', async () => {
  const flattened = nominalFixtures.BDK.split('\n').join(' ');
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(flattened, 'BDK')).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(nominalFixtures.ATB, 'BDK')).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    nominalFixtures.BDK.split('05/08/2026').join('31/02/2026'),
    'BDK',
  )).success, false);
});

test('le contrat bancaire refuse les soldes absents ou invalides et les sections vides', async () => {
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nDOCUMENT SANS SOLDE',
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000,50',
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    `${nominalFixtures.BDK}\nDEPOSIT NOT YET CLEARED\nAUCUNE LIGNE EXPLOITABLE`,
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    `${nominalFixtures.BDK}\nDEPOSIT NOT YET CLEARED\n31/02/2026 123 REGLEMENT FACTURE CLIENT 100`,
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    nominalFixtures.BDK.replace('1 000 000', '12O000'),
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    nominalFixtures.BDK.replace('900 000', '9O0000'),
    'BDK',
  )).success, false);
});

test('un solde ne peut pas absorber le début chiffré de la ligne suivante', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\n18/05/2026 AUTRE LIGNE\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.openingBalance, 1000000);
});

test('une colonne numérique PDF voisine reste séparée du solde', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\t900 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.openingBalance, 1000000);
});

test('la date d’en-tête doit concorder avec celle du solde d’ouverture', async () => {
  const mismatch = await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT EDITE LE 12/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(mismatch.success, false);

  const dateBeforeBank = await bankReportSectionExtractor.extractBankReportSections(
    '18/05/2026 BDK\nOPENING BALANCE 18/05/2026 1 000 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(dateBeforeBank.success, true, dateBeforeBank.errors?.join(' '));
  assert.equal(dateBeforeBank.data?.date, '2026-05-18');
});

test('BDK: un rapport avec sections exploitables est accepté', async () => {
  const report = [
    nominalFixtures.BDK,
    'DEPOSIT NOT YET CLEARED',
    '05/08/2026 123 REGLEMENT FACTURE CLIENT 100',
    'CHECK Not yet cleared',
    '05/08/2026 456 BENEFICIAIRE 50',
    'BANK FACILITY',
    'SPN 1000 400 600',
    'IMPAYE',
    '05/08/2026 05/08/2026 IMPAYE CL001 CLIENT 25',
  ].join('\n');
  const result = await bankReportSectionExtractor.extractBankReportSections(report, 'BDK');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.depositsNotCleared.length, 1);
  assert.equal(result.data?.checksNotCleared?.length, 1);
  assert.equal(result.data?.bankFacilities.length, 1);
  assert.equal(result.data?.impayes.length, 1);
});

test('les lignes de section refusent un montant OCR suffixé au lieu de persister son préfixe', async () => {
  for (const section of [
    [
      'DEPOSIT NOT YET CLEARED',
      '05/08/2026 123 REGLEMENT FACTURE CLIENT 100',
      '05/08/2026 124 REGLEMENT FACTURE CLIENT 12O000',
    ],
    [
      'CHECK Not yet cleared',
      '05/08/2026 456 BENEFICIAIRE 50',
      '05/08/2026 457 BENEFICIAIRE 12O000',
    ],
    ['BANK FACILITY', 'SPN 1000 400 600', 'AUTRE 1000 400 6O0'],
    [
      'IMPAYE',
      '05/08/2026 05/08/2026 IMPAYE CL001 CLIENT 25',
      '05/08/2026 05/08/2026 IMPAYE CL002 CLIENT 2O',
    ],
  ]) {
    for (const lines of [section.slice(0, 1).concat(section[2]), section]) {
      const result = await bankReportSectionExtractor.extractBankReportSections(
        [nominalFixtures.BDK, ...lines].join('\n'),
        'BDK',
      );
      assert.equal(result.success, false, lines.join(' — '));
    }
  }
});

test('ATB: une section dépôts exploitable utilise le dernier groupe comme montant', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections([
    nominalFixtures.ATB,
    'DEPOTS NON CREDITES',
    '05/08/2026 123 CLIENT SYNTHETIQUE 100',
  ].join('\n'), 'ATB');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.depositsNotCleared[0]?.montant, 100);
});

test('ORA: l’unique date d’un impayé reste explicite et exploitable', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections([
    nominalFixtures.ORA,
    'UNPAID ITEMS',
    '05/08/2026 UNPAID CL001 CLIENT SYNTHETIQUE 25',
  ].join('\n'), 'ORA');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.impayes[0]?.dateRetour, undefined);
  assert.equal(result.data?.impayes[0]?.dateEcheance, '2026-08-05');
});

test('les anciens points d’entrée permissifs restent explicitement désactivés', () => {
  assert.equal(extractBankReport(nominalFixtures.BDK, 'BDK').success, false);
  assert.equal(extractClientReconciliation('CLIENT 100').success, false);
});
