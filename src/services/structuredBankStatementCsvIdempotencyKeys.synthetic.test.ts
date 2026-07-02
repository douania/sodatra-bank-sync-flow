import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStructuredBankStatementRawTextHash,
  buildStructuredBankStatementImportId,
  buildStructuredBankStatementLineHash,
  normalizeStructuredBankStatementDecodedTextForHash,
  normalizeStructuredBankStatementDescriptionForHash,
  type BuildStructuredBankStatementImportIdInput,
  type BuildStructuredBankStatementLineHashInput
} from './structuredBankStatementCsvIdempotencyKeys';

// All fixtures below are fully synthetic. No real bank statement data, no real
// account number, no real bank client and no SODATRA data is ever used.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

// Special code points expressed from explicit escapes (ASCII-only source):
//  - U+FEFF byte-order mark, U+00A0 no-break space, U+202F narrow no-break space.
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0x00a0);
const NARROW_NBSP = String.fromCharCode(0x202f);

function syntheticCsvText(closingBalance = 1_000_000): string {
  return [
    'EXTRAIT DE COMPTE;;;;;',
    'Periode du;01/06/2026;au;30/06/2026;;',
    'Numero de compte;SYNTHETIC-ACCOUNT;;;;',
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW;200000;;800000',
    '02/06/2026;02/06/2026;SYNTHETIC INFLOW;;500000;1300000',
    ';;Total;200000;500000;',
    `;;Solde (XOF) au 30/06/2026 : ${closingBalance};;;`
  ].join('\n');
}

function importIdInput(
  overrides: Partial<BuildStructuredBankStatementImportIdInput> = {}
): BuildStructuredBankStatementImportIdInput {
  return {
    sourceFormat: 'structured_bank_statement_csv',
    bank: 'ORA',
    accountFingerprint: 'SYNTHETIC-FINGERPRINT-0001',
    periodStart: '01/06/2026',
    periodEnd: '30/06/2026',
    ...overrides
  };
}

function lineInput(
  overrides: Partial<BuildStructuredBankStatementLineHashInput> = {}
): BuildStructuredBankStatementLineHashInput {
  return {
    importId: 'synthetic-import-id',
    operationDate: '01/06/2026',
    valueDate: '01/06/2026',
    direction: 'debit',
    signedAmount: -200_000,
    currency: 'XOF',
    descriptionSanitized: 'SYNTHETIC OUTFLOW',
    occurrenceOrdinal: 1,
    ...overrides
  };
}

// --------------------------------------------------------------------------
// rawTextHash
// --------------------------------------------------------------------------

test('rawTextHash 1: identical decoded text yields the same hash', () => {
  const text = syntheticCsvText();
  const a = buildStructuredBankStatementRawTextHash({ decodedText: text });
  const b = buildStructuredBankStatementRawTextHash({ decodedText: text });
  assert.equal(a, b);
});

test('rawTextHash 2: a leading BOM is ignored', () => {
  const text = syntheticCsvText();
  const withBom = buildStructuredBankStatementRawTextHash({ decodedText: `${BOM}${text}` });
  const withoutBom = buildStructuredBankStatementRawTextHash({ decodedText: text });
  assert.equal(withBom, withoutBom);
});

test('rawTextHash 3: CRLF and LF line endings yield the same hash', () => {
  const lf = syntheticCsvText();
  const crlf = lf.replace(/\n/g, '\r\n');
  const cr = lf.replace(/\n/g, '\r');
  const lfHash = buildStructuredBankStatementRawTextHash({ decodedText: lf });
  assert.equal(buildStructuredBankStatementRawTextHash({ decodedText: crlf }), lfHash);
  assert.equal(buildStructuredBankStatementRawTextHash({ decodedText: cr }), lfHash);
});

test('rawTextHash 4: a real amount change changes the hash', () => {
  const original = buildStructuredBankStatementRawTextHash({ decodedText: syntheticCsvText(1_000_000) });
  const altered = buildStructuredBankStatementRawTextHash({ decodedText: syntheticCsvText(999_999) });
  assert.notEqual(original, altered);
});

test('rawTextHash 5: output is a 64-char lowercase hex SHA-256 digest', () => {
  const hash = buildStructuredBankStatementRawTextHash({ decodedText: syntheticCsvText() });
  assert.match(hash, HEX_SHA256);
});

test('rawTextHash: an all-whitespace difference that is not a line ending still changes the hash', () => {
  // Only BOM + line endings are normalized; a trailing space is a real change.
  const base = buildStructuredBankStatementRawTextHash({ decodedText: 'SYNTHETIC;1' });
  const spaced = buildStructuredBankStatementRawTextHash({ decodedText: 'SYNTHETIC;1 ' });
  assert.notEqual(base, spaced);
});

// --------------------------------------------------------------------------
// importId
// --------------------------------------------------------------------------

test('importId 6: the same logical statement yields the same importId', () => {
  const a = buildStructuredBankStatementImportId(importIdInput());
  const b = buildStructuredBankStatementImportId(importIdInput());
  assert.equal(a, b);
  assert.match(a, HEX_SHA256);
});

test('importId 7: an unknown extra field such as sourceFileName never influences the importId', () => {
  // The typed input has no sourceFileName; a stray property must be ignored.
  const baseline = buildStructuredBankStatementImportId(importIdInput());
  const withStray = buildStructuredBankStatementImportId({
    ...importIdInput(),
    sourceFileName: '010726 ORA ONLINE.csv'
  } as unknown as BuildStructuredBankStatementImportIdInput);
  assert.equal(withStray, baseline);
});

test('importId 8: a different bank yields a different importId', () => {
  const ora = buildStructuredBankStatementImportId(importIdInput({ bank: 'ORA' }));
  const bdk = buildStructuredBankStatementImportId(importIdInput({ bank: 'BDK' }));
  assert.notEqual(ora, bdk);
});

test('importId 9: a different accountFingerprint yields a different importId', () => {
  const a = buildStructuredBankStatementImportId(importIdInput({ accountFingerprint: 'SYNTHETIC-A' }));
  const b = buildStructuredBankStatementImportId(importIdInput({ accountFingerprint: 'SYNTHETIC-B' }));
  assert.notEqual(a, b);
});

test('importId 10: a different period (start or end) yields a different importId', () => {
  const base = buildStructuredBankStatementImportId(importIdInput());
  const otherStart = buildStructuredBankStatementImportId(importIdInput({ periodStart: '02/06/2026' }));
  const otherEnd = buildStructuredBankStatementImportId(importIdInput({ periodEnd: '29/06/2026' }));
  assert.notEqual(otherStart, base);
  assert.notEqual(otherEnd, base);
  assert.notEqual(otherStart, otherEnd);
});

test('importId 11: an unknown extra field such as rawTextHash never influences the importId', () => {
  const baseline = buildStructuredBankStatementImportId(importIdInput());
  const withStray = buildStructuredBankStatementImportId({
    ...importIdInput(),
    rawTextHash: 'deadbeef'.repeat(8)
  } as unknown as BuildStructuredBankStatementImportIdInput);
  assert.equal(withStray, baseline);
});

test('importId 12: an empty (or whitespace-only) accountFingerprint throws', () => {
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ accountFingerprint: '' })),
    /accountFingerprint is mandatory/i
  );
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ accountFingerprint: '   ' })),
    /accountFingerprint is mandatory/i
  );
});

test('importId: an empty (or whitespace-only) sourceFormat throws', () => {
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ sourceFormat: '' })),
    /sourceFormat must be non-empty/i
  );
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ sourceFormat: '   ' })),
    /sourceFormat must be non-empty/i
  );
});

test('importId: an empty (or whitespace-only) bank throws', () => {
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ bank: '' })),
    /bank must be non-empty/i
  );
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ bank: '   ' })),
    /bank must be non-empty/i
  );
});

test('importId: an empty (or whitespace-only) periodStart throws', () => {
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ periodStart: '' })),
    /periodStart must be non-empty/i
  );
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ periodStart: '   ' })),
    /periodStart must be non-empty/i
  );
});

test('importId: an empty (or whitespace-only) periodEnd throws', () => {
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ periodEnd: '' })),
    /periodEnd must be non-empty/i
  );
  assert.throws(
    () => buildStructuredBankStatementImportId(importIdInput({ periodEnd: '   ' })),
    /periodEnd must be non-empty/i
  );
});

test('importId: leading/trailing whitespace is trimmed and does not create a new identity', () => {
  const clean = buildStructuredBankStatementImportId(importIdInput());
  const padded = buildStructuredBankStatementImportId(
    importIdInput({ bank: '  ORA  ', accountFingerprint: '  SYNTHETIC-FINGERPRINT-0001  ' })
  );
  assert.equal(padded, clean);
});

// --------------------------------------------------------------------------
// lineHash
// --------------------------------------------------------------------------

test('lineHash 13: the same logical line yields the same lineHash', () => {
  const a = buildStructuredBankStatementLineHash(lineInput());
  const b = buildStructuredBankStatementLineHash(lineInput());
  assert.equal(a, b);
  assert.match(a, HEX_SHA256);
});

test('lineHash 14: an unknown extra field such as sourceRowIndex never influences the lineHash', () => {
  const baseline = buildStructuredBankStatementLineHash(lineInput());
  const withStray = buildStructuredBankStatementLineHash({
    ...lineInput(),
    sourceRowIndex: 42
  } as unknown as BuildStructuredBankStatementLineHashInput);
  assert.equal(withStray, baseline);
});

test('lineHash 15: a different signedAmount yields a different lineHash', () => {
  const a = buildStructuredBankStatementLineHash(lineInput({ signedAmount: -200_000 }));
  const b = buildStructuredBankStatementLineHash(lineInput({ signedAmount: -200_001 }));
  assert.notEqual(a, b);
});

test('lineHash 16: a different operationDate yields a different lineHash', () => {
  const a = buildStructuredBankStatementLineHash(lineInput({ operationDate: '01/06/2026' }));
  const b = buildStructuredBankStatementLineHash(lineInput({ operationDate: '02/06/2026' }));
  assert.notEqual(a, b);
});

test('lineHash 17: multiple spaces, NBSP and narrow NBSP normalize to the same lineHash', () => {
  const plain = buildStructuredBankStatementLineHash(
    lineInput({ descriptionSanitized: 'SYNTHETIC OUTFLOW LABEL' })
  );
  const messy = buildStructuredBankStatementLineHash(
    lineInput({ descriptionSanitized: `  SYNTHETIC${NBSP}${NBSP}OUTFLOW${NARROW_NBSP}LABEL  ` })
  );
  assert.equal(messy, plain);
});

test('lineHash 18: two otherwise identical lines differ by occurrenceOrdinal', () => {
  const first = buildStructuredBankStatementLineHash(lineInput({ occurrenceOrdinal: 1 }));
  const second = buildStructuredBankStatementLineHash(lineInput({ occurrenceOrdinal: 2 }));
  assert.notEqual(first, second);
});

test('lineHash 19: an occurrenceOrdinal of 0 throws', () => {
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ occurrenceOrdinal: 0 })),
    /occurrenceOrdinal must be an integer >= 1/i
  );
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ occurrenceOrdinal: 1.5 })),
    /occurrenceOrdinal must be an integer >= 1/i
  );
});

test('lineHash 20: an unknown direction (runtime cast) throws', () => {
  assert.throws(
    () =>
      buildStructuredBankStatementLineHash(
        lineInput({ direction: 'unknown' as unknown as 'debit' })
      ),
    /direction must be "debit" or "credit"/i
  );
});

test('lineHash 21: a non-finite signedAmount (NaN or Infinity) throws', () => {
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ signedAmount: Number.NaN })),
    /signedAmount must be a finite number/i
  );
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ signedAmount: Number.POSITIVE_INFINITY })),
    /signedAmount must be a finite number/i
  );
});

test('lineHash 22: an empty (or whitespace-only) descriptionSanitized throws', () => {
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ descriptionSanitized: '' })),
    /descriptionSanitized must be non-empty/i
  );
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ descriptionSanitized: '   ' })),
    /descriptionSanitized must be non-empty/i
  );
});

test('lineHash 23: an empty importId throws', () => {
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ importId: '' })),
    /importId must be non-empty/i
  );
});

test('lineHash: an empty (or whitespace-only) operationDate throws', () => {
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ operationDate: '' })),
    /operationDate must be non-empty/i
  );
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ operationDate: '   ' })),
    /operationDate must be non-empty/i
  );
});

test('lineHash: an empty currency throws', () => {
  assert.throws(
    () => buildStructuredBankStatementLineHash(lineInput({ currency: '' })),
    /currency must be non-empty/i
  );
});

test('lineHash: a valueDate is optional and defaults to an empty component', () => {
  const withValueDate = buildStructuredBankStatementLineHash(lineInput({ valueDate: '' }));
  const withoutValueDate = buildStructuredBankStatementLineHash(lineInput({ valueDate: undefined }));
  assert.equal(withoutValueDate, withValueDate);
});

test('lineHash: negative zero and positive zero share one canonical amount', () => {
  const positiveZero = buildStructuredBankStatementLineHash(lineInput({ signedAmount: 0 }));
  const negativeZero = buildStructuredBankStatementLineHash(lineInput({ signedAmount: -0 }));
  assert.equal(negativeZero, positiveZero);
});

// --------------------------------------------------------------------------
// Normalization helpers (direct unit coverage)
// --------------------------------------------------------------------------

test('normalizeDecodedText: strips a single BOM and unifies line endings only', () => {
  assert.equal(normalizeStructuredBankStatementDecodedTextForHash(`${BOM}a\r\nb\rc`), 'a\nb\nc');
  // A trailing space is preserved (no global trim).
  assert.equal(normalizeStructuredBankStatementDecodedTextForHash('a \n'), 'a \n');
});

test('normalizeDescription: folds NBSP, collapses whitespace, trims and lowercases', () => {
  assert.equal(
    normalizeStructuredBankStatementDescriptionForHash('  SYNTHETIC  LABEL 123  '),
    'synthetic label 123'
  );
  assert.equal(
    normalizeStructuredBankStatementDescriptionForHash(`SYNTHETIC${NBSP}LABEL${NARROW_NBSP}123`),
    'synthetic label 123'
  );
  // Digits carry business meaning and are never stripped.
  assert.equal(normalizeStructuredBankStatementDescriptionForHash('CHEQUE N 101632'), 'cheque n 101632');
});

// --------------------------------------------------------------------------
// No-leak guarantees
// --------------------------------------------------------------------------

test('no-leak 24/25: outputs are opaque hex and never echo synthetic input labels', () => {
  const importId = buildStructuredBankStatementImportId(importIdInput());
  const lineHash = buildStructuredBankStatementLineHash(lineInput({ importId }));
  const rawTextHash = buildStructuredBankStatementRawTextHash({ decodedText: syntheticCsvText() });

  for (const hash of [importId, lineHash, rawTextHash]) {
    assert.match(hash, HEX_SHA256);
    assert.equal(hash.includes('SYNTHETIC'), false);
    assert.equal(hash.toLowerCase().includes('outflow'), false);
    assert.equal(hash.includes('FINGERPRINT'), false);
  }
});
