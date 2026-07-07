/**
 * Browser-safe idempotency-key helper for structured bank statement CSV
 * exports (E-2B-RUNTIME-RPC-CONTRACT).
 *
 * This module is the BROWSER twin of the Node-only 0H helper
 * `structuredBankStatementCsvIdempotencyKeys.ts`. It must produce EXACTLY the
 * same SHA-256 hex lowercase hashes, from the same domain-separation tags and
 * the same normalization rules, so an identity computed in the browser and one
 * computed in Node can never diverge. The synthetic test suite asserts this
 * parity fixture by fixture against the Node twin.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - BROWSER-SAFE: no Node-only import of any kind. Hashing uses Web Crypto
 *    (`globalThis.crypto.subtle`) exclusively; when Web Crypto is unavailable
 *    in the running environment, every builder fails closed with an explicit
 *    error instead of falling back to the Node crypto module.
 *  - PURE besides hashing: no I/O, no decoding, no database access, no
 *    Supabase, no UI, no clock, no UUID, no Math.random: identical inputs
 *    always produce identical outputs, across runs, machines and runtimes.
 *  - Same doctrine as the Node twin: `sourceFileName` never feeds any hash,
 *    `sourceRowIndex` never feeds a `lineHash`, and `accountFingerprint` has
 *    no silent fallback on the low-entropy masked account number.
 *  - Async by necessity: `crypto.subtle.digest` is Promise-based, so every
 *    builder returns a Promise. All input validation still happens
 *    synchronously, before any digest, with the same error messages as the
 *    Node twin, so a rejected input never reaches the hashing stage.
 *
 * Divergence control: the domain tags, normalization rules and canonical
 * payload serialization below are intentional line-for-line copies of the Node
 * twin. They are duplicated (not imported) because importing anything from the
 * Node twin would pull its Node-only crypto import into a browser bundle.
 */

export type StructuredBankStatementSourceFormat = 'structured_bank_statement_csv' | string;

export interface BuildStructuredBankStatementRawTextHashInput {
  decodedText: string;
}

export interface BuildStructuredBankStatementImportIdInput {
  sourceFormat: StructuredBankStatementSourceFormat;
  bank: 'BDK' | 'ORA' | string;
  accountFingerprint: string;
  periodStart: string;
  periodEnd: string;
}

export interface BuildStructuredBankStatementLineHashInput {
  importId: string;
  operationDate: string;
  valueDate?: string;
  direction: 'debit' | 'credit';
  signedAmount: number;
  currency: string;
  descriptionSanitized: string;
  occurrenceOrdinal: number;
}

// Domain-separation tags: MUST stay byte-identical to the Node twin — they are
// part of the persisted identity contract (0U `import_id` / `line_hash`).
const IMPORT_ID_DOMAIN = 'sodatra:structured_bank_statement_csv:import_id:v1';
const LINE_HASH_DOMAIN = 'sodatra:structured_bank_statement_csv:line_hash:v1';

// No-break space (U+00A0) and narrow no-break space (U+202F): folded to a plain
// space before whitespace collapsing so a re-export that swaps one for the other
// keeps the same line identity. Built from explicit escapes (ASCII-only source).
const NON_BREAKING_SPACES = new RegExp('[\\u00A0\\u202F]', 'g');

// Byte-order mark (U+FEFF): a single leading occurrence is stripped from the
// decoded text before hashing.
const BYTE_ORDER_MARK = 0xfeff;

const WEB_CRYPTO_UNAVAILABLE_ERROR =
  'structuredBankStatementCsvBrowserIdempotencyKeys: Web Crypto (globalThis.crypto.subtle.digest) ' +
  'is unavailable in this runtime; failing closed — this browser module never falls back to the ' +
  'Node crypto module.';

/**
 * True when the running environment exposes the Web Crypto digest needed by
 * this module. A future runtime lot can use this as a preflight gate instead
 * of catching the fail-closed rejection.
 */
export function isWebCryptoAvailableForStructuredBankStatementHashing(): boolean {
  const subtle = globalThis.crypto?.subtle;
  return subtle !== undefined && typeof subtle.digest === 'function';
}

/**
 * rawTextHash: exact fingerprint of the decoded CSV text.
 *
 * Same contract as the Node twin: only a minimal, lossless normalization is
 * applied (single leading BOM stripped, CRLF/CR converted to LF) so that a
 * byte-identical re-export yields the same hash while any genuine content
 * change is preserved.
 */
export async function buildStructuredBankStatementRawTextHash(
  input: BuildStructuredBankStatementRawTextHashInput
): Promise<string> {
  const normalized = normalizeStructuredBankStatementDecodedTextForHash(input.decodedText);
  return sha256Hex(normalized);
}

/**
 * importId: logical identity of a statement.
 *
 * Deterministic over (sourceFormat, bank, accountFingerprint, periodStart,
 * periodEnd). It never includes the file name nor rawTextHash. Every component
 * is mandatory and fail-closed once trimmed; `accountFingerprint` in
 * particular has no silent fallback on the low-entropy masked account number.
 * Validation happens synchronously before any digest.
 */
export async function buildStructuredBankStatementImportId(
  input: BuildStructuredBankStatementImportIdInput
): Promise<string> {
  const sourceFormat = trimString(input.sourceFormat);
  const bank = trimString(input.bank);
  const accountFingerprint = trimString(input.accountFingerprint);
  const periodStart = trimString(input.periodStart);
  const periodEnd = trimString(input.periodEnd);

  if (sourceFormat === '') {
    throw new Error('buildStructuredBankStatementImportId: sourceFormat must be non-empty.');
  }
  if (bank === '') {
    throw new Error('buildStructuredBankStatementImportId: bank must be non-empty.');
  }
  if (accountFingerprint === '') {
    throw new Error(
      'buildStructuredBankStatementImportId: accountFingerprint is mandatory and must be non-empty; ' +
        'refusing to fall back on the masked account number.'
    );
  }
  if (periodStart === '') {
    throw new Error('buildStructuredBankStatementImportId: periodStart must be non-empty.');
  }
  if (periodEnd === '') {
    throw new Error('buildStructuredBankStatementImportId: periodEnd must be non-empty.');
  }

  const payload = canonicalPayload([
    IMPORT_ID_DOMAIN,
    sourceFormat,
    bank,
    accountFingerprint,
    periodStart,
    periodEnd
  ]);

  return sha256Hex(payload);
}

/**
 * lineHash: logical identity of a single transaction line.
 *
 * Deterministic over (importId, operationDate, valueDate, direction, canonical
 * signedAmount, currency, normalized description, occurrenceOrdinal). It never
 * includes sourceRowIndex, sourceFileName, rawTextHash, a timestamp or a DB id.
 * Validation happens synchronously before any digest.
 */
export async function buildStructuredBankStatementLineHash(
  input: BuildStructuredBankStatementLineHashInput
): Promise<string> {
  const importId = trimString(input.importId);
  if (importId === '') {
    throw new Error('buildStructuredBankStatementLineHash: importId must be non-empty.');
  }

  const operationDate = trimString(input.operationDate);
  if (operationDate === '') {
    throw new Error('buildStructuredBankStatementLineHash: operationDate must be non-empty.');
  }

  if (input.direction !== 'debit' && input.direction !== 'credit') {
    throw new Error(
      `buildStructuredBankStatementLineHash: direction must be "debit" or "credit", received "${String(
        input.direction
      )}".`
    );
  }

  if (!Number.isInteger(input.occurrenceOrdinal) || input.occurrenceOrdinal < 1) {
    throw new Error(
      `buildStructuredBankStatementLineHash: occurrenceOrdinal must be an integer >= 1, received "${String(
        input.occurrenceOrdinal
      )}".`
    );
  }

  const canonicalAmount = canonicalizeSignedAmount(input.signedAmount);

  const currency = trimString(input.currency);
  if (currency === '') {
    throw new Error('buildStructuredBankStatementLineHash: currency must be non-empty.');
  }

  const description = normalizeStructuredBankStatementDescriptionForHash(input.descriptionSanitized);
  if (description === '') {
    throw new Error('buildStructuredBankStatementLineHash: descriptionSanitized must be non-empty.');
  }

  const payload = canonicalPayload([
    LINE_HASH_DOMAIN,
    importId,
    operationDate,
    input.valueDate === undefined ? '' : trimString(input.valueDate),
    input.direction,
    canonicalAmount,
    currency,
    description,
    String(input.occurrenceOrdinal)
  ]);

  return sha256Hex(payload);
}

/**
 * Minimal, lossless normalization for the raw-text fingerprint:
 *  - strip a single leading BOM,
 *  - convert CRLF and lone CR to LF.
 * No global trim, no whitespace collapsing, no accent folding: any genuine
 * value change in the text must still change the hash.
 */
export function normalizeStructuredBankStatementDecodedTextForHash(value: string): string {
  const withoutBom = value.charCodeAt(0) === BYTE_ORDER_MARK ? value.slice(1) : value;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/**
 * Description normalization for line identity:
 *  - Unicode NFKC (when available),
 *  - NBSP and narrow NBSP folded to a regular space,
 *  - runs of whitespace collapsed to a single space,
 *  - trimmed and lowercased.
 * The business meaning is preserved: digits are never stripped and the label is
 * assumed already sanitized/masked upstream.
 */
export function normalizeStructuredBankStatementDescriptionForHash(value: string): string {
  const nfkc = typeof value.normalize === 'function' ? value.normalize('NFKC') : value;
  return nfkc
    .replace(NON_BREAKING_SPACES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function canonicalizeSignedAmount(signedAmount: number): string {
  if (!Number.isFinite(signedAmount)) {
    throw new Error(
      `buildStructuredBankStatementLineHash: signedAmount must be a finite number, received "${String(
        signedAmount
      )}".`
    );
  }
  // Collapse negative zero to zero so "-0" and "0" share one canonical form.
  const normalized = signedAmount === 0 ? 0 : signedAmount;
  return normalized.toString();
}

// Explicit ordered-array serialization: order is fixed, so the pre-image is
// stable between runs regardless of object key ordering.
function canonicalPayload(parts: string[]): string {
  return JSON.stringify(parts);
}

async function sha256Hex(payload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined || typeof subtle.digest !== 'function') {
    throw new Error(WEB_CRYPTO_UNAVAILABLE_ERROR);
  }
  // TextEncoder always encodes UTF-8, matching the Node twin's explicit
  // 'utf8' digest input encoding.
  const bytes = new TextEncoder().encode(payload);
  const digest = await subtle.digest('SHA-256', bytes);
  return hexLowercase(new Uint8Array(digest));
}

function hexLowercase(bytes: Uint8Array): string {
  let hex = '';
  for (let index = 0; index < bytes.length; index++) {
    hex += bytes[index].toString(16).padStart(2, '0');
  }
  return hex;
}

function trimString(value: string): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}
