/**
 * Node-only runtime boundary for structured bank statement CSV pre-ingestion
 * (POC-BANK-STRUCTURED-EXPORTS-0M).
 *
 * This module is the Node twin of the browser diagnostic boundary (0E): a
 * THIN shell whose only jobs are to:
 *  - fail closed on anything that is not a `.csv` file name, BEFORE any byte
 *    is decoded,
 *  - decode the raw bytes as Windows-1252 at this runtime boundary only,
 *  - delegate to the pure 0I composition `prepareStructuredBankStatementCsvIngestion`,
 *  - return a SAFE, pre-DB result that never surfaces the decoded CSV text.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - NODE-ONLY: this module transitively imports `node:crypto` through the
 *    pre-ingestion layer. It must NEVER be imported from a page, a component
 *    or any other browser-bundled chain.
 *  - No database, no Supabase, no RLS, no UI, no upload wiring, no logging.
 *  - The decoded text is a local variable of this module and is never
 *    returned, never logged and never embedded in an error message.
 *  - Expected business rejections never throw: they come back as a controlled
 *    result. An unexpected throw from the pre-ingestion chain is converted
 *    into a controlled rejection carrying a non-sensitive reason.
 *  - The pre-ingestion `importResult` is forwarded by reference, untouched:
 *    this boundary never mutates it.
 */

import type { BankAccountStatementImportResult } from '@/types/bankAccountStatement';
import {
  prepareStructuredBankStatementCsvIngestion,
  type StructuredBankStatementCsvPreIngestionResult
} from './structuredBankStatementCsvPreIngestion';

export interface StructuredBankStatementCsvNodeIngestionRuntimeInput {
  sourceFileName: string;
  /** Raw, still-encoded CSV bytes; decoding happens only inside this module. */
  bytes: ArrayBuffer | Uint8Array;
  /** Trusted bank identity. Never inferred from the transactional body. */
  bank: 'BDK' | 'ORA';
  /**
   * Trusted account fingerprint, forwarded verbatim to the pre-ingestion
   * layer. Never derived here. Absent: no importId and no lineHash (0I rule).
   */
  accountFingerprint?: string;
  /** Trimmed; absent or blank falls back to `structured_bank_statement_csv`. */
  sourceFormat?: string;
  /** Forwarded to the pre-ingestion layer; defaults to `false` downstream. */
  includeNeedsReviewStatement?: boolean;
}

export interface StructuredBankStatementCsvNodeIngestionRuntimeResult {
  /** Mirrors the pre-ingestion success; always false for runtime rejections. */
  success: boolean;
  /** Fail-closed idempotency gate a future ingestion lot must gate on. */
  ingestionReady: boolean;
  /** Absent only when the input was rejected before decoding, or on an unexpected failure. */
  rawTextHash?: string;
  importId?: string;
  lineHashesApplied: boolean;
  /** Absent only when the pre-ingestion layer was never reached. */
  importResult?: BankAccountStatementImportResult;
  sourceFileName: string;
  /** The normalized sourceFormat that was fed to the pre-ingestion layer. */
  sourceFormat: string;
  /** Runtime/pre-ingestion-level errors; the adapter's own live in importResult. */
  errors: string[];
  warnings: string[];
  /** Always present when `success` or `ingestionReady` is false. */
  rejectedReason?: string;
  /** Marker that the decoded CSV text is never surfaced by this boundary. */
  rawContentHidden: true;
}

const DEFAULT_SOURCE_FORMAT = 'structured_bank_statement_csv';

const NON_CSV_REJECTED_REASON =
  'Only .csv files are accepted for structured bank statement pre-ingestion; the input was rejected before decoding.';

const UNEXPECTED_FAILURE_REASON =
  'Structured CSV pre-ingestion failed unexpectedly; the input was rejected without exposing its content.';

const NOT_INGESTION_READY_REASON =
  'Statement did not reach ingestionReady; see errors and warnings for the failed idempotency gate(s).';

/**
 * Prepare structured bank statement CSV bytes for a future ingestion, safely
 * and without any side effect.
 *
 * Fail-closed contract: a non-`.csv` file name is rejected BEFORE any byte is
 * decoded, so neither `rawTextHash` nor `importResult` exist for such inputs.
 */
export function prepareStructuredBankStatementCsvNodeIngestionRuntime(
  input: StructuredBankStatementCsvNodeIngestionRuntimeInput
): StructuredBankStatementCsvNodeIngestionRuntimeResult {
  const sourceFileName = input.sourceFileName;

  // Single normalization point, mirroring the pre-ingestion layer's own rule,
  // so the sourceFormat echoed here can never diverge from the one hashed into
  // the importId downstream.
  const sourceFormat = normalizeSourceFormat(input.sourceFormat);

  if (!isCsvFileName(sourceFileName)) {
    return {
      success: false,
      ingestionReady: false,
      lineHashesApplied: false,
      sourceFileName,
      sourceFormat,
      errors: [NON_CSV_REJECTED_REASON],
      warnings: [],
      rejectedReason: NON_CSV_REJECTED_REASON,
      rawContentHidden: true
    };
  }

  let preIngestion: StructuredBankStatementCsvPreIngestionResult;
  try {
    const decodedText = decodeWindows1252(input.bytes);
    preIngestion = prepareStructuredBankStatementCsvIngestion({
      decodedText,
      bank: input.bank,
      sourceFileName,
      sourceFormat,
      accountFingerprint: input.accountFingerprint,
      includeNeedsReviewStatement: input.includeNeedsReviewStatement
    });
  } catch {
    // The 0I layer is designed not to throw; anything reaching this catch is a
    // runtime defect (e.g. detached buffer). No-leak rule: the thrown error is
    // deliberately dropped — a future exception could embed decoded content or
    // a sensitive value, so only the fixed, non-sensitive reason is surfaced.
    return {
      success: false,
      ingestionReady: false,
      lineHashesApplied: false,
      sourceFileName,
      sourceFormat,
      errors: [UNEXPECTED_FAILURE_REASON],
      warnings: [],
      rejectedReason: UNEXPECTED_FAILURE_REASON,
      rawContentHidden: true
    };
  }

  return {
    success: preIngestion.success,
    ingestionReady: preIngestion.ingestionReady,
    rawTextHash: preIngestion.rawTextHash,
    importId: preIngestion.importId,
    lineHashesApplied: preIngestion.lineHashesApplied,
    importResult: preIngestion.importResult,
    sourceFileName,
    sourceFormat,
    errors: [...preIngestion.errors],
    warnings: [...preIngestion.warnings],
    rejectedReason: resolveRejectedReason(preIngestion),
    rawContentHidden: true
  };
}

function isCsvFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.csv');
}

// WHATWG Encoding Standard windows-1252 code points for bytes 0x80-0x9F; every
// other byte maps to the identical code point. Node's own
// `TextDecoder('windows-1252')` cannot be used here: its ICU-backed decoder maps
// the 0x80-0x9F range as identity (observed on Node 22 with full ICU: 0x8C ->
// U+008C instead of U+0152 'Œ'), diverging from the WHATWG table browsers
// follow. This boundary must decode identically across runtimes.
//
// Assumed deviation from the Unicode.org vendor table (CP1252.TXT): bytes 0x81,
// 0x8D, 0x8F, 0x90 and 0x9D are UNDEFINED there, while the WHATWG standard —
// and therefore every browser — maps them to the identical C1 control code
// points (U+0081, U+008D, U+008F, U+0090, U+009D). The WHATWG behaviour is
// deliberately chosen: it is lossless, never throws, and keeps this boundary
// byte-for-byte aligned with a browser `TextDecoder('windows-1252')`.
const WINDOWS_1252_C1_CODE_POINTS: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
];

const DECODE_CHUNK_SIZE = 8192;

function decodeWindows1252(bytes: ArrayBuffer | Uint8Array): string {
  // Structured exports are emitted as Windows-1252; decoding happens at this
  // Node runtime boundary only, never inside the pure layers below.
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const chunks: string[] = [];
  for (let start = 0; start < view.length; start += DECODE_CHUNK_SIZE) {
    const end = Math.min(start + DECODE_CHUNK_SIZE, view.length);
    const codePoints = new Array<number>(end - start);
    for (let index = start; index < end; index++) {
      const byte = view[index];
      codePoints[index - start] =
        byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_C1_CODE_POINTS[byte - 0x80] : byte;
    }
    chunks.push(String.fromCharCode(...codePoints));
  }
  return chunks.join('');
}

/**
 * rejectedReason contract: present whenever `success` or `ingestionReady` is
 * false — taken from the adapter's own rejection when it exists, otherwise a
 * controlled runtime reason (e.g. a valid statement missing its idempotency
 * components).
 */
function resolveRejectedReason(
  preIngestion: StructuredBankStatementCsvPreIngestionResult
): string | undefined {
  if (preIngestion.success && preIngestion.ingestionReady) {
    return undefined;
  }
  return preIngestion.importResult.rejectedReason ?? NOT_INGESTION_READY_REASON;
}

function normalizeSourceFormat(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_SOURCE_FORMAT;
  }
  const trimmed = value.trim();
  return trimmed === '' ? DEFAULT_SOURCE_FORMAT : trimmed;
}
