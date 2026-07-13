/**
 * Browser-only composition for Daily v2.
 *
 * Security boundaries:
 * - no Node-only import and no Supabase dependency;
 * - decoded CSV text and Excel bytes remain local and are never returned;
 * - accountFingerprint is trusted caller input and never derived from a masked account;
 * - the payload is built from an allow-listed shape and scanned for forbidden keys;
 * - source file name is used locally for CSV hints/extension checks, but is never persisted.
 */
import {
  parseStructuredBankStatementCsv,
  type StructuredBankStatementLine,
} from '@/services/structuredBankStatementCsvParser';
import {
  parseStructuredBankStatementExcel,
  type StructuredBankStatementExcelSourceFormat,
} from '@/services/structuredBankStatementExcelParser';
import {
  buildStructuredBankStatementDayContentHash,
  buildStructuredBankStatementDailyLineHash,
  buildStructuredBankStatementDayUnitId,
  buildStructuredBankStatementRawTextHash,
  isWebCryptoAvailableForStructuredBankStatementHashing,
  normalizeStructuredBankStatementDescriptionForHash,
} from '@/services/structuredBankStatementCsvBrowserIdempotencyKeys';
import { deriveStructuredBankStatementDailyAggregates } from '@/services/structuredBankStatementDailyAggregates';
import type {
  DailyV2ParserValidationStatus,
  DailyV2PreIngestPayload,
  DailyV2RequestedUnitStatus,
  DailyV2RpcLine,
  DailyV2RpcUnit,
} from './dailyV2Types';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ABSOLUTE_AMOUNT_CENTS = 100_000_000_000_000;
const MAX_DAILY_PERIOD_DAYS = 45;
const MAX_BACKFILL_PERIOD_DAYS = 4_000;
const MAX_BACKFILL_UNITS = 4_000;
const CSV_SOURCE_FORMAT = 'structured_bank_statement_csv';
const RUNTIME_VERSION = 'daily-v2-browser-0q';
const CSV_PARSER_VERSION = 'structured-csv-0b';
const CSV_BANKS: ReadonlySet<DailyV2SupportedBank> = new Set(['BDK', 'ORA']);
const EXCEL_BANKS: ReadonlySet<DailyV2SupportedBank> = new Set(['ATB', 'BICIS', 'BIS', 'BRIDGE']);
const MASKED_ACCOUNT_PATTERN = /^[*]+[0-9]{0,4}$/;
const TRUSTED_CURRENCY_PATTERN = /^[A-Z]{3}$/;
const BACKFILL_GRANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const STRICT_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const FORBIDDEN_KEYS = new Set([
  'rawcsv',
  'rawtext',
  'rawbytes',
  'rawcontent',
  'filecontent',
  'accountnumber',
  'iban',
  'decodedtext',
  'fulliban',
  'rawaccount',
  'accountnumberraw',
]);

export interface DailyV2BrowserFileLike {
  name: string;
  size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type DailyV2SupportedBank = 'BDK' | 'ORA' | 'ATB' | 'BICIS' | 'BIS' | 'BRIDGE';
export type DailyV2BrowserRequestedMode = 'daily' | 'backfill';

export interface PrepareDailyV2BrowserInput {
  file: DailyV2BrowserFileLike;
  bank: DailyV2SupportedBank;
  currency: string;
  accountFingerprint: string;
  exportReferenceDate?: string;
  requestedMode?: DailyV2BrowserRequestedMode;
  backfillGrantReference?: string;
}

export interface DailyV2SafeDiagnostic {
  sourceFileName: string;
  bank: DailyV2SupportedBank;
  currency: string;
  sourceFormat: typeof CSV_SOURCE_FORMAT | StructuredBankStatementExcelSourceFormat;
  requestedMode: DailyV2BrowserRequestedMode;
  accountNumberMasked: string | null;
  periodStart: string;
  periodEnd: string;
  statementDate: string | null;
  parserValidationStatus: DailyV2ParserValidationStatus;
  lineCount: number;
  unitsCount: number;
  provisionalUnitsCount: number;
  warnings: string[];
}

export type PrepareDailyV2BrowserResult =
  | {
      success: true;
      payload: DailyV2PreIngestPayload;
      diagnostic: DailyV2SafeDiagnostic;
      warnings: string[];
    }
  | {
      success: false;
      errors: string[];
      warnings: string[];
    };

interface DailyGroup {
  accountingDate: string;
  lines: StructuredBankStatementLine[];
}

interface DailyV2ParsedDocument {
  bankHint: string;
  currency?: string;
  accountNumberMasked?: string;
  periodStart?: string;
  periodEnd?: string;
  statementDate?: string;
  forceReviewAllUnits?: boolean;
  lines: StructuredBankStatementLine[];
  validation: {
    status: string;
    errors: string[];
    warnings: string[];
  };
  errors: string[];
  warnings: string[];
}

export async function prepareDailyV2BrowserDeposit(
  input: PrepareDailyV2BrowserInput,
): Promise<PrepareDailyV2BrowserResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const fileName = input.file.name.trim();
  const extension = fileExtension(fileName);
  const isCsv = extension === '.csv';
  const isExcel = extension === '.xls' || extension === '.xlsx';
  if (!isCsv && !isExcel) {
    return fail(['Only structured .csv, .xls and .xlsx files are supported.'], warnings);
  }
  if (typeof input.file.size === 'number' && input.file.size > MAX_FILE_BYTES) {
    return fail([`Source file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB safety limit.`], warnings);
  }
  if (isCsv && !CSV_BANKS.has(input.bank)) {
    return fail([`Bank ${input.bank} is not supported by the structured CSV profile family.`], warnings);
  }
  if (isCsv && fileName.toUpperCase().includes('BRIDGE')) {
    return fail(['BRIDGE-named CSV exports are refused; use the characterized XLSX profile.'], warnings);
  }
  if (isExcel && !EXCEL_BANKS.has(input.bank)) {
    return fail([`Bank ${input.bank} is not supported by the structured Excel profile family.`], warnings);
  }
  if (!isWebCryptoAvailableForStructuredBankStatementHashing()) {
    return fail(['Web Crypto is unavailable; Daily v2 hashing fails closed.'], warnings);
  }

  const bank = input.bank;
  const currency = input.currency.trim();
  const accountFingerprint = input.accountFingerprint.trim();
  const requestedMode = input.requestedMode ?? 'daily';
  const backfillGrantReference = input.backfillGrantReference?.trim();
  if (!TRUSTED_CURRENCY_PATTERN.test(currency)) {
    errors.push('currency must be a strict uppercase ISO-like three-letter code.');
  }
  if (accountFingerprint === '') {
    errors.push('accountFingerprint is required and is never derived from the masked account number.');
  }
  if (MASKED_ACCOUNT_PATTERN.test(accountFingerprint)) {
    errors.push('accountFingerprint must be an opaque pre-provisioned identifier, not a masked account label.');
  }
  if (requestedMode === 'daily' && backfillGrantReference) {
    errors.push('backfillGrantReference is forbidden in daily mode.');
  }
  if (requestedMode === 'backfill' && !backfillGrantReference) {
    errors.push('backfillGrantReference is mandatory in backfill mode.');
  }
  if (requestedMode === 'backfill' && bank !== 'BIS') {
    errors.push('Backfill mode is supported only for the characterized BIS profile in 0Q.');
  }
  if (
    requestedMode === 'backfill' &&
    backfillGrantReference &&
    !BACKFILL_GRANT_PATTERN.test(backfillGrantReference)
  ) {
    errors.push('backfillGrantReference must be a safe 1-200 character grant identifier.');
  }

  const exportReferenceDate = normalizeOptionalDate(
    input.exportReferenceDate,
    'exportReferenceDate',
    errors,
  );
  if (errors.length > 0) return fail(errors, warnings);

  let fileBuffer: ArrayBuffer;
  try {
    fileBuffer = await input.file.arrayBuffer();
  } catch {
    return fail(['Source file reading failed without exposing file content.'], warnings);
  }
  if (fileBuffer.byteLength > MAX_FILE_BYTES) {
    new Uint8Array(fileBuffer).fill(0);
    return fail([`Source file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB safety limit.`], warnings);
  }

  let document: DailyV2ParsedDocument;
  let rawTextHash: string;
  let sourceFormat: typeof CSV_SOURCE_FORMAT | StructuredBankStatementExcelSourceFormat;
  let parserVersion: string;
  try {
    if (isCsv) {
      const decodedText = new TextDecoder('windows-1252').decode(new Uint8Array(fileBuffer));
      document = parseStructuredBankStatementCsv(decodedText, { sourceFileName: fileName });
      rawTextHash = await buildStructuredBankStatementRawTextHash({ decodedText });
      sourceFormat = CSV_SOURCE_FORMAT;
      parserVersion = CSV_PARSER_VERSION;
    } else {
      if (!hasExpectedExcelSignature(new Uint8Array(fileBuffer), extension)) {
        new Uint8Array(fileBuffer).fill(0);
        return fail([`The ${extension} extension does not match the file signature.`], warnings);
      }
      rawTextHash = await buildRawBytesHash(fileBuffer);
      const excelDocument = parseStructuredBankStatementExcel(fileBuffer, {
        sourceFileName: fileName,
        expectedBank: bank as 'ATB' | 'BICIS' | 'BIS' | 'BRIDGE',
      });
      document = excelDocument;
      sourceFormat = excelDocument.sourceFormat;
      parserVersion = excelDocument.parserVersion;
    }
  } catch {
    new Uint8Array(fileBuffer).fill(0);
    return fail(['Structured file parsing or hashing failed without exposing file content.'], warnings);
  }
  new Uint8Array(fileBuffer).fill(0);

  collectUnique(warnings, document.warnings, document.validation.warnings);
  collectUnique(errors, document.errors, document.validation.errors);

  if (document.bankHint !== bank) {
    errors.push(
      `Trusted bank (${bank}) does not match the parser bank hint (${document.bankHint}); deposit refused.`,
    );
  }
  if (document.currency) {
    if (document.currency.trim() !== currency) {
      errors.push(
        `Trusted currency (${currency}) does not match the parsed currency (${document.currency}).`,
      );
    }
  } else if (document.forceReviewAllUnits !== true) {
    // Fail closed: only profiles that explicitly force review on every unit
    // (BRIDGE) may rely on the trusted operator currency alone.
    errors.push('Parsed document carries no verifiable currency; deposit refused.');
  }
  if (document.accountNumberMasked && !MASKED_ACCOUNT_PATTERN.test(document.accountNumberMasked)) {
    errors.push('Parsed account label does not satisfy the strict masked-account format.');
  }
  if (document.accountNumberMasked && document.accountNumberMasked === accountFingerprint) {
    errors.push('accountFingerprint must never reuse the masked account label.');
  }

  const parserStatusRaw = document.validation.status;
  if (parserStatusRaw !== 'valid' && parserStatusRaw !== 'needs_review') {
    errors.push(`Parser status "${parserStatusRaw}" is not depositable.`);
  }
  const parserStatus = parserStatusRaw as DailyV2ParserValidationStatus;

  const periodStart = requireStrictDate(document.periodStart, 'periodStart', errors);
  const periodEnd = requireStrictDate(document.periodEnd, 'periodEnd', errors);
  const statementDate = normalizeOptionalDate(document.statementDate, 'statementDate', errors) ?? null;
  const periodDays =
    periodStart && periodEnd ? inclusiveDayCount(periodStart, periodEnd, errors) : undefined;
  if (requestedMode === 'daily' && periodDays !== undefined && periodDays > MAX_DAILY_PERIOD_DAYS) {
    errors.push(
      `Export period spans ${periodDays} days, above the ${MAX_DAILY_PERIOD_DAYS}-day Daily v2 limit.`,
    );
  }
  if (
    requestedMode === 'backfill' &&
    periodDays !== undefined &&
    periodDays > MAX_BACKFILL_PERIOD_DAYS
  ) {
    errors.push(
      `Backfill period spans ${periodDays} days, above the ${MAX_BACKFILL_PERIOD_DAYS}-day structural limit.`,
    );
  }

  if (document.lines.length === 0) errors.push('At least one transaction line is required.');
  const groups = groupLinesByAccountingDate(document.lines, errors);
  if (requestedMode === 'backfill' && groups.length > MAX_BACKFILL_UNITS) {
    errors.push(`Backfill contains more than ${MAX_BACKFILL_UNITS} daily units.`);
  }
  if (errors.length > 0 || !periodStart || !periodEnd || periodDays === undefined) {
    return fail(errors, warnings);
  }

  const latestAccountingDate = groups.reduce(
    (latest, group) =>
      strictDateToUtc(group.accountingDate) > strictDateToUtc(latest)
        ? group.accountingDate
        : latest,
    groups[0].accountingDate,
  );

  const rpcUnits: DailyV2RpcUnit[] = [];
  const rpcLines: DailyV2RpcLine[] = [];

  try {
    for (const group of groups) {
      const dayUnitId = await buildStructuredBankStatementDayUnitId({
        bank,
        accountFingerprint,
        currency,
        accountingDate: group.accountingDate,
      });
      const ordinals = assignOccurrenceOrdinals(group.lines, currency);
      const unitLines: DailyV2RpcLine[] = [];

      for (let index = 0; index < group.lines.length; index++) {
        const line = group.lines[index];
        assertLinePayloadCoherence(line, index);
        const direction = line.direction as 'debit' | 'credit';
        const normalizedValueDate = line.valueDate === undefined
          ? undefined
          : assertStrictDate(line.valueDate, `lines[${index}].valueDate`);
        const dailyLineHash = await buildStructuredBankStatementDailyLineHash({
          dayUnitId,
          valueDate: normalizedValueDate,
          direction,
          signedAmount: line.signedAmount,
          currency,
          descriptionSanitized: line.descriptionSanitized,
          dailyOccurrenceOrdinal: ordinals[index],
        });

        unitLines.push({
          day_unit_id: dayUnitId,
          daily_line_hash: dailyLineHash,
          daily_occurrence_ordinal: ordinals[index],
          source_line_index: line.sourceRowIndex,
          accounting_date: group.accountingDate,
          value_date: normalizedValueDate ?? null,
          description_sanitized: line.descriptionSanitized,
          debit_amount: line.debit ?? null,
          credit_amount: line.credit ?? null,
          signed_amount: line.signedAmount,
          running_balance: line.balance ?? null,
          direction,
          currency,
        });
      }

      const aggregates = deriveStructuredBankStatementDailyAggregates(
        group.lines.map((line) => ({
          direction: line.direction,
          signedAmount: line.signedAmount,
          runningBalance: line.balance,
        })),
      );
      if (aggregates.errors.length > 0) {
        throw new Error(aggregates.errors.join(' '));
      }
      collectUnique(warnings, aggregates.warnings);

      const requestedStatus = resolveRequestedUnitStatus({
        bank,
        accountingDate: group.accountingDate,
        latestAccountingDate,
        exportReferenceDate,
      });
      const dayContentHash = await buildStructuredBankStatementDayContentHash({
        dayUnitId,
        dailyLineHashes: unitLines.map((line) => line.daily_line_hash),
      });

      rpcUnits.push({
        day_unit_id: dayUnitId,
        accounting_date: group.accountingDate,
        day_content_hash: dayContentHash,
        line_count: aggregates.lineCount,
        day_total_debits: aggregates.dayTotalDebits,
        day_total_credits: aggregates.dayTotalCredits,
        opening_balance_derived: aggregates.openingBalanceDerived ?? null,
        closing_balance_derived: aggregates.closingBalanceDerived ?? null,
        aggregates_status: aggregates.aggregatesStatus,
        validation_status: document.forceReviewAllUnits
          ? 'needs_review'
          : aggregates.validationStatus,
        requested_unit_status: requestedStatus,
      });
      rpcLines.push(...unitLines);
    }
  } catch (error) {
    return fail(
      [
        `Daily v2 composition failed: ${
          error instanceof Error ? error.message : 'unexpected controlled failure'
        }`,
      ],
      warnings,
    );
  }

  const payload: DailyV2PreIngestPayload = {
    p_attempt: {
      requested_mode: requestedMode,
      source_format: sourceFormat,
      bank,
      currency,
      account_fingerprint: accountFingerprint,
      account_number_masked: document.accountNumberMasked ?? null,
      source_file_name_redacted: null,
      raw_text_hash: rawTextHash,
      export_period_start: periodStart,
      export_period_end: periodEnd,
      statement_date: statementDate,
      export_reference_date: exportReferenceDate ?? null,
      parser_validation_status: parserStatus,
      errors_count: uniqueCount(document.errors, document.validation.errors),
      warnings_count: uniqueCount(document.warnings, document.validation.warnings),
      runtime_version: RUNTIME_VERSION,
      parser_version: parserVersion,
    },
    p_units: rpcUnits,
    p_lines: rpcLines,
    p_guard_context: {
      ingestion_ready: true,
      period_days: periodDays,
      bridge_guard_passed: true,
      backfill_grant_reference: requestedMode === 'backfill'
        ? (backfillGrantReference as string)
        : null,
    },
  };

  const forbiddenPaths = findForbiddenKeyPaths(payload);
  if (forbiddenPaths.length > 0) {
    return fail(
      forbiddenPaths.map((path) => `Forbidden key detected in outgoing payload at ${path}.`),
      warnings,
    );
  }

  return {
    success: true,
    payload,
    diagnostic: {
      sourceFileName: fileName,
      bank,
      currency,
      sourceFormat,
      requestedMode,
      accountNumberMasked: document.accountNumberMasked ?? null,
      periodStart,
      periodEnd,
      statementDate,
      parserValidationStatus: parserStatus,
      lineCount: rpcLines.length,
      unitsCount: rpcUnits.length,
      provisionalUnitsCount: rpcUnits.filter(
        (unit) => unit.requested_unit_status === 'provisional',
      ).length,
      warnings: [...warnings],
    },
    warnings,
  };
}

function assertLinePayloadCoherence(line: StructuredBankStatementLine, index: number): void {
  if (!Number.isInteger(line.sourceRowIndex) || line.sourceRowIndex < 0) {
    throw new Error(`line ${index} has an invalid sourceRowIndex.`);
  }
  if (line.direction !== 'debit' && line.direction !== 'credit') {
    throw new Error(`line ${index} has an unmappable direction.`);
  }
  if (line.descriptionSanitized.trim() === '') {
    throw new Error(`line ${index} has an empty sanitized description.`);
  }
  if (!isStrictAmount(line.signedAmount)) {
    throw new Error(`line ${index} has an invalid signedAmount.`);
  }
  if (line.balance !== undefined && !isStrictAmount(line.balance)) {
    throw new Error(`line ${index} has an invalid running balance.`);
  }

  const debitCoherent =
    line.direction === 'debit' &&
    line.debit !== undefined &&
    isStrictAmount(line.debit) &&
    line.debit > 0 &&
    line.credit === undefined &&
    line.signedAmount < 0 &&
    Math.abs(line.signedAmount) === line.debit;
  const creditCoherent =
    line.direction === 'credit' &&
    line.credit !== undefined &&
    isStrictAmount(line.credit) &&
    line.credit > 0 &&
    line.debit === undefined &&
    line.signedAmount > 0 &&
    line.signedAmount === line.credit;
  if (!debitCoherent && !creditCoherent) {
    throw new Error(`line ${index} violates direction/amount/sign coherence.`);
  }
}

function assertStrictDate(value: string, label: string): string {
  const errors: string[] = [];
  const normalized = requireStrictDate(value, label, errors);
  if (!normalized) throw new Error(errors[0] ?? `${label} is invalid.`);
  return normalized;
}

function isStrictAmount(value: number): boolean {
  const cents = Math.round(value * 100);
  return Number.isFinite(value) &&
    Number.isSafeInteger(cents) &&
    Math.abs(cents) <= MAX_ABSOLUTE_AMOUNT_CENTS &&
    Math.abs(value * 100 - cents) <= 1e-7 &&
    /^-?\d{1,13}(\.\d{1,2})?$/.test(String(value));
}

function groupLinesByAccountingDate(
  lines: StructuredBankStatementLine[],
  errors: string[],
): DailyGroup[] {
  const groups = new Map<string, StructuredBankStatementLine[]>();
  lines.forEach((line, index) => {
    const accountingDate = requireStrictDate(
      line.operationDate,
      `lines[${index}].operationDate`,
      errors,
    );
    if (!accountingDate) return;
    if (line.direction !== 'debit' && line.direction !== 'credit') {
      errors.push(`lines[${index}].direction is not debit or credit.`);
      return;
    }
    const current = groups.get(accountingDate) ?? [];
    current.push(line);
    groups.set(accountingDate, current);
  });

  return Array.from(groups.entries())
    .sort((a, b) => strictDateToUtc(a[0]) - strictDateToUtc(b[0]))
    .map(([accountingDate, groupedLines]) => ({ accountingDate, lines: groupedLines }));
}

function assignOccurrenceOrdinals(
  lines: StructuredBankStatementLine[],
  currency: string,
): number[] {
  const counts = new Map<string, number>();
  return lines.map((line) => {
    const amount = (line.signedAmount === 0 ? 0 : line.signedAmount).toString();
    const key = JSON.stringify([
      line.operationDate?.trim() ?? '',
      line.valueDate?.trim() ?? '',
      line.direction,
      amount,
      currency,
      normalizeStructuredBankStatementDescriptionForHash(line.descriptionSanitized),
    ]);
    const ordinal = (counts.get(key) ?? 0) + 1;
    counts.set(key, ordinal);
    return ordinal;
  });
}

function resolveRequestedUnitStatus(input: {
  bank: DailyV2SupportedBank;
  accountingDate: string;
  latestAccountingDate: string;
  exportReferenceDate?: string;
}): DailyV2RequestedUnitStatus {
  if (input.exportReferenceDate) {
    return strictDateToUtc(input.accountingDate) >= strictDateToUtc(input.exportReferenceDate)
      ? 'provisional'
      : 'staged';
  }
  if (input.bank === 'ORA' && input.accountingDate === input.latestAccountingDate) {
    return 'provisional';
  }
  return 'staged';
}

function fileExtension(fileName: string): string {
  const lower = fileName.trim().toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

function hasExpectedExcelSignature(bytes: Uint8Array, extension: string): boolean {
  if (extension === '.xls') {
    const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return cfb.every((value, index) => bytes[index] === value);
  }
  if (extension === '.xlsx') {
    return bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08));
  }
  return false;
}

async function buildRawBytesHash(buffer: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeOptionalDate(
  value: string | undefined,
  label: string,
  errors: string[],
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return requireStrictDate(trimmed, label, errors);
}

function requireStrictDate(
  value: string | undefined,
  label: string,
  errors: string[],
): string | undefined {
  const trimmed = value?.trim() ?? '';
  const match = STRICT_DATE_PATTERN.exec(trimmed);
  if (!match) {
    errors.push(`${label} must be a strict DD/MM/YYYY date.`);
    return undefined;
  }
  const utc = Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== Number(match[3]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[1])
  ) {
    errors.push(`${label} must be a real calendar date.`);
    return undefined;
  }
  return trimmed;
}

function strictDateToUtc(value: string): number {
  const match = STRICT_DATE_PATTERN.exec(value);
  if (!match) throw new Error('Internal strict-date invariant failed.');
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function inclusiveDayCount(start: string, end: string, errors: string[]): number | undefined {
  const startUtc = strictDateToUtc(start);
  const endUtc = strictDateToUtc(end);
  if (endUtc < startUtc) {
    errors.push('periodEnd must not be earlier than periodStart.');
    return undefined;
  }
  return Math.round((endUtc - startUtc) / 86_400_000) + 1;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findForbiddenKeyPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenKeyPaths(entry, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') return [];

  const paths: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) paths.push(`${path}.${key}`);
    paths.push(...findForbiddenKeyPaths(nested, `${path}.${key}`));
  }
  return paths;
}

function collectUnique(target: string[], ...sources: Array<readonly string[] | undefined>): void {
  const seen = new Set(target);
  for (const source of sources) {
    for (const value of source ?? []) {
      if (!seen.has(value)) {
        target.push(value);
        seen.add(value);
      }
    }
  }
}

function uniqueCount(...sources: Array<readonly string[] | undefined>): number {
  const values = new Set<string>();
  for (const source of sources) {
    for (const value of source ?? []) values.add(value);
  }
  return values.size;
}

function fail(errors: string[], warnings: string[]): PrepareDailyV2BrowserResult {
  return { success: false, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
