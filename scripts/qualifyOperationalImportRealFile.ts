import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as XLSX from 'xlsx';

import { reconstructPdfTextLines } from '../src/services/pdfTextLineReconstruction';
import {
  qualifyOperationalImportRealFileText,
  type RealFileQualificationFamily,
  type RealFileQualificationFormat,
} from '../src/services/operationalImportRealFileQualification';

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
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
  | 'INPUT_FILE_EMPTY'
  | 'INPUT_FILE_TOO_LARGE'
  | 'INPUT_FORMAT_UNSUPPORTED'
  | 'DOCUMENT_TEXT_EXTRACTION_FAILED'
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

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  let text = '';

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    text += `${reconstructPdfTextLines(content.items)}\n`;
  }
  return text;
}

function extractExcelText(bytes: Uint8Array): string {
  const workbook = XLSX.read(bytes, { type: 'array', raw: false, cellDates: false });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: '',
    });
    for (const row of rows) lines.push(row.map(value => String(value)).join('\t'));
  }
  return lines.join('\n');
}

async function extractDocumentText(
  bytes: Uint8Array,
  format: RealFileQualificationFormat,
): Promise<string> {
  return format === 'PDF' ? extractPdfText(bytes) : extractExcelText(bytes);
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

export async function runQualificationCli(argv: readonly string[]): Promise<number> {
  try {
    const args = parseQualificationCliArguments(argv);
    const canonicalInputPath = await realpath(args.inputPath).catch(() => {
      throw new QualificationCliError('INPUT_FILE_UNREADABLE');
    });
    if (isPathInsideRepository(canonicalInputPath)) {
      throw new QualificationCliError('INPUT_PATH_MUST_BE_OUTSIDE_REPOSITORY');
    }

    const format = qualificationFormat(canonicalInputPath);
    const inputBytes = await readFile(canonicalInputPath).catch(() => {
      throw new QualificationCliError('INPUT_FILE_UNREADABLE');
    });
    if (inputBytes.byteLength === 0) throw new QualificationCliError('INPUT_FILE_EMPTY');
    if (inputBytes.byteLength > MAX_INPUT_BYTES) throw new QualificationCliError('INPUT_FILE_TOO_LARGE');

    const inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
    const result = await withMutedConsole(async () => {
      const extractedText = await extractDocumentText(new Uint8Array(inputBytes), format)
        .catch(() => {
          throw new QualificationCliError('DOCUMENT_TEXT_EXTRACTION_FAILED');
        });
      return qualifyOperationalImportRealFileText({
        caseId: args.caseId,
        family: args.family,
        format,
        extractedText,
        inputSha256,
        byteLength: inputBytes.byteLength,
      });
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.success ? 0 : 1;
  } catch (error) {
    const code = error instanceof QualificationCliError ? error.code : 'QUALIFICATION_RUNTIME_FAILED';
    process.stdout.write(`${JSON.stringify(failure(code), null, 2)}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  process.exitCode = await runQualificationCli(process.argv.slice(2));
}
