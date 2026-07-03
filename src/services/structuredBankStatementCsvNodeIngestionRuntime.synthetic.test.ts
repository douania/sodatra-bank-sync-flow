import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareStructuredBankStatementCsvNodeIngestionRuntime,
  type StructuredBankStatementCsvNodeIngestionRuntimeInput
} from './structuredBankStatementCsvNodeIngestionRuntime';

// All fixtures below are fully synthetic. No real bank statement data, no real
// account number, no real bank client and no SODATRA data is ever used.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

const SYNTHETIC_RAW_ACCOUNT_DIGITS = '01234567890';
const SYNTHETIC_FINGERPRINT = 'synthetic-fingerprint-0m';

// Valid, fully reconciled synthetic CSV (same shape as the 0I fixtures).
function validCsvLines(): string[] {
  return [
    'Releve de compte synthetique;;;;;',
    `Numero de compte;SN08 SN000 ${SYNTHETIC_RAW_ACCOUNT_DIGITS}-46 XOF;;;;`,
    'Periode;01/06/2026;30/06/2026;;;',
    'Solde initial au 31/05/2026 : 1000000;;;;;',
    'Date;Valeur;Libelle;Debit;Credit;Solde',
    '02/06/2026;02/06/2026;PRELEVEMENT ABONNEMENT SYNTHETIQUE;100000;;900000',
    '10/06/2026;10/06/2026;VIREMENT RECU CLIENT SYNTHETIQUE;;300000;1200000',
    ';;Total;100000;300000;',
    'Solde au 30/06/2026 : 1200000;;;;;'
  ];
}

function validCsv(): string {
  return validCsvLines().join('\n');
}

// Declared closing balance off by one: reconciliation anomaly -> needs_review.
function needsReviewCsv(): string {
  const lines = validCsvLines();
  lines[lines.length - 1] = 'Solde au 30/06/2026 : 1200001;;;;;';
  return lines.join('\n');
}

// A row carrying both a debit and a credit -> parser forces invalid.
function invalidCsv(): string {
  const lines = validCsvLines();
  lines.splice(6, 0, '05/06/2026;05/06/2026;LIGNE AMBIGUE SYNTHETIQUE;50000;60000;850000');
  return lines.join('\n');
}

// No recognizable transaction header row -> parser reports unsupported.
function unsupportedCsv(): string {
  return ['bonjour;monde', 'texte;synthetique;sans;entete', 'rien;a;voir'].join('\n');
}

// Minimal Windows-1252 encoder for the synthetic fixtures: ASCII and Latin-1
// characters map to their code point; characters living in the 0x80-0x9F
// Windows-1252 slots are mapped explicitly.
const WINDOWS_1252_OVERRIDES = new Map<string, number>([
  ['€', 0x80], // €
  ['Œ', 0x8c], // Œ
  ['œ', 0x9c] // œ
]);

function encodeWindows1252(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const override = WINDOWS_1252_OVERRIDES.get(char);
    const code = override ?? text.charCodeAt(index);
    if (override === undefined && code > 0xff) {
      throw new Error(`Test encoder cannot map character "${char}" to Windows-1252.`);
    }
    bytes[index] = code;
  }
  return bytes;
}

function baseInput(
  overrides: Partial<StructuredBankStatementCsvNodeIngestionRuntimeInput> = {}
): StructuredBankStatementCsvNodeIngestionRuntimeInput {
  return {
    sourceFileName: 'releve-synthetique.csv',
    bytes: encodeWindows1252(validCsv()),
    bank: 'BDK',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    ...overrides
  };
}

test('non-CSV input is rejected fail-closed before any decoding', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ sourceFileName: 'releve-synthetique.pdf' })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.lineHashesApplied, false);
  assert.equal(result.rawContentHidden, true);
  assert.equal(result.sourceFileName, 'releve-synthetique.pdf');
  assert.ok(result.rejectedReason !== undefined && result.rejectedReason.length > 0);
  assert.ok(result.errors.length > 0);
  // The pre-ingestion layer ALWAYS computes rawTextHash and an importResult:
  // their absence proves the rejection happened before decoding/pre-ingestion.
  assert.equal(result.rawTextHash, undefined);
  assert.equal(result.importResult, undefined);
});

test('.CSV extension is accepted case-insensitively', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ sourceFileName: 'RELEVE-SYNTHETIQUE.CSV' })
  );

  assert.equal(result.success, true);
  assert.match(result.rawTextHash as string, HEX_SHA256);
});

test('valid synthetic CSV with fingerprint reaches ingestionReady with full idempotency keys', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(baseInput());

  assert.equal(result.success, true);
  assert.equal(result.ingestionReady, true);
  assert.equal(result.lineHashesApplied, true);
  assert.equal(result.rawContentHidden, true);
  assert.match(result.rawTextHash as string, HEX_SHA256);
  assert.match(result.importId as string, HEX_SHA256);
  assert.equal(result.rejectedReason, undefined);

  const statement = result.importResult?.statement;
  assert.ok(statement !== undefined);
  assert.equal(statement.bank, 'BDK');
  assert.equal(statement.importId, result.importId);
  assert.equal(statement.rawTextHash, result.rawTextHash);
  assert.equal(statement.lines.length, 2);
  for (const line of statement.lines) {
    assert.match(line.lineHash as string, HEX_SHA256);
  }
});

test('ArrayBuffer and Uint8Array inputs produce identical deterministic results', () => {
  const bytes = encodeWindows1252(validCsv());
  const arrayBuffer = bytes.slice().buffer;

  const fromView = prepareStructuredBankStatementCsvNodeIngestionRuntime(baseInput({ bytes }));
  const fromBuffer = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ bytes: arrayBuffer })
  );

  assert.equal(fromBuffer.success, true);
  assert.equal(fromBuffer.rawTextHash, fromView.rawTextHash);
  assert.equal(fromBuffer.importId, fromView.importId);
});

test('valid CSV without accountFingerprint: traceable but never ingestionReady', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ accountFingerprint: undefined })
  );

  assert.equal(result.success, true);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.lineHashesApplied, false);
  assert.match(result.rawTextHash as string, HEX_SHA256);
  assert.equal(result.importId, undefined);
  assert.ok(result.warnings.some((warning) => warning.includes('accountFingerprint')));
  // ingestionReady=false must always come with a controlled rejectedReason.
  assert.ok(result.rejectedReason !== undefined && result.rejectedReason.length > 0);
});

test('needs_review document is never successful nor ingestionReady', () => {
  const withoutOptIn = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ bytes: encodeWindows1252(needsReviewCsv()) })
  );

  assert.equal(withoutOptIn.success, false);
  assert.equal(withoutOptIn.ingestionReady, false);
  assert.equal(withoutOptIn.lineHashesApplied, false);
  assert.equal(withoutOptIn.importResult?.statement, undefined);
  assert.ok(withoutOptIn.rejectedReason !== undefined && withoutOptIn.rejectedReason.length > 0);

  const withOptIn = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({
      bytes: encodeWindows1252(needsReviewCsv()),
      includeNeedsReviewStatement: true
    })
  );

  // The opted-in review statement is enriched (importId + lineHashes) but the
  // fail-closed gates stay shut.
  assert.equal(withOptIn.success, false);
  assert.equal(withOptIn.ingestionReady, false);
  assert.equal(withOptIn.lineHashesApplied, true);
  assert.match(withOptIn.importId as string, HEX_SHA256);
  assert.ok(withOptIn.importResult?.statement !== undefined);
  assert.ok(withOptIn.rejectedReason !== undefined && withOptIn.rejectedReason.length > 0);
});

test('invalid document is rejected with an explicit reason', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ bytes: encodeWindows1252(invalidCsv()) })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.lineHashesApplied, false);
  assert.equal(result.importId, undefined);
  assert.equal(result.importResult?.statement, undefined);
  assert.ok(result.rejectedReason !== undefined && result.rejectedReason.length > 0);
  // rawTextHash is still computed for traceability of the rejected text.
  assert.match(result.rawTextHash as string, HEX_SHA256);
});

test('unsupported document is rejected with an explicit reason', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ bytes: encodeWindows1252(unsupportedCsv()) })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.importResult?.statement, undefined);
  assert.ok(result.rejectedReason !== undefined && result.rejectedReason.length > 0);
  assert.match(result.rawTextHash as string, HEX_SHA256);
});

test('result never leaks the decoded text, raw metadata rows or raw account digits', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(baseInput());
  const serialized = JSON.stringify(result);

  // No raw-content field of any kind.
  assert.ok(!serialized.includes('"decodedText"'));
  assert.ok(!serialized.includes('"rawCsv"'));
  assert.ok(!serialized.includes('"rawContent"'));
  // Non-transaction raw rows never flow through (only sanitized/masked
  // transaction fields legitimately live inside importResult).
  assert.ok(!serialized.includes('Releve de compte synthetique'));
  assert.ok(!serialized.includes('Numero de compte'));
  assert.ok(!serialized.includes(SYNTHETIC_RAW_ACCOUNT_DIGITS));
});

test('sourceFormat defaults to structured_bank_statement_csv end to end', () => {
  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(baseInput());

  assert.equal(result.sourceFormat, 'structured_bank_statement_csv');
  assert.equal(result.importResult?.statement?.sourceFormat, 'structured_bank_statement_csv');
});

test('custom sourceFormat is normalized, propagated without divergence and feeds the importId', () => {
  const custom = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ sourceFormat: '  synthetic_custom_export_v2  ' })
  );
  const defaulted = prepareStructuredBankStatementCsvNodeIngestionRuntime(baseInput());

  assert.equal(custom.success, true);
  assert.equal(custom.ingestionReady, true);
  assert.equal(custom.sourceFormat, 'synthetic_custom_export_v2');
  // The statement carries the exact same normalized value: no divergence
  // between the echoed format, the statement and the hashed identity.
  assert.equal(custom.importResult?.statement?.sourceFormat, 'synthetic_custom_export_v2');
  assert.match(custom.importId as string, HEX_SHA256);
  assert.notEqual(custom.importId, defaulted.importId);

  // Determinism: same input, same identity.
  const again = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ sourceFormat: 'synthetic_custom_export_v2' })
  );
  assert.equal(again.importId, custom.importId);
});

test('Windows-1252 specific characters survive the boundary decoding', () => {
  const lines = validCsvLines();
  // 'Œ' (0x8C) and 'é' (0xE9): 0x8C decodes to 'Œ' only under Windows-1252
  // semantics (it is a control character in ISO-8859-1).
  lines[5] = '02/06/2026;02/06/2026;PRELEVEMENT ŒUVRE SYNTHÉTIQUE dédiée;100000;;900000';

  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ bytes: encodeWindows1252(lines.join('\n')) })
  );

  assert.equal(result.success, true);
  assert.equal(result.ingestionReady, true);

  const description = result.importResult?.statement?.lines[0]?.descriptionSanitized;
  assert.ok(description !== undefined);
  assert.ok(description.includes('ŒUVRE'));
  assert.ok(description.includes('dédiée'));
});

test('an unexpected low-level failure is converted into a controlled rejection', () => {
  const bytes = encodeWindows1252(validCsv());
  const buffer = bytes.slice().buffer;
  // Detach the ArrayBuffer: reading it inside the boundary then throws, which
  // exercises the controlled catch path without any mock.
  structuredClone(buffer, { transfer: [buffer] });

  const result = prepareStructuredBankStatementCsvNodeIngestionRuntime(
    baseInput({ bytes: buffer })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.lineHashesApplied, false);
  assert.equal(result.rawContentHidden, true);
  assert.equal(result.rawTextHash, undefined);
  assert.equal(result.importResult, undefined);
  assert.ok(result.rejectedReason?.includes('unexpectedly'));
  // No-leak lock: the errors array must carry EXACTLY the fixed controlled
  // reason — nothing derived from the thrown error may ever be appended.
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0], result.rejectedReason);
});
