import assert from 'node:assert/strict';
import test from 'node:test';
import { extractBDKAccountStatement } from './bdkAccountStatementExtractor';
import { parseBDKAccountStatement } from './bdkAccountStatementParser';
import { analyzeBDKBankStatementText } from './bdkBankStatementDiagnosticService';
import { bdkExtractionService } from './bdkExtractionService';
import { bankReportProcessingService } from './bankReportProcessingService';
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

const LETTER_SPACED_ACCOUNT_STATEMENT_TEXT = `
BDK
E X T R A I T   D E   C O M P T E
Periode du 30/04/2026 au 05/05/2026
S o l d e   i n i t i a l   ( X O F ) : 1 000 000

Date       Valeur     Libelle                         D e b i t     C r e d i t    Solde
30/04/2026 30/04/2026 VIREMENT SYNTHETIC FOURNISSEUR 200 000                   800 000
02/05/2026 02/05/2026 ENCAISSEMENT SYNTHETIC CLIENT              200 000       1 000 000
05/05/2026 05/05/2026 FRAIS SYNTHETIC               100 000                   900 000

Total                                                300 000        200 000
S o l d e   ( X O F )   a u 05/05/2026 : 900 000
`;

type BankReportProcessingPdfStub = {
  extractTextFromPDF: (buffer: ArrayBuffer) => Promise<string>;
};

async function processSyntheticBDKPDF(textContent: string) {
  const pdfStub = bankReportProcessingService as unknown as BankReportProcessingPdfStub;
  const extractTextFromPDF = pdfStub.extractTextFromPDF;

  pdfStub.extractTextFromPDF = async () => textContent;

  try {
    const file = new File(['synthetic bdk pdf'], 'BDK synthetic statement.pdf', {
      type: 'application/pdf'
    });

    return await bankReportProcessingService.processBankReportExcel(file);
  } finally {
    pdfStub.extractTextFromPDF = extractTextFromPDF;
  }
}

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

test('BDK PDF synthetic baseline: bank report service keeps analysis reports on section extraction path', async () => {
  const result = await processSyntheticBDKPDF(SYNTHETIC_BDK_PDF_TEXT);

  assert.equal(result.success, true);
  assert.ok(result.data);
  assert.equal(result.data.bank, 'BDK');
  assert.equal(result.data.openingBalance, 1_000_000);
  assert.equal(result.data.closingBalance, 1_025_000);
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

test('BDK account statement synthetic fixture: pure parser extracts transaction lines', () => {
  const result = parseBDKAccountStatement(ACCOUNT_STATEMENT_TEXT);

  assert.equal(result.success, true);
  assert.ok(result.statement);
  assert.equal(result.statement.lines.length, 3);
  assert.equal(result.statement.openingBalance, 1_000_000);
  assert.equal(result.statement.totalDebits, 300_000);
  assert.equal(result.statement.totalCredits, 200_000);
  assert.equal(result.statement.closingBalance, 900_000);
});

test('BDK account statement synthetic fixture: pure parser derives transaction directions from balances', () => {
  const result = parseBDKAccountStatement(ACCOUNT_STATEMENT_TEXT);

  assert.ok(result.statement);
  assert.deepEqual(
    result.statement.lines.map((line) => ({
      direction: line.direction,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
      signedAmount: line.signedAmount,
      runningBalance: line.runningBalance
    })),
    [
      {
        direction: 'debit',
        debitAmount: 200_000,
        creditAmount: undefined,
        signedAmount: -200_000,
        runningBalance: 800_000
      },
      {
        direction: 'credit',
        debitAmount: undefined,
        creditAmount: 200_000,
        signedAmount: 200_000,
        runningBalance: 1_000_000
      },
      {
        direction: 'debit',
        debitAmount: 100_000,
        creditAmount: undefined,
        signedAmount: -100_000,
        runningBalance: 900_000
      }
    ]
  );
});

test('BDK account statement synthetic fixture: pure parser rejects inconsistent closing balance', () => {
  const inconsistentText = ACCOUNT_STATEMENT_TEXT.replace(
    'Solde (XOF) au 05/05/2026 : 900 000',
    'Solde (XOF) au 05/05/2026 : 901 000'
  );
  const result = parseBDKAccountStatement(inconsistentText);

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.equal(result.validation.isValid, false);
  assert.match(result.errors.join(' '), /validation failed/i);
});

test('BDK account statement synthetic fixture: pure parser rejects statement without transaction lines', () => {
  const statementWithoutLines = ACCOUNT_STATEMENT_TEXT
    .split('\n')
    .filter((line) => !/^\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+/.test(line))
    .join('\n');
  const result = parseBDKAccountStatement(statementWithoutLines);

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /no transaction lines extracted/i);
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

test('BDK account statement synthetic fixture: diagnostic service extracts detected account statement', () => {
  const result = analyzeBDKBankStatementText(ACCOUNT_STATEMENT_TEXT);

  assert.equal(result.detectedFormat, 'bdk_account_statement');
  assert.equal(result.success, true);
  assert.ok(result.accountStatement);
  assert.equal(result.accountStatement.openingBalance, 1_000_000);
  assert.equal(result.accountStatement.totalDebits, 300_000);
  assert.equal(result.accountStatement.totalCredits, 200_000);
  assert.equal(result.accountStatement.closingBalance, 900_000);
  assert.equal(result.accountStatement.validation.isValid, true);
});

test('BDK account statement synthetic fixture: diagnostic service detects letter-spaced markers', () => {
  const result = analyzeBDKBankStatementText(LETTER_SPACED_ACCOUNT_STATEMENT_TEXT);

  assert.equal(result.detectedFormat, 'bdk_account_statement');
  assert.equal(result.success, false);
  assert.ok(result.accountStatement);
  assert.ok(result.errors.length > 0);
  assert.deepEqual(result.errors, result.accountStatement.errors);
  assert.doesNotMatch(result.errors.join(' '), /unknown/i);
});

test('BDK account statement synthetic fixture: diagnostic service reports invalid detected account statement', () => {
  const inconsistentText = ACCOUNT_STATEMENT_TEXT.replace(
    'Solde (XOF) au 05/05/2026 : 900 000',
    'Solde (XOF) au 05/05/2026 : 901 000'
  );
  const result = analyzeBDKBankStatementText(inconsistentText);

  assert.equal(result.detectedFormat, 'bdk_account_statement');
  assert.equal(result.success, false);
  assert.ok(result.accountStatement);
  assert.equal(result.accountStatement.validation.isValid, false);
});

test('BDK account statement synthetic fixture: bank report service rejects detected account statement', async () => {
  const result = await processSyntheticBDKPDF(ACCOUNT_STATEMENT_TEXT);

  assert.equal(result.success, false);
  assert.equal(result.data, undefined);
  assert.match(result.errors?.join(' ') ?? '', /not supported as BankReport documents/i);
});

test('BDK account statement synthetic fixture: bank report service rejects invalid detected account statement', async () => {
  const inconsistentText = ACCOUNT_STATEMENT_TEXT.replace(
    'Solde (XOF) au 05/05/2026 : 900 000',
    'Solde (XOF) au 05/05/2026 : 901 000'
  );
  const result = await processSyntheticBDKPDF(inconsistentText);

  assert.equal(result.success, false);
  assert.equal(result.data, undefined);
  assert.match(result.errors?.join(' ') ?? '', /not supported as BankReport documents/i);
});

test('BDK PDF synthetic baseline: diagnostic service detects analysis report without handling it', () => {
  const result = analyzeBDKBankStatementText(SYNTHETIC_BDK_PDF_TEXT);

  assert.equal(result.detectedFormat, 'bdk_analysis_report');
  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /not handled by this diagnostic service/i);
});

test('BDK diagnostic service reports unknown synthetic text', () => {
  const result = analyzeBDKBankStatementText('Synthetic text without BDK bank statement markers.');

  assert.equal(result.detectedFormat, 'unknown');
  assert.equal(result.success, false);
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
