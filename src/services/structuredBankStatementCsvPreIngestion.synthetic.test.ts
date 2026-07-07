import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareStructuredBankStatementCsvIngestion,
  MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS,
  type StructuredBankStatementCsvPreIngestionInput
} from './structuredBankStatementCsvPreIngestion';
import {
  BRIDGE_CSV_INGESTION_REJECTION_MESSAGE,
  UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE
} from './structuredBankStatementCsvImportAdapter';

// All fixtures below are fully synthetic. No real bank statement data, no real
// account number, no real bank client and no SODATRA data is ever used.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

const SYNTHETIC_RAW_ACCOUNT_DIGITS = '01234567890';

// Valid, fully reconciled synthetic CSV. Lines 1 and 2 are strict logical
// duplicates (same dates, direction, amount and label); only their running
// balances differ, and running balances never feed a line identity.
function validCsvLines(): string[] {
  return [
    'Releve de compte synthetique;;;;;',
    `Numero de compte;SN08 SN000 ${SYNTHETIC_RAW_ACCOUNT_DIGITS}-46 XOF;;;;`,
    'Periode;01/06/2026;30/06/2026;;;',
    'Solde initial au 31/05/2026 : 1000000;;;;;',
    'Date;Valeur;Libelle;Debit;Credit;Solde',
    '02/06/2026;02/06/2026;PRELEVEMENT ABONNEMENT SYNTHETIQUE;100000;;900000',
    '02/06/2026;02/06/2026;PRELEVEMENT ABONNEMENT SYNTHETIQUE;100000;;800000',
    '10/06/2026;10/06/2026;VIREMENT RECU CLIENT SYNTHETIQUE;;300000;1100000',
    ';;Total;200000;300000;',
    'Solde au 30/06/2026 : 1100000;;;;;'
  ];
}

function validCsv(): string {
  return validCsvLines().join('\n');
}

// Same logical statement with physical noise: blank rows and a footnote row
// inserted between transactions. Every sourceRowIndex shifts.
function noisyValidCsv(): string {
  const lines = validCsvLines();
  lines.splice(8, 0, ';;;;;', '(1) note synthetique sans date;;;;;');
  lines.splice(6, 0, ';;;;;');
  return lines.join('\n');
}

// Declared closing balance off by one: reconciliation anomaly -> needs_review,
// while every adapter-mandatory field stays present.
function needsReviewCsv(): string {
  const lines = validCsvLines();
  lines[lines.length - 1] = 'Solde au 30/06/2026 : 1100001;;;;;';
  return lines.join('\n');
}

// A row carrying both a debit and a credit -> parser forces invalid.
function invalidCsv(): string {
  const lines = validCsvLines();
  lines.splice(7, 0, '05/06/2026;05/06/2026;LIGNE AMBIGUE SYNTHETIQUE;50000;60000;850000');
  return lines.join('\n');
}

// No recognizable transaction header -> unsupported.
function unsupportedCsv(): string {
  return ['fruits;quantite', 'pomme;3', 'poire;5'].join('\n');
}

function baseInput(
  overrides: Partial<StructuredBankStatementCsvPreIngestionInput> = {}
): StructuredBankStatementCsvPreIngestionInput {
  return {
    decodedText: validCsv(),
    bank: 'ORA',
    sourceFileName: 'releve ora synthetique juin.csv',
    accountFingerprint: 'SYNTHETIC-FINGERPRINT-0001',
    ...overrides
  };
}

function statementLineHashes(result: ReturnType<typeof prepareStructuredBankStatementCsvIngestion>): (string | undefined)[] {
  assert.ok(result.importResult.statement, 'expected a statement');
  return result.importResult.statement.lines.map((line) => line.lineHash);
}

function collectKeysDeep(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeysDeep(item, keys));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeysDeep(nested, keys);
    }
  }
  return keys;
}

// --------------------------------------------------------------------------
// Valid path
// --------------------------------------------------------------------------

test('PASS 1: a valid synthetic CSV yields success, ingestionReady and all keys', () => {
  const result = prepareStructuredBankStatementCsvIngestion(baseInput());

  assert.equal(result.success, true);
  assert.equal(result.ingestionReady, true);
  assert.equal(result.lineHashesApplied, true);
  assert.match(result.rawTextHash, HEX_SHA256);
  assert.ok(result.importId !== undefined);
  assert.match(result.importId as string, HEX_SHA256);
  assert.equal(result.errors.length, 0);

  const statement = result.importResult.statement;
  assert.ok(statement);
  assert.equal(result.importResult.success, true);
  assert.equal(statement.importId, result.importId);
  assert.equal(statement.rawTextHash, result.rawTextHash);
  assert.equal(statement.lines.length, 3);
  for (const line of statement.lines) {
    assert.match(line.lineHash as string, HEX_SHA256);
  }
});

test('PASS 2: two identical calls are fully deterministic', () => {
  const a = prepareStructuredBankStatementCsvIngestion(baseInput());
  const b = prepareStructuredBankStatementCsvIngestion(baseInput());

  assert.deepEqual(a, b);
});

test('PASS 3: a different sourceFileName never changes the importId', () => {
  const a = prepareStructuredBankStatementCsvIngestion(baseInput());
  const b = prepareStructuredBankStatementCsvIngestion(
    baseInput({ sourceFileName: 'export ora synthetique v2.csv' })
  );

  assert.equal(a.importId, b.importId);
  assert.deepEqual(statementLineHashes(a), statementLineHashes(b));
});

test('PASS 4: CRLF and LF variants share one rawTextHash and one line identity', () => {
  const lf = prepareStructuredBankStatementCsvIngestion(baseInput());
  const crlf = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: validCsvLines().join('\r\n') })
  );

  assert.equal(lf.rawTextHash, crlf.rawTextHash);
  assert.equal(lf.importId, crlf.importId);
  assert.deepEqual(statementLineHashes(lf), statementLineHashes(crlf));
});

test('PASS 5: a real amount change changes the rawTextHash', () => {
  const lines = validCsvLines();
  lines[7] = '10/06/2026;10/06/2026;VIREMENT RECU CLIENT SYNTHETIQUE;;300001;1100001';
  lines[8] = ';;Total;200000;300001;';
  lines[9] = 'Solde au 30/06/2026 : 1100001;;;;;';

  const original = prepareStructuredBankStatementCsvIngestion(baseInput());
  const changed = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: lines.join('\n') })
  );

  assert.notEqual(original.rawTextHash, changed.rawTextHash);
});

test('PASS 6: strict duplicate lines differ only by occurrenceOrdinal', () => {
  const result = prepareStructuredBankStatementCsvIngestion(baseInput());
  const [first, second, third] = statementLineHashes(result);

  // Lines 0 and 1 are logical duplicates: same identity, ordinals 1 and 2.
  assert.match(first as string, HEX_SHA256);
  assert.match(second as string, HEX_SHA256);
  assert.notEqual(first, second);
  assert.notEqual(third, first);
  assert.notEqual(third, second);
});

test('PASS 7: physical noise rows shift sourceRowIndex but never a line identity', () => {
  const clean = prepareStructuredBankStatementCsvIngestion(baseInput());
  const noisy = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: noisyValidCsv() })
  );

  // The text differs, so the exact fingerprint differs...
  assert.notEqual(clean.rawTextHash, noisy.rawTextHash);
  // ...but the logical identities are untouched.
  assert.equal(clean.importId, noisy.importId);
  assert.deepEqual(statementLineHashes(clean), statementLineHashes(noisy));

  const cleanIndices = clean.importResult.statement?.lines.map((line) => line.sourceLineIndex);
  const noisyIndices = noisy.importResult.statement?.lines.map((line) => line.sourceLineIndex);
  assert.notDeepEqual(cleanIndices, noisyIndices);
});

test('PASS 8: a whitespace-only sourceFormat falls back coherently for both statement and importId', () => {
  const byDefault = prepareStructuredBankStatementCsvIngestion(baseInput());
  const blank = prepareStructuredBankStatementCsvIngestion(baseInput({ sourceFormat: '   ' }));

  assert.ok(blank.importResult.statement);
  assert.equal(blank.importResult.statement.sourceFormat, 'structured_bank_statement_csv');
  assert.equal(blank.importId, byDefault.importId);
  assert.deepEqual(statementLineHashes(blank), statementLineHashes(byDefault));
});

test('PASS 9: a custom sourceFormat with surrounding spaces is trimmed once for statement and importId', () => {
  const trimmed = prepareStructuredBankStatementCsvIngestion(
    baseInput({ sourceFormat: 'synthetic_custom_csv' })
  );
  const padded = prepareStructuredBankStatementCsvIngestion(
    baseInput({ sourceFormat: '  synthetic_custom_csv  ' })
  );

  assert.ok(padded.importResult.statement);
  assert.equal(padded.importResult.statement.sourceFormat, 'synthetic_custom_csv');
  assert.equal(padded.importId, trimmed.importId);
  // A custom sourceFormat is a distinct logical identity from the default one.
  assert.notEqual(padded.importId, prepareStructuredBankStatementCsvIngestion(baseInput()).importId);
});

// --------------------------------------------------------------------------
// needs_review
// --------------------------------------------------------------------------

test('REVIEW 1: needs_review without opt-in yields success false and no statement', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: needsReviewCsv() })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.lineHashesApplied, false);
  assert.equal(result.importResult.statement, undefined);
  assert.ok(result.importResult.rejectedReason);
  assert.match(result.rawTextHash, HEX_SHA256);
});

test('REVIEW 2: needs_review with opt-in yields a review statement, success false, lineHashes present', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: needsReviewCsv(), includeNeedsReviewStatement: true })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.importResult.success, false);
  assert.ok(result.importResult.statement);
  assert.equal(result.importResult.statement.status, 'needs_review');

  // importId is possible (fingerprint + period present), so lines are hashed.
  assert.ok(result.importId !== undefined);
  assert.equal(result.lineHashesApplied, true);
  for (const hash of statementLineHashes(result)) {
    assert.match(hash as string, HEX_SHA256);
  }
});

// --------------------------------------------------------------------------
// invalid / unsupported
// --------------------------------------------------------------------------

test('REJECT 1: an invalid document exposes no statement, no importId, no lineHash', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: invalidCsv() })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.importId, undefined);
  assert.equal(result.lineHashesApplied, false);
  assert.equal(result.importResult.statement, undefined);
  assert.equal(result.importResult.validation.status, 'invalid');
  assert.match(result.rawTextHash, HEX_SHA256);
  assert.ok(result.warnings.some((warning) => /importId is never computed/.test(warning)));
});

test('REJECT 2: an unsupported document exposes no statement, no importId, no lineHash', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: unsupportedCsv() })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.importId, undefined);
  assert.equal(result.lineHashesApplied, false);
  assert.equal(result.importResult.statement, undefined);
  assert.equal(result.importResult.validation.status, 'unsupported');
  assert.match(result.rawTextHash, HEX_SHA256);
});

// --------------------------------------------------------------------------
// accountFingerprint fail-closed
// --------------------------------------------------------------------------

test('FINGERPRINT 1: an absent accountFingerprint disables importId and lineHash without any throw', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ accountFingerprint: undefined })
  );

  // The adapter can still succeed: the fingerprint gates idempotency, not mapping.
  assert.equal(result.success, true);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.importId, undefined);
  assert.equal(result.lineHashesApplied, false);
  assert.ok(result.importResult.statement);
  assert.equal(result.importResult.statement.importId, undefined);
  assert.equal(result.importResult.statement.accountIdentity.accountFingerprint, undefined);
  for (const line of result.importResult.statement.lines) {
    assert.equal(line.lineHash, undefined);
  }
  assert.ok(
    result.warnings.some((warning) => /missing or empty component\(s\): accountFingerprint/.test(warning))
  );
  assert.ok(result.warnings.some((warning) => /lineHash enrichment skipped/.test(warning)));
});

test('FINGERPRINT 2: a whitespace-only accountFingerprint is treated as absent, never as an identity', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ accountFingerprint: '   ' })
  );

  assert.equal(result.importId, undefined);
  assert.equal(result.lineHashesApplied, false);
  assert.ok(result.importResult.statement);
  // No fallback: neither the masked account number nor the blank value leaks in.
  assert.equal(result.importResult.statement.accountIdentity.accountFingerprint, undefined);
  assert.ok(
    result.warnings.some((warning) => /missing or empty component\(s\): accountFingerprint/.test(warning))
  );
});

// --------------------------------------------------------------------------
// No-leak
// --------------------------------------------------------------------------

test('NO-LEAK 1: the result never exposes decodedText, raw CSV keys or the raw account number', () => {
  const result = prepareStructuredBankStatementCsvIngestion(baseInput());
  const serialized = JSON.stringify(result);
  const keys = collectKeysDeep(result);

  for (const forbiddenKey of ['decodedText', 'rawCsv', 'rawText', 'accountNumberRaw']) {
    assert.equal(keys.has(forbiddenKey), false, `forbidden key exposed: ${forbiddenKey}`);
  }

  assert.equal(serialized.includes(SYNTHETIC_RAW_ACCOUNT_DIGITS), false);
  assert.equal(result.importResult.statement?.accountIdentity.accountNumberMasked, '****9046');
});

test('NO-LEAK 2: rejected documents leak nothing either', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: invalidCsv() })
  );
  const serialized = JSON.stringify(result);
  const keys = collectKeysDeep(result);

  for (const forbiddenKey of ['decodedText', 'rawCsv', 'rawText', 'accountNumberRaw']) {
    assert.equal(keys.has(forbiddenKey), false, `forbidden key exposed: ${forbiddenKey}`);
  }
  assert.equal(serialized.includes(SYNTHETIC_RAW_ACCOUNT_DIGITS), false);
});

// ---------------------------------------------------------------------------
// DAILY-INGESTION-0C — garde BRIDGE / UNKNOWN sur le chemin de pré-ingestion
// ---------------------------------------------------------------------------

test('0C BRIDGE: a bridge-named CSV is rejected fail-closed, no identity, no statement', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ sourceFileName: 'BRIDGE_EXPORT.csv' })
  );

  assert.equal(result.success, false);
  assert.equal(result.ingestionReady, false);
  assert.equal(result.lineHashesApplied, false);
  assert.equal(result.importId, undefined);
  assert.equal(result.importResult.statement, undefined);
  assert.equal(result.importResult.rejectedReason, BRIDGE_CSV_INGESTION_REJECTION_MESSAGE);
  assert.ok(result.errors.includes(BRIDGE_CSV_INGESTION_REJECTION_MESSAGE));
  // Traceability of the rejected text is preserved.
  assert.match(result.rawTextHash, HEX_SHA256);
});

test('0C UNKNOWN: a CSV without a trusted BDK/ORA source name is rejected fail-closed', () => {
  const named = prepareStructuredBankStatementCsvIngestion(
    baseInput({ sourceFileName: 'releve-mysterieux-juin.csv' })
  );
  assert.equal(named.success, false);
  assert.equal(named.ingestionReady, false);
  assert.equal(named.importId, undefined);
  assert.equal(named.importResult.statement, undefined);
  assert.ok(named.errors.includes(UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE));

  const unnamed = prepareStructuredBankStatementCsvIngestion(
    baseInput({ sourceFileName: undefined })
  );
  assert.equal(unnamed.success, false);
  assert.equal(unnamed.ingestionReady, false);
  assert.equal(unnamed.importId, undefined);
  assert.ok(unnamed.errors.includes(UNKNOWN_BANK_HINT_INGESTION_REJECTION_MESSAGE));
});

// ---------------------------------------------------------------------------
// DAILY-INGESTION-0C — garde période longue
// ---------------------------------------------------------------------------

// 90 jours inclusifs : 01/06/2026 -> 29/08/2026. Le relevé reste entièrement
// réconcilié : seule la durée déclarée dépasse la limite.
function longPeriodCsv(): string {
  const lines = validCsvLines();
  lines[2] = 'Periode;01/06/2026;29/08/2026;;;';
  lines[lines.length - 1] = 'Solde au 29/08/2026 : 1100000;;;;;';
  return lines.join('\n');
}

// 45 jours inclusifs pile : 01/06/2026 -> 15/07/2026 (borne acceptée).
function boundaryPeriodCsv(): string {
  const lines = validCsvLines();
  lines[2] = 'Periode;01/06/2026;15/07/2026;;;';
  lines[lines.length - 1] = 'Solde au 15/07/2026 : 1100000;;;;;';
  return lines.join('\n');
}

// 46 jours inclusifs : 01/06/2026 -> 16/07/2026 (premier jour refusé).
function overBoundaryPeriodCsv(): string {
  const lines = validCsvLines();
  lines[2] = 'Periode;01/06/2026;16/07/2026;;;';
  lines[lines.length - 1] = 'Solde au 16/07/2026 : 1100000;;;;;';
  return lines.join('\n');
}

test('0C période: 90 jours -> jamais ingestionReady, message contrôlé, identité conservée', () => {
  const result = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: longPeriodCsv() })
  );

  // Le document reste valide et hashé (identité légitime), mais le signal
  // fail-closed ingestionReady est forcé à false par la garde.
  assert.equal(result.success, true);
  assert.equal(result.lineHashesApplied, true);
  assert.ok(result.importId !== undefined);
  assert.equal(result.ingestionReady, false);

  const periodError = result.errors.find((error) => error.includes('90 days'));
  assert.ok(periodError !== undefined, 'expected a controlled period-length error');
  assert.ok(periodError.includes(`${MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS}-day`));
});

test('0C période: 45 jours pile passe, 46 jours bloque (borne inclusive)', () => {
  const atBoundary = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: boundaryPeriodCsv() })
  );
  assert.equal(atBoundary.success, true);
  assert.equal(atBoundary.ingestionReady, true);
  assert.equal(atBoundary.errors.length, 0);

  const overBoundary = prepareStructuredBankStatementCsvIngestion(
    baseInput({ decodedText: overBoundaryPeriodCsv() })
  );
  assert.equal(overBoundary.success, true);
  assert.equal(overBoundary.ingestionReady, false);
  assert.ok(overBoundary.errors.some((error) => error.includes('46 days')));
});

test('0C période: le comportement existant à 30 jours est inchangé', () => {
  const result = prepareStructuredBankStatementCsvIngestion(baseInput());

  assert.equal(result.success, true);
  assert.equal(result.ingestionReady, true);
  assert.equal(result.errors.length, 0);
});
