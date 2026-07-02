/**
 * Pure idempotency-key helper for structured bank statement CSV exports
 * (POC-BANK-STRUCTURED-EXPORTS-0H-patch).
 *
 * Scope and hard boundaries (deliberately not crossed here):
 *  - These functions are PURE: no I/O, no decoding, no database access, no
 *    runtime wiring. They only turn already-available, already-decoded values
 *    into deterministic hashes.
 *  - No system clock, no UUID, no Math.random, no timestamp: identical inputs
 *    always produce identical outputs, across runs and machines.
 *  - `sourceFileName` never feeds any hash (it changes daily for the same
 *    statement). `sourceRowIndex` never feeds a `lineHash` (it depends on the
 *    physical CSV layout: blank rows, footnotes, balance rows).
 *
 * Doctrine (validated):
 *  - rawTextHash = exact fingerprint of the decoded CSV text, minimally
 *    normalized. Any real change in the text must change the hash.
 *  - importId    = logical identity of the statement, independent of the file
 *    name and independent of rawTextHash.
 *  - lineHash    = logical identity of one transaction line, independent of
 *    sourceRowIndex.
 *
 * Hashing uses the Node standard `node:crypto` SHA-256, hex lowercase, no
 * external dependency.
 */

import { createHash } from 'node:crypto';

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

// Domain-separation tags: a fixed literal prefix keeps the pre-image of one hash
// family from ever colliding with another (e.g. an importId payload can never
// equal a lineHash payload). They are constants, so hashing stays deterministic.
const IMPORT_ID_DOMAIN = 'sodatra:structured_bank_statement_csv:import_id:v1';
const LINE_HASH_DOMAIN = 'sodatra:structured_bank_statement_csv:line_hash:v1';

// No-break space (U+00A0) and narrow no-break space (U+202F): folded to a plain
// space before whitespace collapsing so a re-export that swaps one for the other
// keeps the same line identity. Built from explicit escapes (ASCII-only source).
const NON_BREAKING_SPACES = new RegExp('[\\u00A0\\u202F]', 'g');

// Byte-order mark (U+FEFF): a single leading occurrence is stripped from the
// decoded text before hashing.
const BYTE_ORDER_MARK = 0xfeff;

/**
 * rawTextHash: exact fingerprint of the decoded CSV text.
 *
 * The input is the text already decoded from Windows-1252 by the runtime
 * boundary. Only a minimal, lossless normalization is applied (BOM + line
 * endings) so that a byte-identical re-export yields the same hash while any
 * genuine content change is preserved.
 */
export function buildStructuredBankStatementRawTextHash(
  input: BuildStructuredBankStatementRawTextHashInput
): string {
  const normalized = normalizeStructuredBankStatementDecodedTextForHash(input.decodedText);
  return sha256Hex(normalized);
}

/**
 * importId: logical identity of a statement.
 *
 * Deterministic over (sourceFormat, bank, accountFingerprint, periodStart,
 * periodEnd). It never includes the file name nor rawTextHash, so the same
 * logical statement re-exported (even with formatting differences) keeps the
 * same importId. Every component is mandatory and fail-closed once trimmed;
 * `accountFingerprint` in particular has no silent fallback on the low-entropy
 * masked account number.
 */
export function buildStructuredBankStatementImportId(
  input: BuildStructuredBankStatementImportIdInput
): string {
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
 * The occurrenceOrdinal disambiguates genuinely identical lines within a single
 * statement without reintroducing a dependency on the physical row order.
 */
export function buildStructuredBankStatementLineHash(
  input: BuildStructuredBankStatementLineHashInput
): string {
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

function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function trimString(value: string): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}
