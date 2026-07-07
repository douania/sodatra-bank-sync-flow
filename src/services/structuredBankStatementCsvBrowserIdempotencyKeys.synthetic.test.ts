import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildStructuredBankStatementRawTextHash as buildRawTextHashInBrowser,
  buildStructuredBankStatementImportId as buildImportIdInBrowser,
  buildStructuredBankStatementLineHash as buildLineHashInBrowser,
  normalizeStructuredBankStatementDecodedTextForHash as normalizeDecodedTextInBrowser,
  normalizeStructuredBankStatementDescriptionForHash as normalizeDescriptionInBrowser,
  isWebCryptoAvailableForStructuredBankStatementHashing,
  type BuildStructuredBankStatementImportIdInput,
  type BuildStructuredBankStatementLineHashInput
} from './structuredBankStatementCsvBrowserIdempotencyKeys';
import {
  buildStructuredBankStatementRawTextHash as buildRawTextHashInNode,
  buildStructuredBankStatementImportId as buildImportIdInNode,
  buildStructuredBankStatementLineHash as buildLineHashInNode,
  normalizeStructuredBankStatementDecodedTextForHash as normalizeDecodedTextInNode,
  normalizeStructuredBankStatementDescriptionForHash as normalizeDescriptionInNode
} from './structuredBankStatementCsvIdempotencyKeys';

// All fixtures below are fully synthetic. No real bank statement data, no real
// account number, no real bank client and no SODATRA data is ever used.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

// Special code points expressed from explicit escapes (ASCII-only source):
// U+FEFF BOM, U+00A0 NBSP, U+202F narrow NBSP, U+FB01 'fi' ligature,
// U+FF11..U+FF13 full-width digits 1-3, U+0152 'OE' ligature.
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0x00a0);
const NARROW_NBSP = String.fromCharCode(0x202f);
const FI_LIGATURE = String.fromCharCode(0xfb01);
const FULLWIDTH_123 = String.fromCharCode(0xff11, 0xff12, 0xff13);
const OE_LIGATURE = String.fromCharCode(0x0152);

function syntheticCsvText(closingBalance = 1_000_000): string {
  return [
    'EXTRAIT DE COMPTE;;;;;',
    'Periode du;01/06/2026;au;30/06/2026;;',
    'Numero de compte;SYNTHETIC-ACCOUNT;;;;',
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    `01/06/2026;01/06/2026;SYNTHETIC ${OE_LIGATURE}UVRE OUTFLOW;200000;;800000`,
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
// Node/browser parity — the core E-2B guarantee
// --------------------------------------------------------------------------

test('parity 1: rawTextHash is identical between Node and browser helpers', async () => {
  const fixtures = [
    syntheticCsvText(),
    `${BOM}${syntheticCsvText()}`,
    syntheticCsvText().replace(/\n/g, '\r\n'),
    syntheticCsvText().replace(/\n/g, '\r'),
    '',
    'SYNTHETIC;1 ',
    `libell${String.fromCharCode(0x00e9)} accentu${String.fromCharCode(0x00e9)};${FULLWIDTH_123}`
  ];
  for (const decodedText of fixtures) {
    const nodeHash = buildRawTextHashInNode({ decodedText });
    const browserHash = await buildRawTextHashInBrowser({ decodedText });
    assert.equal(browserHash, nodeHash);
    assert.match(browserHash, HEX_SHA256);
  }
});

test('parity 2: importId is identical between Node and browser helpers', async () => {
  const fixtures: BuildStructuredBankStatementImportIdInput[] = [
    importIdInput(),
    importIdInput({ bank: 'BDK' }),
    importIdInput({ accountFingerprint: 'SYNTHETIC-B' }),
    importIdInput({ periodStart: '02/06/2026', periodEnd: '29/06/2026' }),
    importIdInput({ bank: '  ORA  ', accountFingerprint: '  SYNTHETIC-FINGERPRINT-0001  ' })
  ];
  for (const input of fixtures) {
    const nodeId = buildImportIdInNode(input);
    const browserId = await buildImportIdInBrowser(input);
    assert.equal(browserId, nodeId);
    assert.match(browserId, HEX_SHA256);
  }
});

test('parity 3: lineHash is identical between Node and browser helpers', async () => {
  const fixtures: BuildStructuredBankStatementLineHashInput[] = [
    lineInput(),
    lineInput({ direction: 'credit', signedAmount: 500_000 }),
    lineInput({ valueDate: undefined }),
    lineInput({ occurrenceOrdinal: 2 }),
    lineInput({ signedAmount: 0 }),
    lineInput({ signedAmount: -0 }),
    lineInput({ signedAmount: 1234.56 }),
    lineInput({ descriptionSanitized: `  SYNTHETIC${NBSP}${NBSP}OUTFLOW${NARROW_NBSP}LABEL  ` }),
    lineInput({ descriptionSanitized: `SYNTHETIC ${FI_LIGATURE}LTER ${FULLWIDTH_123}` })
  ];
  for (const input of fixtures) {
    const nodeHash = buildLineHashInNode(input);
    const browserHash = await buildLineHashInBrowser(input);
    assert.equal(browserHash, nodeHash);
    assert.match(browserHash, HEX_SHA256);
  }
});

test('parity 4: normalization helpers behave identically on both twins', () => {
  const decodedFixtures = [`${BOM}a\r\nb\rc`, 'a \n', `${BOM}`, 'plain'];
  for (const value of decodedFixtures) {
    assert.equal(normalizeDecodedTextInBrowser(value), normalizeDecodedTextInNode(value));
  }
  const descriptionFixtures = [
    '  SYNTHETIC  LABEL 123  ',
    `SYNTHETIC${NBSP}LABEL${NARROW_NBSP}123`,
    `${FI_LIGATURE}nance ${FULLWIDTH_123}`,
    'CHEQUE N 101632'
  ];
  for (const value of descriptionFixtures) {
    assert.equal(normalizeDescriptionInBrowser(value), normalizeDescriptionInNode(value));
  }
});

// --------------------------------------------------------------------------
// Normalization rules (browser side, per E-2B spec)
// --------------------------------------------------------------------------

test('browser rawTextHash: BOM stripped, CRLF/CR folded to LF, other whitespace preserved', async () => {
  const text = syntheticCsvText();
  const lfHash = await buildRawTextHashInBrowser({ decodedText: text });
  assert.equal(await buildRawTextHashInBrowser({ decodedText: `${BOM}${text}` }), lfHash);
  assert.equal(await buildRawTextHashInBrowser({ decodedText: text.replace(/\n/g, '\r\n') }), lfHash);
  assert.equal(await buildRawTextHashInBrowser({ decodedText: text.replace(/\n/g, '\r') }), lfHash);
  // A trailing space is a genuine change: no global trim.
  assert.notEqual(
    await buildRawTextHashInBrowser({ decodedText: 'SYNTHETIC;1 ' }),
    await buildRawTextHashInBrowser({ decodedText: 'SYNTHETIC;1' })
  );
});

test('browser lineHash: NFKC, NBSP folding and whitespace collapse converge to one identity', async () => {
  const plain = await buildLineHashInBrowser(lineInput({ descriptionSanitized: 'synthetic filter 123' }));
  const ligature = await buildLineHashInBrowser(
    lineInput({ descriptionSanitized: `SYNTHETIC ${FI_LIGATURE}LTER ${FULLWIDTH_123}` })
  );
  const spaced = await buildLineHashInBrowser(
    lineInput({ descriptionSanitized: `  synthetic${NBSP}filter${NARROW_NBSP}123  ` })
  );
  assert.equal(ligature, plain);
  assert.equal(spaced, plain);
});

test('browser lineHash: negative zero and positive zero share one canonical amount', async () => {
  const positiveZero = await buildLineHashInBrowser(lineInput({ signedAmount: 0 }));
  const negativeZero = await buildLineHashInBrowser(lineInput({ signedAmount: -0 }));
  assert.equal(negativeZero, positiveZero);
});

test('browser lineHash: occurrenceOrdinal still disambiguates identical lines', async () => {
  const first = await buildLineHashInBrowser(lineInput({ occurrenceOrdinal: 1 }));
  const second = await buildLineHashInBrowser(lineInput({ occurrenceOrdinal: 2 }));
  assert.notEqual(first, second);
});

// --------------------------------------------------------------------------
// Fail-closed validations (same contract as the Node twin)
// --------------------------------------------------------------------------

test('browser importId: missing or empty accountFingerprint fails closed', async () => {
  await assert.rejects(
    () => buildImportIdInBrowser(importIdInput({ accountFingerprint: '' })),
    /accountFingerprint is mandatory/i
  );
  await assert.rejects(
    () => buildImportIdInBrowser(importIdInput({ accountFingerprint: '   ' })),
    /accountFingerprint is mandatory/i
  );
});

test('browser importId: every other component is mandatory once trimmed', async () => {
  await assert.rejects(() => buildImportIdInBrowser(importIdInput({ sourceFormat: ' ' })), /sourceFormat must be non-empty/i);
  await assert.rejects(() => buildImportIdInBrowser(importIdInput({ bank: '' })), /bank must be non-empty/i);
  await assert.rejects(() => buildImportIdInBrowser(importIdInput({ periodStart: '' })), /periodStart must be non-empty/i);
  await assert.rejects(() => buildImportIdInBrowser(importIdInput({ periodEnd: ' ' })), /periodEnd must be non-empty/i);
});

test('browser lineHash: invalid direction, ordinal, amount, currency or description fail closed', async () => {
  await assert.rejects(
    () => buildLineHashInBrowser(lineInput({ direction: 'unknown' as unknown as 'debit' })),
    /direction must be "debit" or "credit"/i
  );
  await assert.rejects(
    () => buildLineHashInBrowser(lineInput({ occurrenceOrdinal: 0 })),
    /occurrenceOrdinal must be an integer >= 1/i
  );
  await assert.rejects(
    () => buildLineHashInBrowser(lineInput({ signedAmount: Number.NaN })),
    /signedAmount must be a finite number/i
  );
  await assert.rejects(
    () => buildLineHashInBrowser(lineInput({ currency: '' })),
    /currency must be non-empty/i
  );
  await assert.rejects(
    () => buildLineHashInBrowser(lineInput({ descriptionSanitized: '   ' })),
    /descriptionSanitized must be non-empty/i
  );
  await assert.rejects(
    () => buildLineHashInBrowser(lineInput({ importId: '' })),
    /importId must be non-empty/i
  );
  await assert.rejects(
    () => buildLineHashInBrowser(lineInput({ operationDate: ' ' })),
    /operationDate must be non-empty/i
  );
});

// --------------------------------------------------------------------------
// Web Crypto fail-closed contract
// --------------------------------------------------------------------------

test('web crypto: availability probe is true in this test runtime', () => {
  assert.equal(isWebCryptoAvailableForStructuredBankStatementHashing(), true);
});

test('web crypto: unavailable runtime fails closed with an explicit error, no Node fallback', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  assert.notEqual(descriptor, undefined);
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    assert.equal(isWebCryptoAvailableForStructuredBankStatementHashing(), false);
    await assert.rejects(
      () => buildRawTextHashInBrowser({ decodedText: 'SYNTHETIC' }),
      /Web Crypto .* unavailable .* never falls back/is
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor as PropertyDescriptor);
  }
  // Restored runtime hashes again.
  assert.match(await buildRawTextHashInBrowser({ decodedText: 'SYNTHETIC' }), HEX_SHA256);
});

// --------------------------------------------------------------------------
// Module purity: the browser module must never import a Node-only module
// --------------------------------------------------------------------------

test('purity: the browser module source contains no Node-only import', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./structuredBankStatementCsvBrowserIdempotencyKeys.ts', import.meta.url)),
    'utf8'
  );
  // Tokens are assembled at runtime so this test file itself never carries the
  // forbidden literals that repo-level greps look for.
  const nodeCryptoToken = ['node', ':crypto'].join('');
  const nodeImportToken = ["from 'node", ':'].join('');
  const requireToken = ['require', '('].join('');
  assert.equal(source.includes(nodeCryptoToken), false);
  assert.equal(source.includes(nodeImportToken), false);
  assert.equal(source.includes(requireToken), false);
  // It must not even import its Node twin (type-only or not).
  assert.equal(source.includes("from './structuredBankStatementCsvIdempotencyKeys'"), false);
});
