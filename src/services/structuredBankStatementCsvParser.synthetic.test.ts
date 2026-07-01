import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStructuredBankStatementCsv
} from './structuredBankStatementCsvParser';

// All fixtures below are fully synthetic. No real bank statement data is used.

function csv(rows: string[]): string {
  return rows.join('\n');
}

function validOraLikeCsv(): string {
  return csv([
    'EXTRAIT DE COMPTE;;;;;',
    'Periode du;01/06/2026;au;30/06/2026;;',
    'Numero de compte;01401-00000000000-00 XOF;;;;',
    'Code IBAN;SN00SN0000000000000000000000;;;;',
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW ORABANK;200000;;800000',
    '02/06/2026;02/06/2026;SYNTHETIC INFLOW;;500000;1300000',
    '03/06/2026;03/06/2026;SYNTHETIC OUTFLOW TWO;300000;;1000000',
    ';;Total;500000;500000;',
    ';;Solde (XOF) au 30/06/2026 : 1000000;;;'
  ]);
}

test('parses a valid ORA-like CSV and reconciles to valid', () => {
  const document = parseStructuredBankStatementCsv(validOraLikeCsv());

  assert.equal(document.validation.status, 'valid');
  assert.equal(document.detectedDelimiter, ';');
  // "ORABANK" appears in a transaction label but bankHint must stay UNKNOWN:
  // the transactional body is never scanned for bank identity.
  assert.equal(document.bankHint, 'UNKNOWN');
  assert.equal(document.currency, 'XOF');
  assert.equal(document.periodStart, '01/06/2026');
  assert.equal(document.periodEnd, '30/06/2026');
  assert.equal(document.statementDate, '30/06/2026');
  assert.equal(document.openingBalance, 1_000_000);
  assert.equal(document.declaredClosingBalance, 1_000_000);
  assert.equal(document.declaredTotalDebits, 500_000);
  assert.equal(document.declaredTotalCredits, 500_000);
  assert.equal(document.lines.length, 3);
  assert.deepEqual(document.lines.map((line) => line.direction), ['debit', 'credit', 'debit']);
  assert.deepEqual(document.lines.map((line) => line.signedAmount), [-200_000, 500_000, -300_000]);
  assert.equal(document.validation.declaredTotalsMatchLines, true);
  assert.equal(document.validation.lineBalancesConsistent, true);
  assert.equal(document.validation.closingBalanceDiscrepancy, 0);
  assert.deepEqual(document.validation.warnings, []);
});

test('never exposes a raw account number, only a masked identifier', () => {
  const document = parseStructuredBankStatementCsv(validOraLikeCsv());

  assert.ok(document.accountNumberMasked);
  assert.match(document.accountNumberMasked as string, /^\*\*\*\*/);
  assert.equal((document.accountNumberMasked as string).includes('01401'), false);
  assert.ok(document.ibanMasked);
  assert.match(document.ibanMasked as string, /^\*\*\*\*/);
  assert.equal(Object.prototype.hasOwnProperty.call(document, 'accountNumberRaw'), false);
});

test('flags a BDK-like final balance anomaly as needs_review without dropping lines', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW;200000;;800000',
    '02/06/2026;02/06/2026;SYNTHETIC INFLOW;;500000;1300000',
    '03/06/2026;03/06/2026;SYNTHETIC OUTFLOW TWO;300000;;1000000',
    ';;Total;500000;500000;',
    // Declared closing intentionally diverges from the reconstructed balances.
    ';;Solde (XOF) au 30/06/2026 : 777777;;;'
  ]));

  assert.equal(document.validation.status, 'needs_review');
  assert.equal(document.lines.length, 3);
  assert.equal(document.validation.lineBalancesConsistent, true);
  assert.equal(document.validation.declaredTotalsMatchLines, true);
  assert.equal(document.validation.computedClosingBalance, 1_000_000);
  assert.equal(document.validation.closingBalanceDiscrepancy, 1_000_000 - 777_777);
  assert.match(document.validation.warnings.join(' '), /closing balance/i);
});

test('reconstructs a multi-line quoted description into a single sanitized label', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;"CHEQUE DE BANQUE',
    'N 101632',
    'FAVEUR UEMOA";200000;;800000',
    ';;Total;200000;0;',
    ';;Solde (XOF) au 30/06/2026 : 800000;;;'
  ]));

  assert.equal(document.lines.length, 1);
  assert.equal(
    document.lines[0].descriptionSanitized,
    'CHEQUE DE BANQUE N 101632 FAVEUR UEMOA'
  );
  assert.equal(document.validation.status, 'valid');
});

test('accepts negative running balances (overdraft)', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ';;Solde initial (XOF) : 100000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OVERDRAFT;300000;;-200000',
    ';;Total;300000;0;',
    ';;Solde (XOF) au 30/06/2026 : -200000;;;'
  ]));

  assert.equal(document.lines.length, 1);
  assert.equal(document.lines[0].balance, -200_000);
  assert.equal(document.lines[0].signedAmount, -300_000);
  assert.equal(document.openingBalance, 100_000);
  assert.equal(document.declaredClosingBalance, -200_000);
  assert.equal(document.validation.status, 'valid');
});

test('excludes footnote, blank and balance rows from transaction lines', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW;200000;;800000',
    ';;;;;',
    '(*) : Les evenements du jour sont sujets a modification;;;;;',
    '02/06/2026;02/06/2026;SYNTHETIC INFLOW;;200000;1000000',
    ';;Total;200000;200000;',
    ';;Solde (XOF) au 30/06/2026 : 1000000;;;'
  ]));

  assert.equal(document.lines.length, 2);
  assert.deepEqual(document.lines.map((line) => line.direction), ['debit', 'credit']);
  assert.equal(document.validation.status, 'valid');
});

test('rejects a row carrying both a debit and a credit amount', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC AMBIGUOUS;100000;100000;1000000',
    ';;Solde (XOF) au 30/06/2026 : 1000000;;;'
  ]));

  assert.equal(document.validation.status, 'invalid');
  assert.equal(document.lines[0].direction, 'unknown');
  assert.match(document.errors.join(' '), /both a debit and a credit/i);
});

test('rejects a row carrying neither a debit nor a credit amount', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC NO AMOUNT;;;1000000',
    ';;Solde (XOF) au 30/06/2026 : 1000000;;;'
  ]));

  assert.equal(document.validation.status, 'invalid');
  assert.equal(document.lines[0].direction, 'unknown');
  assert.match(document.errors.join(' '), /neither a debit nor a credit/i);
});

test('returns unsupported when no recognizable header row is present', () => {
  const document = parseStructuredBankStatementCsv(csv([
    'FOO;BAR;BAZ',
    'ALPHA;BETA;GAMMA',
    '1;2;3'
  ]));

  assert.equal(document.validation.status, 'unsupported');
  assert.deepEqual(document.lines, []);
  assert.match(document.errors.join(' '), /header/i);
});

test('fails closed when a required column header is missing', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ';;Solde initial (XOF) : 1000000;;;',
    // "Solde" (balance) column intentionally omitted.
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW;200000;',
    ';;Solde (XOF) au 30/06/2026 : 800000;;;'
  ]));

  assert.equal(document.validation.status, 'invalid');
  assert.deepEqual(document.lines, []);
  assert.match(document.errors.join(' '), /missing required column headers.*balance/i);
});

test('detects a comma delimiter', () => {
  const document = parseStructuredBankStatementCsv(csv([
    ',,Solde initial (XOF) : 1000000,,,',
    "Date,Valeur,Libelle de l'operation,Debit(XOF),Credit(XOF),Solde(XOF)",
    '01/06/2026,01/06/2026,SYNTHETIC OUTFLOW,200000,,800000',
    ',,Total,200000,0,',
    ',,Solde (XOF) au 30/06/2026 : 800000,,,'
  ]));

  assert.equal(document.detectedDelimiter, ',');
  assert.equal(document.lines.length, 1);
  assert.equal(document.validation.status, 'valid');
});

test('detects a tab delimiter', () => {
  const document = parseStructuredBankStatementCsv(csv([
    '\t\tSolde initial (XOF) : 1000000\t\t\t',
    "Date\tValeur\tLibelle de l'operation\tDebit(XOF)\tCredit(XOF)\tSolde(XOF)",
    '01/06/2026\t01/06/2026\tSYNTHETIC OUTFLOW\t200000\t\t800000',
    '\t\tTotal\t200000\t0\t',
    '\t\tSolde (XOF) au 30/06/2026 : 800000\t\t\t'
  ]));

  assert.equal(document.detectedDelimiter, '\t');
  assert.equal(document.lines.length, 1);
  assert.equal(document.validation.status, 'valid');
});

test('infers bankHint from the source file name (no ORABANK in the body)', () => {
  const bodyWithoutBankKeyword = csv([
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW;200000;;800000',
    ';;Total;200000;0;',
    ';;Solde (XOF) au 30/06/2026 : 800000;;;'
  ]);

  const oraDocument = parseStructuredBankStatementCsv(bodyWithoutBankKeyword, {
    sourceFileName: '010726 ORA ONLINE.csv'
  });
  const bdkDocument = parseStructuredBankStatementCsv(bodyWithoutBankKeyword, {
    sourceFileName: '010726 BDK ONLINE.csv'
  });
  const anonymousDocument = parseStructuredBankStatementCsv(bodyWithoutBankKeyword);

  assert.equal(bodyWithoutBankKeyword.includes('ORABANK'), false);
  assert.equal(oraDocument.bankHint, 'ORA');
  assert.equal(bdkDocument.bankHint, 'BDK');
  assert.equal(anonymousDocument.bankHint, 'UNKNOWN');
});

test('returns the provided sourceFileName in the document', () => {
  const document = parseStructuredBankStatementCsv(validOraLikeCsv(), {
    sourceFileName: 'synthetic-export.csv'
  });

  assert.equal(document.sourceFileName, 'synthetic-export.csv');
});

test('masks the account number without leaking a trailing currency suffix', () => {
  const document = parseStructuredBankStatementCsv(csv([
    'Numero de compte;01401-00000000000-99 XOF;;;;',
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW;200000;;800000',
    ';;Total;200000;0;',
    ';;Solde (XOF) au 30/06/2026 : 800000;;;'
  ]));

  assert.ok(document.accountNumberMasked);
  assert.match(document.accountNumberMasked as string, /^\*\*\*\*/);
  assert.equal(/xof$/i.test(document.accountNumberMasked as string), false);
  assert.equal((document.accountNumberMasked as string).includes('01401'), false);
  assert.equal(document.currency, 'XOF');
});
