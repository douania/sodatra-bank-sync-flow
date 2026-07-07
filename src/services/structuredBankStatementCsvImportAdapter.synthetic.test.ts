import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptStructuredBankStatementDocumentToBankAccountStatementImportResult,
  findStructuredBankStatementIngestionGuardRejection,
  BRIDGE_CSV_INGESTION_REJECTION_MESSAGE,
  UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE,
  type StructuredBankStatementCsvImportAdapterOptions
} from './structuredBankStatementCsvImportAdapter';
import {
  parseStructuredBankStatementCsv,
  type StructuredBankStatementDocument,
  type StructuredBankStatementLine,
  type StructuredBankStatementValidation
} from './structuredBankStatementCsvParser';

// All fixtures below are fully synthetic. No real bank statement data is used.

function makeLines(): StructuredBankStatementLine[] {
  return [
    {
      sourceRowIndex: 6,
      operationDate: '01/06/2026',
      valueDate: '01/06/2026',
      descriptionSanitized: 'SYNTHETIC OUTFLOW',
      debit: 200_000,
      signedAmount: -200_000,
      balance: 800_000,
      direction: 'debit'
    },
    {
      sourceRowIndex: 7,
      operationDate: '02/06/2026',
      valueDate: '02/06/2026',
      descriptionSanitized: 'SYNTHETIC INFLOW',
      credit: 500_000,
      signedAmount: 500_000,
      balance: 1_300_000,
      direction: 'credit'
    },
    {
      sourceRowIndex: 8,
      operationDate: '03/06/2026',
      valueDate: '03/06/2026',
      descriptionSanitized: 'SYNTHETIC OUTFLOW TWO',
      debit: 300_000,
      signedAmount: -300_000,
      balance: 1_000_000,
      direction: 'debit'
    }
  ];
}

function makeValidation(
  overrides: Partial<StructuredBankStatementValidation> = {}
): StructuredBankStatementValidation {
  return {
    status: 'valid',
    openingBalanceFound: true,
    closingBalanceFound: true,
    declaredTotalsFound: true,
    declaredTotalsMatchLines: true,
    lineBalancesConsistent: true,
    computedClosingBalance: 1_000_000,
    closingBalanceDiscrepancy: 0,
    errors: [],
    warnings: [],
    ...overrides
  };
}

function makeDocument(
  overrides: Partial<StructuredBankStatementDocument> = {}
): StructuredBankStatementDocument {
  const validation = overrides.validation ?? makeValidation();
  const base: StructuredBankStatementDocument = {
    bankHint: 'ORA',
    detectedDelimiter: ';',
    sourceFileName: 'synthetic-ora.csv',
    currency: 'XOF',
    accountNumberMasked: '****0046',
    accountFingerprint: 'synthetic-doc-fingerprint',
    ibanMasked: '****0000',
    periodStart: '01/06/2026',
    periodEnd: '30/06/2026',
    statementDate: '30/06/2026',
    openingBalance: 1_000_000,
    declaredTotalDebits: 500_000,
    declaredTotalCredits: 500_000,
    declaredClosingBalance: 1_000_000,
    lines: makeLines(),
    validation,
    errors: [...validation.errors],
    warnings: [...validation.warnings]
  };
  return { ...base, ...overrides };
}

function needsReviewDocument(): StructuredBankStatementDocument {
  return makeDocument({
    declaredClosingBalance: 777_777,
    validation: makeValidation({
      status: 'needs_review',
      closingBalanceDiscrepancy: 222_223,
      warnings: ['Computed closing balance does not match the declared closing balance.']
    })
  });
}

function options(
  overrides: Partial<StructuredBankStatementCsvImportAdapterOptions> = {}
): StructuredBankStatementCsvImportAdapterOptions {
  return { bank: 'ORA', ...overrides };
}

function collectKeys(value: unknown, keys: Set<string> = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

const FORBIDDEN_KEYS = ['rawCsv', 'rawText', 'accountNumberRaw'];

function validOraLikeCsv(): string {
  return [
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
  ].join('\n');
}

// --------------------------------------------------------------------------
// PASS cases
// --------------------------------------------------------------------------

test('PASS 1: a valid ORA-like document produces success true with a statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options({ bank: 'ORA' })
  );

  assert.equal(result.success, true);
  assert.ok(result.statement);
  assert.equal(result.detectedFormat, 'structured_bank_statement_csv');
  assert.equal(result.bank, 'ORA');
  assert.equal(result.statement.status, 'valid');
  assert.equal(result.validation.isValid, true);
  assert.equal(result.validation.status, 'valid');
  assert.equal(result.rejectedReason, undefined);
});

test('PASS 2: bank comes from options.bank (BDK) for a BDK-like document', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ bankHint: 'BDK', sourceFileName: 'synthetic-bdk.csv' }),
    options({ bank: 'BDK' })
  );

  assert.equal(result.success, true);
  assert.ok(result.statement);
  assert.equal(result.bank, 'BDK');
  assert.equal(result.statement.bank, 'BDK');
});

test('PASS 3: balances, totals, dates and sourceFormat map correctly', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );

  assert.ok(result.statement);
  const statement = result.statement;
  assert.equal(statement.openingBalance, 1_000_000);
  assert.equal(statement.totalDebits, 500_000);
  assert.equal(statement.totalCredits, 500_000);
  assert.equal(statement.closingBalance, 1_000_000);
  assert.equal(statement.periodStartDate, '01/06/2026');
  assert.equal(statement.periodEndDate, '30/06/2026');
  assert.equal(statement.statementDate, '30/06/2026');
  assert.equal(statement.closingDate, '30/06/2026');
  assert.equal(statement.currency, 'XOF');
  assert.equal(statement.sourceFormat, 'structured_bank_statement_csv');
  assert.equal(statement.validation.calculatedClosing, 1_000_000);
  assert.equal(statement.validation.discrepancy, 0);
  assert.equal(statement.validation.totalDebitsFound, true);
  assert.equal(statement.validation.totalCreditsFound, true);
  assert.equal(statement.validation.closingBalanceFound, true);
  assert.equal(statement.validation.openingBalanceFound, true);
});

test('PASS 4: debit/credit/signedAmount/runningBalance lines map correctly', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );

  assert.ok(result.statement);
  const lines = result.statement.lines;
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => line.direction), ['debit', 'credit', 'debit']);
  assert.deepEqual(lines.map((line) => line.signedAmount), [-200_000, 500_000, -300_000]);
  assert.deepEqual(lines.map((line) => line.runningBalance), [800_000, 1_300_000, 1_000_000]);
  assert.deepEqual(lines.map((line) => line.debitAmount), [200_000, undefined, 300_000]);
  assert.deepEqual(lines.map((line) => line.creditAmount), [undefined, 500_000, undefined]);
  assert.deepEqual(lines.map((line) => line.sourceLineIndex), [6, 7, 8]);
  assert.equal(lines[0].transactionDate, '01/06/2026');
  assert.equal(lines[0].valueDate, '01/06/2026');
  assert.equal(lines[0].currency, 'XOF');
});

test('PASS 5: accountNumberMasked is preserved and no raw account is exposed', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );

  assert.ok(result.statement);
  assert.equal(result.statement.accountIdentity.accountNumberMasked, '****0046');

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('UNKNOWN_MASKED_ACCOUNT'), false);
  const keys = collectKeys(result);
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.equal(keys.has(forbidden), false, `result must not expose "${forbidden}"`);
  }
});

test('PASS 6: accountFingerprint comes from options first, then from the document, never fabricated', () => {
  const fromOptions = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options({ accountFingerprint: 'synthetic-option-fingerprint' })
  );
  assert.ok(fromOptions.statement);
  assert.equal(
    fromOptions.statement.accountIdentity.accountFingerprint,
    'synthetic-option-fingerprint'
  );

  const fromDocument = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );
  assert.ok(fromDocument.statement);
  assert.equal(
    fromDocument.statement.accountIdentity.accountFingerprint,
    'synthetic-doc-fingerprint'
  );

  const absent = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ accountFingerprint: undefined }),
    options()
  );
  assert.ok(absent.statement);
  assert.equal(absent.statement.accountIdentity.accountFingerprint, undefined);
});

test('PASS 7: importId and rawTextHash are forwarded only when provided', () => {
  const withIds = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options({ importId: 'synthetic-import-id', rawTextHash: 'synthetic-raw-text-hash' })
  );
  assert.ok(withIds.statement);
  assert.equal(withIds.statement.importId, 'synthetic-import-id');
  assert.equal(withIds.statement.rawTextHash, 'synthetic-raw-text-hash');

  const withoutIds = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );
  assert.ok(withoutIds.statement);
  assert.equal(withoutIds.statement.importId, undefined);
  assert.equal(withoutIds.statement.rawTextHash, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(withoutIds.statement, 'importId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(withoutIds.statement, 'rawTextHash'), false);
});

test('PASS 8: sourceFormat defaults to structured_bank_statement_csv and can be overridden', () => {
  const defaulted = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );
  assert.ok(defaulted.statement);
  assert.equal(defaulted.statement.sourceFormat, 'structured_bank_statement_csv');

  const overridden = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options({ sourceFormat: 'synthetic_structured_csv' })
  );
  assert.ok(overridden.statement);
  assert.equal(overridden.statement.sourceFormat, 'synthetic_structured_csv');
});

test('PASS 9: descriptionSanitized is present on the mapped statement lines', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );
  assert.ok(result.statement);
  assert.equal(result.statement.lines[0].descriptionSanitized, 'SYNTHETIC OUTFLOW');
  assert.equal(result.statement.lines[1].descriptionSanitized, 'SYNTHETIC INFLOW');
  assert.equal(result.statement.lines[2].descriptionSanitized, 'SYNTHETIC OUTFLOW TWO');
});

test('PASS 10: no lineHash is generated in this lot', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );
  assert.ok(result.statement);
  for (const line of result.statement.lines) {
    assert.equal(line.lineHash, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(line, 'lineHash'), false);
  }
});

test('PASS 11 (integration): a document parsed from synthetic CSV adapts to a valid statement', () => {
  const document = parseStructuredBankStatementCsv(validOraLikeCsv(), {
    sourceFileName: '010726 ORA ONLINE.csv'
  });
  assert.equal(document.bankHint, 'ORA');

  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    document,
    options({ bank: 'ORA' })
  );

  assert.equal(result.success, true);
  assert.ok(result.statement);
  assert.equal(result.statement.openingBalance, 1_000_000);
  assert.equal(result.statement.closingBalance, 1_000_000);
  assert.equal(result.statement.totalDebits, 500_000);
  assert.equal(result.statement.totalCredits, 500_000);
  assert.equal(result.statement.lines.length, 3);
  assert.ok(result.statement.accountIdentity.accountNumberMasked);
  assert.match(result.statement.accountIdentity.accountNumberMasked, /^\*\*\*\*/);
  assert.equal(result.statement.accountIdentity.accountNumberMasked.includes('01401'), false);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('01401'), false);
  assert.equal(serialized.includes('SYNTHETIC OUTFLOW'), true); // sanitized description is expected
});

// --------------------------------------------------------------------------
// REJECT cases
// --------------------------------------------------------------------------

test('REJECT 1: an options.bank that contradicts a concrete BDK hint is rejected', () => {
  // options.bank is a required, typed ('BDK' | 'ORA') option: omission is a
  // compile-time error. A bank that does not match a concrete document hint is
  // rejected at runtime as an incoherent request.
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ bankHint: 'BDK' }),
    options({ bank: 'ORA' })
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /contradicts the requested bank/i);
});

test('REJECT 2: a concrete ORA hint contradicting options.bank BDK is rejected', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ bankHint: 'ORA' }),
    options({ bank: 'BDK' })
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.rejectedReason ?? '', /contradicts the requested bank/i);
});

test('REJECT 3: a missing currency yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ currency: undefined }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /currency/i);
});

test('REJECT 4: a missing accountNumberMasked yields no statement and never a placeholder', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ accountNumberMasked: undefined }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /accountNumberMasked/i);
  assert.equal(JSON.stringify(result).includes('UNKNOWN_MASKED_ACCOUNT'), false);
});

test('REJECT 5: a missing openingBalance yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ openingBalance: undefined }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /openingBalance/i);
});

test('REJECT 6: a missing declaredTotalDebits yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ declaredTotalDebits: undefined }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /declaredTotalDebits/i);
});

test('REJECT 7: a missing declaredTotalCredits yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ declaredTotalCredits: undefined }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /declaredTotalCredits/i);
});

test('REJECT 8: a missing declaredClosingBalance yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ declaredClosingBalance: undefined }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /declaredClosingBalance/i);
});

test('REJECT 9: needs_review without opt-in yields success false and no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    needsReviewDocument(),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.equal(result.validation.status, 'needs_review');
  assert.match(result.rejectedReason ?? '', /needs_review/i);
});

test('REJECT 10: needs_review with opt-in yields success false but a review statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    needsReviewDocument(),
    options({ includeNeedsReviewStatement: true })
  );

  assert.equal(result.success, false);
  assert.ok(result.statement);
  assert.equal(result.statement.status, 'needs_review');
  assert.equal(result.statement.validation.status, 'needs_review');
  assert.equal(result.statement.validation.isValid, false);
  assert.equal(result.statement.validation.discrepancy, 222_223);
  // The declared closing balance is preserved, never replaced by the computed one.
  assert.equal(result.statement.closingBalance, 777_777);
});

test('REJECT 11: an invalid document yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({
      validation: makeValidation({
        status: 'invalid',
        errors: ['Row 6 has both a debit and a credit amount.']
      })
    }),
    options({ includeNeedsReviewStatement: true })
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /invalid/i);
});

test('REJECT 12: an unsupported document yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({
      lines: [],
      validation: makeValidation({
        status: 'unsupported',
        errors: ['No recognizable transaction header row found in CSV.']
      })
    }),
    options({ includeNeedsReviewStatement: true })
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /unsupported/i);
});

test('REJECT 13: a line with an unknown direction yields no statement (defence in depth)', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({
      lines: [
        {
          sourceRowIndex: 6,
          operationDate: '01/06/2026',
          valueDate: '01/06/2026',
          descriptionSanitized: 'SYNTHETIC AMBIGUOUS',
          signedAmount: 0,
          balance: 1_000_000,
          direction: 'unknown',
          warnings: ['Row 6 has both a debit and a credit amount.']
        }
      ],
      // Forced valid status to prove the unknown-direction guard is independent.
      validation: makeValidation()
    }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /unknown direction/i);
});

test('REJECT 14: a valid status with a non-zero closing discrepancy is refused', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({
      validation: makeValidation({
        status: 'valid',
        closingBalanceDiscrepancy: 5_000
      })
    }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /do not reconcile/i);
});

test('REJECT 15: no rawCsv / rawText / accountNumberRaw keys ever appear in the result', () => {
  const accepted = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options()
  );
  const rejected = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ currency: undefined }),
    options()
  );

  for (const result of [accepted, rejected]) {
    const keys = collectKeys(result);
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.equal(keys.has(forbidden), false, `result must not expose "${forbidden}"`);
    }
  }
});

test('REJECT 16: a valid status with no transaction lines yields no statement', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ lines: [], validation: makeValidation() }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /no transaction lines/i);
});

test('REJECT 17: a valid status with an undefined computedClosingBalance is not reconciled', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ validation: makeValidation({ computedClosingBalance: undefined }) }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /do not reconcile/i);
});

test('REJECT 18: a valid status with an undefined declaredTotalsMatchLines is not reconciled', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ validation: makeValidation({ declaredTotalsMatchLines: undefined }) }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /do not reconcile/i);
});

test('REJECT 19: a valid status with an undefined lineBalancesConsistent is not reconciled', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument({ validation: makeValidation({ lineBalancesConsistent: undefined }) }),
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.match(result.errors.join(' '), /do not reconcile/i);
});

// ---------------------------------------------------------------------------
// DAILY-INGESTION-0C — garde BRIDGE / UNKNOWN sur le chemin d'adaptation
// ---------------------------------------------------------------------------

test('0C guard unit: BRIDGE file names are rejected with the controlled message', () => {
  assert.equal(
    findStructuredBankStatementIngestionGuardRejection({
      sourceFileName: '010726 BRIDGE ONLINE CSV.csv',
      bankHint: 'UNKNOWN'
    }),
    BRIDGE_CSV_INGESTION_REJECTION_MESSAGE
  );
  // BRIDGE wins even over a concrete hint: a bridge-named file is never eligible.
  assert.equal(
    findStructuredBankStatementIngestionGuardRejection({
      sourceFileName: 'BRIDGE_EXPORT_ORA.csv',
      bankHint: 'ORA'
    }),
    BRIDGE_CSV_INGESTION_REJECTION_MESSAGE
  );
});

test('0C guard unit: UNKNOWN bank hint is rejected, trusted BDK/ORA pass', () => {
  assert.equal(
    findStructuredBankStatementIngestionGuardRejection({
      sourceFileName: 'releve-mysterieux.csv',
      bankHint: 'UNKNOWN'
    }),
    UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE
  );
  assert.equal(
    findStructuredBankStatementIngestionGuardRejection({
      sourceFileName: undefined,
      bankHint: 'UNKNOWN'
    }),
    UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE
  );
  assert.equal(
    findStructuredBankStatementIngestionGuardRejection({
      sourceFileName: 'releve ora synthetique.csv',
      bankHint: 'ORA'
    }),
    undefined
  );
  assert.equal(
    findStructuredBankStatementIngestionGuardRejection({
      sourceFileName: 'releve-bdk-synthetique.csv',
      bankHint: 'BDK'
    }),
    undefined
  );
});

test('0C adapt: UNKNOWN bank hint is a hard rejection, never a warning-only pass', () => {
  const document = makeDocument({ bankHint: 'UNKNOWN', sourceFileName: 'releve-mysterieux.csv' });
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    document,
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.equal(result.rejectedReason, UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE);
  assert.ok(result.errors.includes(UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE));
});

test('0C adapt: a BRIDGE-named document never yields a statement, even when otherwise valid', () => {
  const document = makeDocument({
    bankHint: 'UNKNOWN',
    sourceFileName: '010726 BRIDGE ONLINE CSV.csv'
  });
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    document,
    options()
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.equal(result.rejectedReason, BRIDGE_CSV_INGESTION_REJECTION_MESSAGE);
});

test('0C adapt: options.sourceFileName takes precedence for the BRIDGE guard', () => {
  const result = adaptStructuredBankStatementDocumentToBankAccountStatementImportResult(
    makeDocument(),
    options({ sourceFileName: 'BRIDGE_EXPORT.csv' })
  );

  assert.equal(result.success, false);
  assert.equal(result.statement, undefined);
  assert.equal(result.rejectedReason, BRIDGE_CSV_INGESTION_REJECTION_MESSAGE);
});
