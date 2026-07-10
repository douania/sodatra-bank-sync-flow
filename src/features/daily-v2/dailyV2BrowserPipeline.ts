/**
 * Browser-only composition for Daily v2.
 *
 * Security boundaries:
 * - no Node-only import and no Supabase dependency;
 * - the decoded CSV remains a local variable and is never returned;
 * - accountFingerprint is trusted caller input and never derived from a masked account;
 * - the payload is built from an allow-listed shape and scanned for forbidden keys;
 * - source file name is used locally for parser bank detection, but is never persisted.
 */
import {
  parseStructuredBankStatementCsv,
  type StructuredBankStatementDocument,
  type StructuredBankStatementLine,
} from '@/services/structuredBankStatementCsvParser';
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
const MAX_DAILY_PERIOD_DAYS = 45;
const SOURCE_FORMAT = 'structured_bank_statement_csv';
const RUNTIME_VERSION = 'daily-v2-browser-0n';
const PARSER_VERSION = 'structured-csv-0b';
const MASKED_ACCOUNT_PATTERN = /^[*]+[0-9]{0,4}$/;
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

export interface PrepareDailyV2BrowserInput {
  file: DailyV2BrowserFileLike;
  bank: 'BDK' | 'ORA';
  currency: string;
  accountFingerprint: string;
  exportReferenceDate?: string;
}

export interface DailyV2SafeDiagnostic {
  sourceFileName: string;
  bank: 'BDK' | 'ORA';
  currency: string;
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

export async function prepareDailyV2BrowserDeposit(
  input: PrepareDailyV2BrowserInput,
): Promise<PrepareDailyV2BrowserResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const fileName = input.file.name.trim();
  if (!fileName.toLowerCase().endsWith('.csv')) {
    return fail(['Only .csv files are supported for Daily v2 deposits.'], warnings);
  }
  if (typeof input.file.size === 'number' && input.file.size > MAX_FILE_BYTES) {
    return fail([`CSV file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB safety limit.`], warnings);
  }
  if (fileName.toUpperCase().includes('BRIDGE')) {
    return fail(['BRIDGE-named exports are refused on the structured Daily v2 path.'], warnings);
  }
  if (!isWebCryptoAvailableForStructuredBankStatementHashing()) {
    return fail(['Web Crypto is unavailable; Daily v2 hashing fails closed.'], warnings);
  }

  const bank = input.bank;
  const currency = input.currency.trim();
  const accountFingerprint = input.accountFingerprint.trim();
  if (currency === '') errors.push('currency is required.');
  if (accountFingerprint === '') {
    errors.push('accountFingerprint is required and is never derived from the masked account number.');
  }
  if (MASKED_ACCOUNT_PATTERN.test(accountFingerprint)) {
    errors.push('accountFingerprint must be an opaque pre-provisioned identifier, not a masked account label.');
  }

  const exportReferenceDate = normalizeOptionalDate(
    input.exportReferenceDate,
    'exportReferenceDate',
    errors,
  );
  if (errors.length > 0) return fail(errors, warnings);

  let decodedText: string;
  try {
    const bytes = await input.file.arrayBuffer();
    decodedText = new TextDecoder('windows-1252').decode(new Uint8Array(bytes));
  } catch {
    return fail(['CSV decoding failed without exposing file content.'], warnings);
  }

  let document: StructuredBankStatementDocument;
  let rawTextHash: string;
  try {
    document = parseStructuredBankStatementCsv(decodedText, { sourceFileName: fileName });
    rawTextHash = await buildStructuredBankStatementRawTextHash({ decodedText });
  } catch {
    decodedText = '';
    return fail(['Structured CSV parsing or hashing failed without exposing file content.'], warnings);
  }
  decodedText = '';

  collectUnique(warnings, document.warnings, document.validation.warnings);
  collectUnique(errors, document.errors, document.validation.errors);

  if (document.bankHint !== bank) {
    errors.push(
      `Trusted bank (${bank}) does not match the parser bank hint (${document.bankHint}); deposit refused.`,
    );
  }
  if (document.currency?.trim() !== currency) {
    errors.push(
      `Trusted currency (${currency}) does not match the parsed currency (${document.currency ?? 'missing'}).`,
    );
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
  if (periodDays !== undefined && periodDays > MAX_DAILY_PERIOD_DAYS) {
    errors.push(
      `Export period spans ${periodDays} days, above the ${MAX_DAILY_PERIOD_DAYS}-day Daily v2 limit.`,
    );
  }

  if (document.lines.length === 0) errors.push('At least one transaction line is required.');
  const groups = groupLinesByAccountingDate(document.lines, errors);
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
        validation_status: aggregates.validationStatus,
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
      requested_mode: 'daily',
      source_format: SOURCE_FORMAT,
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
      parser_version: PARSER_VERSION,
    },
    p_units: rpcUnits,
    p_lines: rpcLines,
    p_guard_context: {
      ingestion_ready: true,
      period_days: periodDays,
      bridge_guard_passed: true,
      backfill_grant_reference: null,
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
  return Number.isFinite(value) && /^-?\d{1,16}(\.\d{1,2})?$/.test(String(value));
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
  bank: 'BDK' | 'ORA';
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
