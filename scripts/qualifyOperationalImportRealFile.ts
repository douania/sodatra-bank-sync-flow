import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as XLSX from 'xlsx';

import { reconstructPdfTextLines } from '../src/services/pdfTextLineReconstruction';
import {
  qualifyOperationalImportRealFileText,
  type RealFileQualificationFamily,
  type RealFileQualificationFormat,
} from '../src/services/operationalImportRealFileQualification';

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_PDF_PAGES = 200;
const MAX_PDF_TEXT_ITEMS = 200_000;
const MAX_WORKBOOK_SHEETS = 50;
const MAX_EXCEL_ROWS_PER_SHEET = 20_000;
const MAX_EXCEL_COLUMNS_PER_ROW = 512;
const MAX_EXCEL_CELLS = 1_000_000;
const MAX_EXTRACTED_TEXT_CHARACTERS = 2_000_000;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FAMILIES = new Set<RealFileQualificationFamily>([
  'BDK',
  'ATB',
  'BICIS',
  'ORA',
  'SGBS',
  'BIS',
  'FUND_POSITION',
]);

type QualificationCliErrorCode =
  | 'CLI_USAGE_INVALID'
  | 'ANONYMIZATION_ATTESTATION_REQUIRED'
  | 'INPUT_PATH_MUST_BE_ABSOLUTE'
  | 'INPUT_PATH_MUST_BE_OUTSIDE_REPOSITORY'
  | 'INPUT_FILE_UNREADABLE'
  | 'INPUT_FILE_NOT_REGULAR'
  | 'INPUT_FILE_EMPTY'
  | 'INPUT_FILE_TOO_LARGE'
  | 'INPUT_FORMAT_UNSUPPORTED'
  | 'INPUT_FILE_SIGNATURE_MISMATCH'
  | 'DOCUMENT_TEXT_EXTRACTION_FAILED'
  | 'DOCUMENT_RESOURCE_LIMIT_EXCEEDED'
  | 'QUALIFICATION_RUNTIME_FAILED';

interface QualificationCliArguments {
  family: RealFileQualificationFamily;
  caseId: string;
  inputPath: string;
  anonymizationAttested: true;
}

interface QualificationCliFailure {
  schemaVersion: 1;
  success: false;
  decision: 'FAIL_CLOSED';
  errorCode: QualificationCliErrorCode;
  containsRawBankingData: false;
  persistenceAttempted: false;
  environmentAccessed: false;
  promotionAuthorized: false;
}

export class QualificationCliError extends Error {
  constructor(readonly code: QualificationCliErrorCode) {
    super(code);
    this.name = 'QualificationCliError';
  }
}

function optionValue(argv: readonly string[], option: string): string | undefined {
  const index = argv.indexOf(option);
  if (index === -1) return undefined;
  if (argv.indexOf(option, index + 1) !== -1) throw new QualificationCliError('CLI_USAGE_INVALID');
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new QualificationCliError('CLI_USAGE_INVALID');
  return value;
}

export function parseQualificationCliArguments(argv: readonly string[]): QualificationCliArguments {
  const allowedOptions = new Set(['--family', '--case-id', '--file', '--anonymized']);
  for (const argument of argv) {
    if (argument.startsWith('--') && !allowedOptions.has(argument)) {
      throw new QualificationCliError('CLI_USAGE_INVALID');
    }
  }

  if (!argv.includes('--anonymized')) {
    throw new QualificationCliError('ANONYMIZATION_ATTESTATION_REQUIRED');
  }
  if (argv.filter(argument => argument === '--anonymized').length !== 1) {
    throw new QualificationCliError('CLI_USAGE_INVALID');
  }

  const rawFamily = optionValue(argv, '--family')?.toUpperCase();
  const caseId = optionValue(argv, '--case-id');
  const inputPath = optionValue(argv, '--file');
  if (!rawFamily || !FAMILIES.has(rawFamily as RealFileQualificationFamily) || !caseId || !inputPath) {
    throw new QualificationCliError('CLI_USAGE_INVALID');
  }
  if (!/^[A-Z0-9][A-Z0-9_-]{2,40}$/.test(caseId)) {
    throw new QualificationCliError('CLI_USAGE_INVALID');
  }
  if (!isAbsolute(inputPath)) {
    throw new QualificationCliError('INPUT_PATH_MUST_BE_ABSOLUTE');
  }

  return {
    family: rawFamily as RealFileQualificationFamily,
    caseId,
    inputPath,
    anonymizationAttested: true,
  };
}

export function isPathInsideRepository(candidatePath: string, repositoryRoot = REPOSITORY_ROOT): boolean {
  const relation = relative(resolve(repositoryRoot), resolve(candidatePath));
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function qualificationFormat(inputPath: string): RealFileQualificationFormat {
  const extension = extname(inputPath).toLowerCase();
  if (extension === '.pdf') return 'PDF';
  if (extension === '.xlsx') return 'XLSX';
  if (extension === '.xls') return 'XLS';
  throw new QualificationCliError('INPUT_FORMAT_UNSUPPORTED');
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function hasValidDocumentSignature(
  bytes: Uint8Array,
  format: RealFileQualificationFormat,
): boolean {
  if (format === 'PDF') return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (format === 'XLSX') return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
  return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function assertZipArchiveWithinLimits(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdLength = 22;
  const earliestEocdOffset = Math.max(0, bytes.byteLength - minimumEocdLength - 65_535);
  let eocdOffset = -1;

  for (let offset = bytes.byteLength - minimumEocdLength; offset >= earliestEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new QualificationCliError('INPUT_FILE_SIGNATURE_MISMATCH');

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const commentLength = view.getUint16(eocdOffset + 20, true);

  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || entriesOnDisk !== totalEntries
    || totalEntries === 0
    || totalEntries === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
    || totalEntries > MAX_ZIP_ENTRIES
    || eocdOffset + minimumEocdLength + commentLength !== bytes.byteLength
    || centralDirectoryOffset + centralDirectorySize > eocdOffset
  ) {
    throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
  }

  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
    if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new QualificationCliError('INPUT_FILE_SIGNATURE_MISMATCH');
    }

    const flags = view.getUint16(cursor + 8, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    if ((flags & 0x1) !== 0 || uncompressedSize === 0xffffffff) {
      throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
    }
    cursor += 46 + fileNameLength + extraLength + entryCommentLength;
  }

  if (cursor !== centralDirectoryOffset + centralDirectorySize) {
    throw new QualificationCliError('INPUT_FILE_SIGNATURE_MISMATCH');
  }
}

interface BoundedTextAccumulator {
  parts: string[];
  length: number;
}

function appendTextWithinLimit(accumulator: BoundedTextAccumulator, addition: string): void {
  if (accumulator.length + addition.length > MAX_EXTRACTED_TEXT_CHARACTERS) {
    throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
  }
  accumulator.parts.push(addition);
  accumulator.length += addition.length;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise.catch(async (error: unknown) => {
    await loadingTask.destroy();
    throw error;
  });
  const text: BoundedTextAccumulator = { parts: [], length: 0 };
  let textItemCount = 0;

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
    }
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        textItemCount += content.items.length;
        if (textItemCount > MAX_PDF_TEXT_ITEMS) {
          throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
        }
        appendTextWithinLimit(text, `${reconstructPdfTextLines(content.items)}\n`);
      } finally {
        page.cleanup();
      }
    }
    return text.parts.join('');
  } finally {
    await pdf.destroy();
  }
}

function extractExcelText(bytes: Uint8Array): string {
  const workbook = XLSX.read(bytes, {
    type: 'array',
    raw: false,
    cellDates: false,
    sheetRows: MAX_EXCEL_ROWS_PER_SHEET + 1,
  });
  if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) {
    throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
  }
  const text: BoundedTextAccumulator = { parts: [], length: 0 };
  let declaredCellCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const fullReference = (
      worksheet as XLSX.WorkSheet & { '!fullref'?: string }
    )['!fullref'] ?? worksheet['!ref'];
    const declaredRange = fullReference ? XLSX.utils.decode_range(fullReference) : null;
    if (declaredRange) {
      const declaredRows = declaredRange.e.r - declaredRange.s.r + 1;
      const declaredColumns = declaredRange.e.c - declaredRange.s.c + 1;
      declaredCellCount += declaredRows * declaredColumns;
      if (
        declaredRows > MAX_EXCEL_ROWS_PER_SHEET
        || declaredColumns > MAX_EXCEL_COLUMNS_PER_ROW
        || declaredCellCount > MAX_EXCEL_CELLS
      ) {
        throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
      }
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: '',
    });
    if (rows.length > MAX_EXCEL_ROWS_PER_SHEET) {
      throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
    }
    for (const row of rows) {
      if (row.length > MAX_EXCEL_COLUMNS_PER_ROW) {
        throw new QualificationCliError('DOCUMENT_RESOURCE_LIMIT_EXCEEDED');
      }
      appendTextWithinLimit(text, `${row.map(value => String(value)).join('\t')}\n`);
    }
  }
  return text.parts.join('');
}

async function extractDocumentText(
  bytes: Uint8Array,
  format: RealFileQualificationFormat,
): Promise<string> {
  return format === 'PDF' ? extractPdfText(bytes) : extractExcelText(bytes);
}

async function readBoundedRegularFile(canonicalInputPath: string): Promise<Uint8Array> {
  const metadata = await stat(canonicalInputPath).catch(() => {
    throw new QualificationCliError('INPUT_FILE_UNREADABLE');
  });
  if (!metadata.isFile()) throw new QualificationCliError('INPUT_FILE_NOT_REGULAR');
  if (metadata.size === 0) throw new QualificationCliError('INPUT_FILE_EMPTY');
  if (metadata.size > MAX_INPUT_BYTES) throw new QualificationCliError('INPUT_FILE_TOO_LARGE');

  const handle = await open(canonicalInputPath, 'r').catch(() => {
    throw new QualificationCliError('INPUT_FILE_UNREADABLE');
  });
  try {
    const openedMetadata = await handle.stat();
    if (!openedMetadata.isFile()) throw new QualificationCliError('INPUT_FILE_NOT_REGULAR');
    if (openedMetadata.size !== metadata.size) throw new QualificationCliError('INPUT_FILE_UNREADABLE');

    const bytes = Buffer.alloc(metadata.size + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_INPUT_BYTES) throw new QualificationCliError('INPUT_FILE_TOO_LARGE');
    if (offset !== metadata.size) throw new QualificationCliError('INPUT_FILE_UNREADABLE');
    return new Uint8Array(bytes.buffer, bytes.byteOffset, offset);
  } finally {
    await handle.close();
  }
}

function failure(errorCode: QualificationCliErrorCode): QualificationCliFailure {
  return {
    schemaVersion: 1,
    success: false,
    decision: 'FAIL_CLOSED',
    errorCode,
    containsRawBankingData: false,
    persistenceAttempted: false,
    environmentAccessed: false,
    promotionAuthorized: false,
  };
}

async function withMutedConsole<T>(operation: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const muted = (): void => undefined;

  console.log = muted;
  console.info = muted;
  console.warn = muted;
  console.error = muted;
  try {
    return await operation();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

export async function runQualificationCli(
  argv: readonly string[],
  writeOutput: (payload: string) => void = payload => process.stdout.write(payload),
): Promise<number> {
  try {
    const args = parseQualificationCliArguments(argv);
    const canonicalRepositoryRoot = await realpath(REPOSITORY_ROOT).catch(() => {
      throw new QualificationCliError('QUALIFICATION_RUNTIME_FAILED');
    });
    if (
      isPathInsideRepository(args.inputPath, REPOSITORY_ROOT)
      || isPathInsideRepository(args.inputPath, canonicalRepositoryRoot)
    ) {
      throw new QualificationCliError('INPUT_PATH_MUST_BE_OUTSIDE_REPOSITORY');
    }
    const canonicalInputPath = await realpath(args.inputPath).catch(() => {
      throw new QualificationCliError('INPUT_FILE_UNREADABLE');
    });
    if (
      isPathInsideRepository(canonicalInputPath, REPOSITORY_ROOT)
      || isPathInsideRepository(canonicalInputPath, canonicalRepositoryRoot)
    ) {
      throw new QualificationCliError('INPUT_PATH_MUST_BE_OUTSIDE_REPOSITORY');
    }

    const format = qualificationFormat(canonicalInputPath);
    const inputBytes = await readBoundedRegularFile(canonicalInputPath);
    if (!hasValidDocumentSignature(inputBytes, format)) {
      throw new QualificationCliError('INPUT_FILE_SIGNATURE_MISMATCH');
    }
    if (format === 'XLSX') assertZipArchiveWithinLimits(inputBytes);

    const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
    const result = await withMutedConsole(async () => {
      let extractedText: string;
      try {
        extractedText = await extractDocumentText(inputBytes, format);
      } catch (error) {
        if (error instanceof QualificationCliError) throw error;
        throw new QualificationCliError('DOCUMENT_TEXT_EXTRACTION_FAILED');
      }
      return qualifyOperationalImportRealFileText({
        caseId: args.caseId,
        family: args.family,
        format,
        sourceFileName: basename(canonicalInputPath),
        extractedText,
        inputSha256,
        byteLength: inputBytes.byteLength,
      });
    });

    writeOutput(`${JSON.stringify(result, null, 2)}\n`);
    return result.success ? 0 : 1;
  } catch (error) {
    const code = error instanceof QualificationCliError ? error.code : 'QUALIFICATION_RUNTIME_FAILED';
    writeOutput(`${JSON.stringify(failure(code), null, 2)}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  process.exitCode = await runQualificationCli(process.argv.slice(2));
}
