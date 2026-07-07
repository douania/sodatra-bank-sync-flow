import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  BankAccountStatement,
  BankAccountStatementLine
} from '@/types/bankAccountStatement';
import {
  buildPreIngestStructuredBankStatementRpcPayload,
  findForbiddenStructuredBankStatementPayloadKeys,
  PRE_INGEST_STRUCTURED_BANK_STATEMENT_RPC_NAME,
  STRUCTURED_BANK_STATEMENT_RPC_NAMES,
  STRUCTURED_BANK_STATEMENT_RPC_STATEMENT_ALLOWED_KEYS,
  STRUCTURED_BANK_STATEMENT_RPC_LINE_ALLOWED_KEYS,
  STRUCTURED_BANK_STATEMENT_FORBIDDEN_PAYLOAD_KEYS,
  type PreIngestStructuredBankStatementStagedInput,
  type PreIngestStructuredBankStatementAttemptOnlyInput
} from './structuredBankStatementCsvRpcPayload';
import {
  buildStructuredBankStatementRawTextHash,
  buildStructuredBankStatementImportId,
  buildStructuredBankStatementLineHash
} from './structuredBankStatementCsvBrowserIdempotencyKeys';

// All fixtures below are fully synthetic. No real bank statement data, no real
// account number, no real bank client and no SODATRA data is ever used.

const SYNTHETIC_HASH_A = 'a'.repeat(64);
const SYNTHETIC_HASH_B = 'b'.repeat(64);
const SYNTHETIC_HASH_C = 'c'.repeat(64);

const EXPECTED_PARAM_KEYS = [
  'p_requested_status',
  'p_source_format',
  'p_bank',
  'p_source_file_name_redacted',
  'p_account_fingerprint',
  'p_account_number_masked',
  'p_raw_text_hash',
  'p_import_id',
  'p_parser_validation_status',
  'p_rejected_reason',
  'p_errors_count',
  'p_warnings_count',
  'p_runtime_version',
  'p_parser_version',
  'p_statement',
  'p_lines'
];

function syntheticLine(overrides: Partial<BankAccountStatementLine> = {}): BankAccountStatementLine {
  return {
    sourceLineIndex: 5,
    transactionDate: '01/06/2026',
    valueDate: '01/06/2026',
    descriptionSanitized: 'SYNTHETIC OUTFLOW',
    debitAmount: 200_000,
    signedAmount: -200_000,
    runningBalance: 800_000,
    direction: 'debit',
    currency: 'XOF',
    lineHash: SYNTHETIC_HASH_B,
    ...overrides
  };
}

function syntheticStatement(overrides: Partial<BankAccountStatement> = {}): BankAccountStatement {
  return {
    bank: 'ORA',
    currency: 'XOF',
    periodStartDate: '01/06/2026',
    periodEndDate: '30/06/2026',
    statementDate: '30/06/2026',
    accountIdentity: {
      accountNumberMasked: '****0001',
      accountFingerprint: 'SYNTHETIC-FINGERPRINT-0001'
    },
    openingBalance: 1_000_000,
    totalDebits: 200_000,
    totalCredits: 500_000,
    closingBalance: 1_300_000,
    lines: [
      syntheticLine(),
      syntheticLine({
        sourceLineIndex: 6,
        descriptionSanitized: 'SYNTHETIC INFLOW',
        debitAmount: undefined,
        creditAmount: 500_000,
        signedAmount: 500_000,
        runningBalance: 1_300_000,
        direction: 'credit',
        transactionDate: '02/06/2026',
        valueDate: '02/06/2026',
        lineHash: SYNTHETIC_HASH_C
      })
    ],
    validation: {
      calculatedClosing: 1_300_000,
      discrepancy: 0,
      isValid: true,
      status: 'valid',
      openingBalanceFound: true,
      totalDebitsFound: true,
      totalCreditsFound: true,
      closingBalanceFound: true,
      errors: [],
      warnings: []
    },
    sourceFormat: 'structured_bank_statement_csv',
    status: 'valid',
    errors: [],
    warnings: [],
    ...overrides
  };
}

function stagedInput(
  overrides: Partial<PreIngestStructuredBankStatementStagedInput> = {}
): PreIngestStructuredBankStatementStagedInput {
  return {
    requestedStatus: 'ingestion_ready',
    parserValidationStatus: 'valid',
    sourceFormat: 'structured_bank_statement_csv',
    bank: 'ORA',
    accountFingerprint: 'SYNTHETIC-FINGERPRINT-0001',
    rawTextHash: SYNTHETIC_HASH_A,
    importId: SYNTHETIC_HASH_B,
    accountNumberMasked: '****0001',
    sourceFileNameRedacted: 'synthetic-export-ora.csv',
    statement: syntheticStatement(),
    ...overrides
  };
}

function attemptOnlyInput(
  overrides: Partial<PreIngestStructuredBankStatementAttemptOnlyInput> = {}
): PreIngestStructuredBankStatementAttemptOnlyInput {
  return {
    requestedStatus: 'rejected',
    sourceFormat: 'structured_bank_statement_csv',
    bank: 'BDK',
    rejectedReason: 'synthetic controlled rejection (never CSV content)',
    parserValidationStatus: 'invalid',
    errorsCount: 2,
    warningsCount: 1,
    ...overrides
  };
}

function expectFailure(
  result: ReturnType<typeof buildPreIngestStructuredBankStatementRpcPayload>,
  pattern: RegExp
): void {
  assert.equal(result.success, false);
  if (result.success === false) {
    assert.equal(
      result.errors.some((error) => pattern.test(error)),
      true,
      `expected an error matching ${pattern}, got: ${JSON.stringify(result.errors)}`
    );
  }
}

// --------------------------------------------------------------------------
// Staged deposits (ingestion_ready / needs_review)
// --------------------------------------------------------------------------

test('staged: a valid ingestion_ready payload is built with the exact 16 RPC parameters', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(stagedInput());
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.rpcName, PRE_INGEST_STRUCTURED_BANK_STATEMENT_RPC_NAME);
    assert.deepEqual(Object.keys(result.payload), EXPECTED_PARAM_KEYS);
    assert.equal(result.payload.p_requested_status, 'ingestion_ready');
    assert.equal(result.payload.p_parser_validation_status, 'valid');
    assert.equal(result.payload.p_rejected_reason, null);
    assert.equal(result.payload.p_account_fingerprint, 'SYNTHETIC-FINGERPRINT-0001');
    assert.equal(result.payload.p_raw_text_hash, SYNTHETIC_HASH_A);
    assert.equal(result.payload.p_import_id, SYNTHETIC_HASH_B);
    assert.notEqual(result.payload.p_statement, null);
    assert.notEqual(result.payload.p_lines, null);
  }
});

test('staged: statement and line jsonb keys are exactly the RPC whitelists', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(stagedInput());
  assert.equal(result.success, true);
  if (result.success) {
    const statementKeys = Object.keys(result.payload.p_statement as object).sort();
    assert.deepEqual(statementKeys, [...STRUCTURED_BANK_STATEMENT_RPC_STATEMENT_ALLOWED_KEYS].sort());
    for (const line of result.payload.p_lines ?? []) {
      assert.deepEqual(Object.keys(line).sort(), [...STRUCTURED_BANK_STATEMENT_RPC_LINE_ALLOWED_KEYS].sort());
    }
  }
});

test('staged: declared line_count always equals the mapped lines array length', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(stagedInput());
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.payload.p_statement?.line_count, result.payload.p_lines?.length);
    assert.equal(result.payload.p_lines?.length, 2);
  }
});

test('staged: the mapped payload never contains a forbidden key and no raw CSV content', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(stagedInput());
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(findForbiddenStructuredBankStatementPayloadKeys(result.payload), []);
    const json = JSON.stringify(result.payload);
    assert.equal(json.includes('raw_csv'), false);
    assert.equal(json.includes('file_content'), false);
    assert.equal(json.includes('EXTRAIT DE COMPTE'), false);
  }
});

test('staged: a needs_review deposit builds but stays a non-automatic staging request', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(
    stagedInput({
      requestedStatus: 'needs_review',
      parserValidationStatus: 'needs_review',
      statement: syntheticStatement({
        status: 'needs_review',
        validation: { ...syntheticStatement().validation, status: 'needs_review', isValid: false }
      })
    })
  );
  assert.equal(result.success, true);
  if (result.success) {
    // The RPC stores this as a quarantined staging row; promotion of a
    // needs_review deposit requires the dedicated human-admin approve RPC.
    assert.equal(result.payload.p_requested_status, 'needs_review');
    assert.equal(result.payload.p_parser_validation_status, 'needs_review');
  }
});

test('staged: requestedStatus/parserValidationStatus gate mismatches are refused (RPC mirror)', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({ parserValidationStatus: 'needs_review' as 'valid' })
    ),
    /ingestion_ready requires parserValidationStatus "valid"/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({ requestedStatus: 'needs_review' })
    ),
    /needs_review requires parserValidationStatus "needs_review"/
  );
});

test('staged: parser status must match the statement own validation status', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({
          validation: { ...syntheticStatement().validation, status: 'needs_review' }
        })
      })
    ),
    /does not match the statement's own/
  );
});

test('staged: invalid/unsupported parser statuses can never produce a staged payload', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        parserValidationStatus: 'invalid' as unknown as 'valid',
        statement: syntheticStatement({
          validation: { ...syntheticStatement().validation, status: 'invalid', isValid: false }
        })
      })
    ),
    /ingestion_ready requires parserValidationStatus "valid"/
  );
});

test('staged: missing accountFingerprint fails closed, never falling back on the masked number', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(stagedInput({ accountFingerprint: '  ' })),
    /accountFingerprint is mandatory/
  );
});

test('staged: missing or malformed rawTextHash / importId fail closed', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(stagedInput({ rawTextHash: undefined as unknown as string })),
    /rawTextHash is required/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(stagedInput({ rawTextHash: 'not-a-hash' })),
    /rawTextHash is required and must be a 64-char/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(stagedInput({ importId: '' })),
    /importId is required/
  );
});

test('staged: a line without lineHash (or with a malformed one) fails closed', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({
          lines: [syntheticLine({ lineHash: undefined })]
        })
      })
    ),
    /lineHash is required and must be a 64-char/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({
          lines: [syntheticLine({ lineHash: 'DEADBEEF' })]
        })
      })
    ),
    /lineHash is required and must be a 64-char/
  );
});

test('staged: an unmappable line direction is refused', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ direction: 'unknown' })] })
      })
    ),
    /direction must be "debit" or "credit"/
  );
});

test('staged: strict DD/MM/YYYY dates are enforced, including the round-trip rule', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({ statement: syntheticStatement({ periodStartDate: '2026-06-01' }) })
    ),
    /periodStartDate is required and must be a real DD\/MM\/YYYY/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ transactionDate: '31/02/2026' })] })
      })
    ),
    /transactionDate is required and must be a real DD\/MM\/YYYY/
  );
});

test('staged: strict amounts are enforced (max 2 decimals, no float dust, max 16 digits)', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ signedAmount: -0.125 })] })
      })
    ),
    /signedAmount is required and must be a finite amount/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({ statement: syntheticStatement({ openingBalance: 10_000_000_000_000_000 }) })
    ),
    /openingBalance is required and must be a finite amount/
  );
});

test('staged: negative zero amounts are collapsed to canonical zero', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(
    stagedInput({
      statement: syntheticStatement({
        validation: { ...syntheticStatement().validation, discrepancy: -0 }
      })
    })
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(Object.is(result.payload.p_statement?.discrepancy, 0), true);
    assert.equal(Object.is(result.payload.p_statement?.discrepancy, -0), false);
  }
});

test('staged: a line without its own currency inherits the statement currency', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(
    stagedInput({
      statement: syntheticStatement({ lines: [syntheticLine({ currency: undefined })] })
    })
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.payload.p_lines?.[0].currency, 'XOF');
  }
});

test('staged: a debit line violating lines_staging_one_amount is refused', () => {
  // debitAmount missing
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ debitAmount: undefined })] })
      })
    ),
    /a debit line requires debitAmount/
  );
  // creditAmount smuggled on a debit line
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ creditAmount: 200_000 })] })
      })
    ),
    /a debit line must not carry creditAmount/
  );
  // wrong sign
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ signedAmount: 200_000 })] })
      })
    ),
    /a debit line requires signedAmount < 0/
  );
  // magnitude mismatch
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ signedAmount: -100_000 })] })
      })
    ),
    /abs\(signedAmount\) must equal debitAmount/
  );
  // zero amount refused
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({
          lines: [syntheticLine({ debitAmount: 0, signedAmount: 0 })]
        })
      })
    ),
    /a debit line requires signedAmount < 0 \(zero is refused\)/
  );
});

test('staged: a credit line violating lines_staging_one_amount is refused', () => {
  const creditLine = (overrides: Partial<BankAccountStatementLine> = {}) =>
    syntheticLine({
      direction: 'credit',
      debitAmount: undefined,
      creditAmount: 500_000,
      signedAmount: 500_000,
      ...overrides
    });
  // creditAmount missing
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [creditLine({ creditAmount: undefined })] })
      })
    ),
    /a credit line requires creditAmount/
  );
  // debitAmount smuggled on a credit line
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [creditLine({ debitAmount: 500_000 })] })
      })
    ),
    /a credit line must not carry debitAmount/
  );
  // wrong sign
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [creditLine({ signedAmount: -500_000 })] })
      })
    ),
    /a credit line requires signedAmount > 0/
  );
  // magnitude mismatch
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [creditLine({ signedAmount: 400_000 })] })
      })
    ),
    /signedAmount must equal creditAmount/
  );
  // zero amount refused
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({
          lines: [creditLine({ creditAmount: 0, signedAmount: 0 })]
        })
      })
    ),
    /a credit line requires signedAmount > 0 \(zero is refused\)/
  );
});

test('staged: two lines sharing one lineHash are refused (unique-per-statement mirror)', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({
          lines: [syntheticLine(), syntheticLine({ sourceLineIndex: 6 })]
        })
      })
    ),
    /lines\[1\]\.lineHash duplicates statement\.lines\[0\]\.lineHash/
  );
});

test('staged: periodEndDate earlier than periodStartDate is refused (staging CHECK mirror)', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ periodStartDate: '30/06/2026', periodEndDate: '01/06/2026' })
      })
    ),
    /periodEndDate must not be earlier than statement\.periodStartDate/
  );
  // The CHECK is >=: a single-day period stays accepted.
  const sameDay = buildPreIngestStructuredBankStatementRpcPayload(
    stagedInput({
      statement: syntheticStatement({
        periodStartDate: '01/06/2026',
        periodEndDate: '01/06/2026',
        lines: [syntheticLine()]
      })
    })
  );
  assert.equal(sameDay.success, true);
});

test('staged: a non-integer sourceLineIndex is refused', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: syntheticStatement({ lines: [syntheticLine({ sourceLineIndex: 1.5 })] })
      })
    ),
    /sourceLineIndex must be an integer/
  );
});

// --------------------------------------------------------------------------
// Attempt-only deposits (rejected / failed)
// --------------------------------------------------------------------------

test('attempt-only: a rejected deposit builds with null statement and lines', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(attemptOnlyInput());
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(Object.keys(result.payload), EXPECTED_PARAM_KEYS);
    assert.equal(result.payload.p_requested_status, 'rejected');
    assert.equal(result.payload.p_statement, null);
    assert.equal(result.payload.p_lines, null);
    assert.equal(result.payload.p_rejected_reason, 'synthetic controlled rejection (never CSV content)');
    assert.equal(result.payload.p_errors_count, 2);
    assert.equal(result.payload.p_warnings_count, 1);
  }
});

test('attempt-only: a failed deposit is accepted the same way', () => {
  const result = buildPreIngestStructuredBankStatementRpcPayload(
    attemptOnlyInput({ requestedStatus: 'failed', parserValidationStatus: undefined })
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.payload.p_requested_status, 'failed');
    assert.equal(result.payload.p_parser_validation_status, null);
  }
});

test('attempt-only: smuggling a statement or lines into a rejected deposit is refused (RPC mirror)', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload({
      ...attemptOnlyInput(),
      statement: syntheticStatement()
    } as unknown as PreIngestStructuredBankStatementAttemptOnlyInput),
    /must not carry a statement or lines/
  );
});

test('attempt-only: the rejected reason is mandatory and bounded to 200 chars (RPC mirror)', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(attemptOnlyInput({ rejectedReason: '   ' })),
    /rejectedReason is required/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(attemptOnlyInput({ rejectedReason: 'x'.repeat(201) })),
    /must not exceed 200 characters/
  );
});

test('staged: a rejectedReason on a staged deposit is refused (RPC mirror)', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload({
      ...stagedInput(),
      rejectedReason: 'should not be here'
    } as unknown as PreIngestStructuredBankStatementStagedInput),
    /must not carry a rejectedReason/
  );
});

// --------------------------------------------------------------------------
// Forbidden keys and redaction heuristics
// --------------------------------------------------------------------------

test('forbidden keys: snake_case and camelCase forms are refused wherever they hide', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: { ...syntheticStatement(), raw_csv: 'a;b;c' } as unknown as BankAccountStatement
      })
    ),
    /forbidden key in input at \$\.statement\.raw_csv/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({
        statement: {
          ...syntheticStatement(),
          lines: [{ ...syntheticLine(), iban: 'XX00SYNTHETIC000000' } as unknown as BankAccountStatementLine]
        }
      })
    ),
    /forbidden key in input at \$\.statement\.lines\[0\]\.iban/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload({
      ...attemptOnlyInput(),
      account_number: '00000000000'
    } as unknown as PreIngestStructuredBankStatementAttemptOnlyInput),
    /forbidden key in input at \$\.account_number/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload({
      ...attemptOnlyInput(),
      rawText: 'decoded csv text'
    } as unknown as PreIngestStructuredBankStatementAttemptOnlyInput),
    /forbidden key in input at \$\.rawText/
  );
});

test('forbidden keys: authorized cousins (raw_text_hash, account_number_masked) are NOT blocked', () => {
  assert.deepEqual(
    findForbiddenStructuredBankStatementPayloadKeys({
      raw_text_hash: SYNTHETIC_HASH_A,
      account_number_masked: '****0001',
      rawTextHash: SYNTHETIC_HASH_A,
      accountNumberMasked: '****0001'
    }),
    []
  );
  assert.deepEqual(
    findForbiddenStructuredBankStatementPayloadKeys({ raw_text: 'x' }),
    ['$.raw_text']
  );
});

test('forbidden keys: the exported blocklist matches the lot specification', () => {
  assert.deepEqual(
    [...STRUCTURED_BANK_STATEMENT_FORBIDDEN_PAYLOAD_KEYS],
    ['raw_csv', 'raw_text', 'raw_bytes', 'raw_content', 'file_content', 'account_number', 'iban']
  );
});

test('redaction: an unredacted-looking source file name is refused fail-closed', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({ sourceFileNameRedacted: 'releve_0123456789.csv' })
    ),
    /still looks sensitive/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({ sourceFileNameRedacted: 'C:\\exports\\x.csv' })
    ),
    /must not contain path separators/
  );
  const absent = buildPreIngestStructuredBankStatementRpcPayload(
    stagedInput({ sourceFileNameRedacted: undefined })
  );
  assert.equal(absent.success, true);
  if (absent.success) {
    assert.equal(absent.payload.p_source_file_name_redacted, null);
  }
});

test('masking: accountNumberMasked must match the strict migration pattern (asterisks + max 4 digits)', () => {
  const refused = [
    'SYNT***0001', // letters before the mask
    '1234', // digits only, no mask
    '***12345', // 5 digits
    '12***34', // digits before the mask
    '12345678901', // full-account-like
    'XX12ABCDEFGHIJK00' // IBAN-like
  ];
  for (const value of refused) {
    expectFailure(
      buildPreIngestStructuredBankStatementRpcPayload(stagedInput({ accountNumberMasked: value })),
      /must match the strict masked pattern/
    );
  }

  const accepted = ['****0001', '***0001', '*1234', '****'];
  for (const value of accepted) {
    const result = buildPreIngestStructuredBankStatementRpcPayload(
      stagedInput({ accountNumberMasked: value })
    );
    assert.equal(result.success, true, `expected "${value}" to be accepted`);
    if (result.success) {
      assert.equal(result.payload.p_account_number_masked, value);
    }
  }

  const absent = buildPreIngestStructuredBankStatementRpcPayload(
    stagedInput({ accountNumberMasked: undefined })
  );
  assert.equal(absent.success, true);
  if (absent.success) {
    assert.equal(absent.payload.p_account_number_masked, null);
  }
});

test('counts: negative or non-integer error/warning counts are refused', () => {
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(attemptOnlyInput({ errorsCount: -1 })),
    /errorsCount must be an integer >= 0/
  );
  expectFailure(
    buildPreIngestStructuredBankStatementRpcPayload(attemptOnlyInput({ warningsCount: 1.5 })),
    /warningsCount must be an integer >= 0/
  );
});

// --------------------------------------------------------------------------
// End-to-end with the browser-safe idempotency helper (synthetic)
// --------------------------------------------------------------------------

test('end-to-end: hashes from the browser helper feed a valid staged payload', async () => {
  const rawTextHash = await buildStructuredBankStatementRawTextHash({
    decodedText: 'SYNTHETIC;CSV;TEXT\n01/06/2026;01/06/2026;SYNTHETIC OUTFLOW;200000;;800000'
  });
  const importId = await buildStructuredBankStatementImportId({
    sourceFormat: 'structured_bank_statement_csv',
    bank: 'ORA',
    accountFingerprint: 'SYNTHETIC-FINGERPRINT-0001',
    periodStart: '01/06/2026',
    periodEnd: '30/06/2026'
  });
  const lineHash = await buildStructuredBankStatementLineHash({
    importId,
    operationDate: '01/06/2026',
    valueDate: '01/06/2026',
    direction: 'debit',
    signedAmount: -200_000,
    currency: 'XOF',
    descriptionSanitized: 'SYNTHETIC OUTFLOW',
    occurrenceOrdinal: 1
  });

  const result = buildPreIngestStructuredBankStatementRpcPayload(
    stagedInput({
      rawTextHash,
      importId,
      statement: syntheticStatement({ lines: [syntheticLine({ lineHash })] })
    })
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.payload.p_raw_text_hash, rawTextHash);
    assert.equal(result.payload.p_import_id, importId);
    assert.equal(result.payload.p_lines?.[0].line_hash, lineHash);
  }
});

// --------------------------------------------------------------------------
// Contract registry and module purity
// --------------------------------------------------------------------------

test('registry: the 0U RPC name list matches the migration', () => {
  assert.deepEqual(
    [...STRUCTURED_BANK_STATEMENT_RPC_NAMES],
    [
      'pre_ingest_structured_bank_statement',
      'promote_structured_bank_statement_import',
      'approve_structured_bank_statement_needs_review_promotion',
      'reject_structured_bank_statement_import',
      'resolve_structured_bank_statement_conflict_keep_existing',
      'request_structured_bank_statement_manager_escalation',
      'supersede_structured_bank_statement_import'
    ]
  );
});

test('purity: the payload module never imports Supabase, never calls the RPC client, no Node-only import', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./structuredBankStatementCsvRpcPayload.ts', import.meta.url)),
    'utf8'
  );
  // Tokens are assembled at runtime so this test file itself never carries the
  // forbidden literals that repo-level greps look for.
  const rpcCallToken = ['.rpc', '('].join('');
  const supabaseImportToken = ['@/integrations/', 'supabase'].join('');
  const supabaseJsToken = ['@supabase/', 'supabase-js'].join('');
  const nodeImportToken = ["from 'node", ':'].join('');
  assert.equal(source.includes(rpcCallToken), false);
  assert.equal(source.includes(supabaseImportToken), false);
  assert.equal(source.includes(supabaseJsToken), false);
  assert.equal(source.includes(nodeImportToken), false);
});
