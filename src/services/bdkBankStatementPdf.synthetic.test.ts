import assert from 'node:assert/strict';
import test from 'node:test';
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
