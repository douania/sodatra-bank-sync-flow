import assert from 'node:assert/strict';
import test from 'node:test';
import { extractBDKAccountStatement } from './bdkAccountStatementExtractor';
import { bdkExtractionService } from './bdkExtractionService';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';

const SYNTHETIC_BDK_PDF_TEXT = `
18/05/2026 BDK
OPENING BALANCE 18/05/2026 1 000 000
ADD : DEPOSIT NOT YET CLEARED
18/05/2026 18/05/2026 REGLEMENT FACTURE ECOBANK SYNTHETICCLIENT 100 000
TOTAL DEPOSIT 100 000
TOTAL BALANCE (A) 1 100 000
LESS : CHECK Not yet cleared
18/05/2026 1001 SYNTHETIC CHECK ALPHA 40 000 FCFA
18/05/2026 1002 SYNTHETIC CHECK BETA 35 000 FCFA
TOTAL (B) 75 000
CLOSING BALANCE as per Book : C=(A-B) 1 025 000
BANK FACILITY Limit Used Balance
27/06/2026 SPN 1000000 400000 600000
1000000 400000 600000
IMPAYE
18/05/2026 3361178 IMPAYE CORIS SYNTHETIC CLIENT REGUL IMPAYE FRAIS 25 000
`;

const ACCOUNT_STATEMENT_TEXT = `
BDK
EXTRAIT DE COMPTE
Periode du 30/04/2026 au 05/05/2026
Solde initial (XOF) : 1 000 000

Date       Valeur     Libelle                         Debit     Credit    Solde
30/04/2026 30/04/2026 VIREMENT SYNTHETIC FOURNISSEUR 200 000             800 000
02/05/2026 02/05/2026 ENCAISSEMENT SYNTHETIC CLIENT             200 000  1 000 000
05/05/2026 05/05/2026 FRAIS SYNTHETIC               100 000             900 000

Total                                                300 000    200 000
Solde (XOF) au 05/05/2026 : 900 000
`;

test('BDK PDF synthetic baseline: specialized parser extracts core sections and validates A-B=C', () => {
  const result = bdkExtractionService.extractBDKData(SYNTHETIC_BDK_PDF_TEXT);

  assert.equal(result.reportDate, '18/05/2026');
  assert.equal(result.openingBalance.amount, 1_000_000);
  assert.equal(result.totalDeposits, 100_000);
  assert.equal(result.totalBalanceA, 1_100_000);
  assert.equal(result.checks.length, 2);
  assert.equal(result.totalChecks, 75_000);
  assert.equal(result.closingBalance, 1_025_000);
  assert.equal(result.validation.calculatedClosing, 1_025_000);
  assert.equal(result.validation.discrepancy, 0);
  assert.equal(result.validation.isValid, true);
  assert.equal(result.facilities.length, 1);
  assert.equal(result.impayes.length, 1);
});

test('BDK PDF synthetic baseline: generic section extractor is characterized separately', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections(SYNTHETIC_BDK_PDF_TEXT, 'BDK');

  assert.equal(result.success, true);
  assert.ok(result.data);
  assert.equal(result.data.bank, 'BDK');
  assert.equal(result.data.openingBalance, 1_000_000);
  assert.equal(result.data.closingBalance, 1_025_000);
  assert.equal(Array.isArray(result.data.depositsNotCleared), true);
  assert.equal(Array.isArray(result.data.checksNotCleared), true);
  assert.equal(Array.isArray(result.data.bankFacilities), true);
  assert.equal(Array.isArray(result.data.impayes), true);
});

test('BDK account statement synthetic fixture: expected balances follow opening + credits - debits = closing', () => {
  const opening = 1_000_000;
  const totalDebits = 300_000;
  const totalCredits = 200_000;
  const closing = 900_000;

  assert.equal(opening + totalCredits - totalDebits, closing);
});

test('BDK account statement synthetic fixture: isolated extractor validates statement totals', () => {
  const result = extractBDKAccountStatement(ACCOUNT_STATEMENT_TEXT);

  assert.equal(result.reportDate, '05/05/2026');
  assert.equal(result.openingBalance, 1_000_000);
  assert.equal(result.totalDebits, 300_000);
  assert.equal(result.totalCredits, 200_000);
  assert.equal(result.closingBalance, 900_000);
  assert.equal(result.validation.calculatedClosing, 900_000);
  assert.equal(result.validation.discrepancy, 0);
  assert.equal(result.validation.isValid, true);
  assert.equal(result.success, true);
  assert.deepEqual(result.errors, []);
});

test('BDK account statement synthetic fixture: isolated extractor rejects inconsistent closing balance', () => {
  const inconsistentText = ACCOUNT_STATEMENT_TEXT.replace(
    'Solde (XOF) au 05/05/2026 : 900 000',
    'Solde (XOF) au 05/05/2026 : 901 000'
  );
  const result = extractBDKAccountStatement(inconsistentText);

  assert.equal(result.closingBalance, 901_000);
  assert.equal(result.validation.calculatedClosing, 900_000);
  assert.equal(result.validation.discrepancy, -1_000);
  assert.equal(result.validation.isValid, false);
  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /validation failed/i);
});

test('BDK account statement synthetic fixture: isolated extractor accepts flattened accented text', () => {
  const flattenedText = ACCOUNT_STATEMENT_TEXT
    .replace('Periode', 'P\u00e9riode')
    .replace('Libelle', 'Libell\u00e9')
    .replace('Debit', 'D\u00e9bit')
    .replace('Credit', 'Cr\u00e9dit')
    .replace(/1 000 000/g, '1\u00a0000\u202f000')
    .replace(/\s*\n\s*/g, ' ');
  const result = extractBDKAccountStatement(flattenedText);

  assert.equal(result.openingBalance, 1_000_000);
  assert.equal(result.totalDebits, 300_000);
  assert.equal(result.totalCredits, 200_000);
  assert.equal(result.closingBalance, 900_000);
  assert.equal(result.success, true);
});

test('BDK account statement synthetic fixture: specialized parser documents current unsupported format', () => {
  const result = bdkExtractionService.extractBDKData(ACCOUNT_STATEMENT_TEXT);

  // This documents current unsupported account-statement format. A future 0E parser should replace these limitation assertions with positive extraction assertions.
  assert.equal(result.openingBalance.amount, 0);
  assert.equal(result.totalDeposits, 0);
  assert.equal(result.totalChecks, 0);
  assert.equal(result.closingBalance, 0);
  assert.equal(result.deposits.length, 0);
  assert.equal(result.checks.length, 0);
  assert.equal(result.facilities.length, 0);
  assert.equal(result.impayes.length, 0);
});

test('BDK account statement synthetic fixture: generic section extractor documents current limitation', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections(ACCOUNT_STATEMENT_TEXT, 'BDK');

  // Current limitation: account-statement sections do not match the generic BDK bank-report patterns yet.
  assert.equal(result.success, true);
  assert.ok(result.data);
  assert.equal(result.data.openingBalance, 0);
  assert.equal(result.data.closingBalance, 0);
  assert.equal(result.data.depositsNotCleared.length, 0);
  assert.equal(result.data.checksNotCleared.length, 0);
  assert.equal(result.data.bankFacilities.length, 0);
  assert.equal(result.data.impayes.length, 0);
});
