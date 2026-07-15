import * as XLSX from 'xlsx';
import type {
  StructuredBankStatementLine,
  StructuredBankStatementStatus,
  StructuredBankStatementValidation,
} from './structuredBankStatementCsvParser';
import {
  STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES,
  normalizeStructuredExcelHeader,
  type StructuredBankStatementExcelBank,
  type StructuredBankStatementExcelProfile,
} from './structuredBankStatementExcelProfiles';
import { prepareSafeStructuredXlsxArchive } from './structuredBankStatementXlsxArchive';

export const MAX_STRUCTURED_EXCEL_BYTES = 10 * 1024 * 1024;
export const MAX_STRUCTURED_EXCEL_SHEETS = 8;
export const MAX_STRUCTURED_EXCEL_ROWS = 20_000;
export const MAX_STRUCTURED_EXCEL_COLUMNS = 64;
export const MAX_STRUCTURED_EXCEL_CELLS = 250_000;

const HEADER_SCAN_ROWS = 60;
const STRICT_CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const EXCEL_1900_EPOCH_UTC = Date.UTC(1899, 11, 30);
const EXCEL_1904_EPOCH_UTC = Date.UTC(1904, 0, 1);
const MAX_ABSOLUTE_AMOUNT_CENTS = 100_000_000_000_000;

export type StructuredBankStatementExcelSourceFormat =
  | 'structured_bank_statement_xls'
  | 'structured_bank_statement_xlsx';

export interface StructuredBankStatementExcelDocument {
  bankHint: StructuredBankStatementExcelBank | 'UNKNOWN';
  sourceFormat: StructuredBankStatementExcelSourceFormat;
  sourceFileName?: string;
  parserVersion: string;
  currency?: string;
  accountNumberMasked?: string;
  periodStart?: string;
  periodEnd?: string;
  statementDate?: string;
  forceReviewAllUnits?: boolean;
  reviewReasonCodes: Array<
    | 'TRUSTED_CURRENCY_UNCORROBORATED'
    | 'RUNNING_BALANCE_MISSING'
    | 'RUNNING_BALANCE_CHAIN_INCOHERENT'
  >;
  lines: StructuredBankStatementLine[];
  validation: StructuredBankStatementValidation;
  errors: string[];
  warnings: string[];
}

export interface ParseStructuredBankStatementExcelOptions {
  sourceFileName: string;
  expectedBank?: StructuredBankStatementExcelBank;
}

interface ProfileMatch {
  profile: StructuredBankStatementExcelProfile;
  sheetName: string;
  sheetIndex: number;
  headerRowIndex: number;
}

type ParsedAmount =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number };

export function parseStructuredBankStatementExcel(
  buffer: ArrayBuffer,
  options: ParseStructuredBankStatementExcelOptions,
): StructuredBankStatementExcelDocument {
  const extension = fileExtension(options.sourceFileName);
  const sourceFormat = extension === '.xlsx'
    ? 'structured_bank_statement_xlsx'
    : 'structured_bank_statement_xls';
  const errors: string[] = [];
  const warnings: string[] = [];
  const reviewReasonCodes: StructuredBankStatementExcelDocument['reviewReasonCodes'] = [];

  if (extension !== '.xls' && extension !== '.xlsx') {
    return failureDocument({
      sourceFormat,
      sourceFileName: options.sourceFileName,
      errors: ['Structured Excel parsing requires a .xls or .xlsx file name.'],
    });
  }
  if (buffer.byteLength > MAX_STRUCTURED_EXCEL_BYTES) {
    return failureDocument({
      sourceFormat,
      sourceFileName: options.sourceFileName,
      errors: [`Structured Excel source exceeds the ${MAX_STRUCTURED_EXCEL_BYTES / 1024 / 1024} MB safety limit.`],
    });
  }
  if (!hasExpectedExcelContainerSignature(new Uint8Array(buffer), extension)) {
    return failureDocument({
      sourceFormat,
      sourceFileName: options.sourceFileName,
      errors: [`The ${extension} extension does not match the Excel container signature.`],
    });
  }

  let workbookBuffer = buffer;
  if (extension === '.xlsx') {
    const archive = prepareSafeStructuredXlsxArchive(new Uint8Array(buffer));
    if (archive.error || !archive.sanitizedBytes) {
      return failureDocument({
        sourceFormat,
        sourceFileName: options.sourceFileName,
        errors: [archive.error ?? 'XLSX archive safety validation failed.'],
      });
    }
    workbookBuffer = archive.sanitizedBytes.buffer as ArrayBuffer;
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(workbookBuffer, {
      type: 'array',
      cellDates: false,
      cellFormula: true,
      cellNF: true,
      bookVBA: true,
      raw: true,
      sheetRows: MAX_STRUCTURED_EXCEL_ROWS + 1,
    });
  } catch {
    return failureDocument({
      sourceFormat,
      sourceFileName: options.sourceFileName,
      errors: ['Excel workbook decoding failed without exposing file content.'],
    });
  } finally {
    if (workbookBuffer !== buffer) new Uint8Array(workbookBuffer).fill(0);
  }

  if (workbook.SheetNames.length === 0) {
    errors.push('Excel workbook contains no worksheet.');
  }
  if ((workbook as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw) {
    errors.push('Macro-enabled Excel content is refused on the structured statement path.');
  }
  if (workbook.SheetNames.length > MAX_STRUCTURED_EXCEL_SHEETS) {
    errors.push(`Excel workbook exceeds the ${MAX_STRUCTURED_EXCEL_SHEETS}-sheet safety limit.`);
  }

  const sheetMetadata = workbook.Workbook?.Sheets ?? [];
  let nonEmptySheetCount = 0;
  for (let index = 0; index < workbook.SheetNames.length; index += 1) {
    const sheet = workbook.Sheets[workbook.SheetNames[index]];
    if (!sheet?.['!ref']) continue;
    nonEmptySheetCount += 1;
    if ((sheetMetadata[index]?.Hidden ?? 0) !== 0) {
      errors.push(`Worksheet ${index + 1} is hidden; hidden content is refused fail-closed.`);
    }
    const fullReference = (sheet as XLSX.WorkSheet & { '!fullref'?: string })['!fullref'] ?? sheet['!ref'];
    const range = XLSX.utils.decode_range(fullReference);
    const rowCount = range.e.r - range.s.r + 1;
    const columnCount = range.e.c - range.s.c + 1;
    if (rowCount > MAX_STRUCTURED_EXCEL_ROWS) {
      errors.push(`Worksheet ${index + 1} exceeds the ${MAX_STRUCTURED_EXCEL_ROWS}-row safety limit.`);
    }
    if (columnCount > MAX_STRUCTURED_EXCEL_COLUMNS) {
      errors.push(`Worksheet ${index + 1} exceeds the ${MAX_STRUCTURED_EXCEL_COLUMNS}-column safety limit.`);
    }
    if (rowCount * columnCount > MAX_STRUCTURED_EXCEL_CELLS) {
      errors.push(`Worksheet ${index + 1} exceeds the ${MAX_STRUCTURED_EXCEL_CELLS}-cell safety limit.`);
    }
    if (worksheetContainsFormula(sheet)) {
      errors.push(`Worksheet ${index + 1} contains formulas; formula-bearing bank exports are refused.`);
    }
  }
  if (nonEmptySheetCount > 1) {
    errors.push('Multiple non-empty worksheets are refused on the one-account statement path.');
  }

  if (errors.length > 0) {
    return failureDocument({ sourceFormat, sourceFileName: options.sourceFileName, errors });
  }

  const matches = locateProfiles(workbook);
  if (matches.length === 0) {
    return failureDocument({
      sourceFormat,
      sourceFileName: options.sourceFileName,
      errors: [
        'No exact ONLINE bank-statement Excel profile matched; generic or Internal Book workbooks are refused.',
      ],
      status: 'unsupported',
    });
  }
  if (matches.length > 1) {
    return failureDocument({
      sourceFormat,
      sourceFileName: options.sourceFileName,
      errors: ['Multiple Excel bank-statement profiles matched; ambiguous workbook refused.'],
    });
  }

  const match = matches[0];
  const profile = match.profile;
  if (!profile.allowedExtensions.includes(extension)) {
    errors.push(`The ${profile.bank} ONLINE profile does not allow the ${extension} container.`);
  }
  if (options.expectedBank && options.expectedBank !== profile.bank) {
    errors.push(
      `Trusted bank (${options.expectedBank}) does not match the detected Excel profile (${profile.bank}).`,
    );
  }

  const sheet = workbook.Sheets[match.sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] as string);
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const lines: StructuredBankStatementLine[] = [];
  const currencies = new Set<string>();
  if (countDistinctAccountIdentifiers(sheet, match.headerRowIndex) > 1) {
    errors.push('Multiple account identifiers were detected in the matched statement; import refused.');
  }

  for (let rowIndex = match.headerRowIndex + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const operationDateRaw = cellValue(sheet, rowIndex, profile.columns.operationDate);
    const operationDate = parseExcelDate(operationDateRaw, date1904);
    if (!operationDate) {
      if (looksLikeMalformedTransactionRow(sheet, rowIndex, profile)) {
        errors.push(`Row ${rowIndex + 1} looks transactional but has an invalid operation date.`);
      }
      continue;
    }

    const valueDate = parseExcelDate(cellValue(sheet, rowIndex, profile.columns.valueDate), date1904);
    if (!valueDate) {
      errors.push(`Row ${rowIndex + 1} has an invalid value date.`);
      continue;
    }

    const description = sanitizeText(cellValue(sheet, rowIndex, profile.columns.description));
    const reference = profile.columns.reference === undefined
      ? ''
      : sanitizeText(cellValue(sheet, rowIndex, profile.columns.reference));
    const descriptionSanitized = description || reference;
    if (!descriptionSanitized) {
      errors.push(`Row ${rowIndex + 1} has neither description nor safe reference text.`);
      continue;
    }

    const balanceParsed = parseStrictAmount(cellValue(sheet, rowIndex, profile.columns.balance), {
      balanceSemantics: true,
    });
    if (balanceParsed.kind === 'invalid') {
      errors.push(`Row ${rowIndex + 1} has an invalid running balance.`);
      continue;
    }
    const balance = balanceParsed.kind === 'value' ? balanceParsed.value : undefined;

    let line: StructuredBankStatementLine | undefined;
    if (profile.amountModel.kind === 'signed') {
      const parsed = parseStrictAmount(
        cellValue(sheet, rowIndex, profile.amountModel.amountColumn),
      );
      if (parsed.kind !== 'value' || parsed.value === 0) {
        errors.push(`Row ${rowIndex + 1} requires one non-zero signed amount.`);
        continue;
      }
      const isDebit = parsed.value < 0;
      const magnitude = Math.abs(parsed.value);
      line = {
        sourceRowIndex: rowIndex,
        operationDate,
        valueDate,
        descriptionSanitized,
        debit: isDebit ? magnitude : undefined,
        credit: isDebit ? undefined : magnitude,
        signedAmount: parsed.value,
        balance,
        direction: isDebit ? 'debit' : 'credit',
      };
    } else {
      const debitParsed = parseStrictAmount(
        cellValue(sheet, rowIndex, profile.amountModel.debitColumn),
      );
      const creditParsed = parseStrictAmount(
        cellValue(sheet, rowIndex, profile.amountModel.creditColumn),
      );
      if (debitParsed.kind === 'invalid' || creditParsed.kind === 'invalid') {
        errors.push(`Row ${rowIndex + 1} contains an invalid debit or credit amount.`);
        continue;
      }
      const debit = debitParsed.kind === 'value' && debitParsed.value !== 0
        ? debitParsed.value
        : undefined;
      const credit = creditParsed.kind === 'value' && creditParsed.value !== 0
        ? creditParsed.value
        : undefined;
      if ((debit !== undefined && debit < 0) || (credit !== undefined && credit < 0)) {
        errors.push(`Row ${rowIndex + 1} contains a negative split debit or credit amount.`);
        continue;
      }
      if ((debit === undefined) === (credit === undefined)) {
        errors.push(`Row ${rowIndex + 1} must contain exactly one non-zero debit or credit amount.`);
        continue;
      }
      const isDebit = debit !== undefined;
      line = {
        sourceRowIndex: rowIndex,
        operationDate,
        valueDate,
        descriptionSanitized,
        debit,
        credit,
        signedAmount: isDebit ? -(debit as number) : (credit as number),
        balance,
        direction: isDebit ? 'debit' : 'credit',
      };
    }

    if (profile.columns.currency !== undefined) {
      const currency = sanitizeText(cellValue(sheet, rowIndex, profile.columns.currency)).toUpperCase();
      if (!STRICT_CURRENCY_PATTERN.test(currency)) {
        errors.push(`Row ${rowIndex + 1} has an invalid currency code.`);
        continue;
      }
      currencies.add(currency);
    }
    lines.push(line);
  }

  if (profile.fixedCurrency) currencies.add(profile.fixedCurrency);
  if (currencies.size > 1) {
    errors.push('Excel transaction rows contain multiple currencies; one-account one-currency import required.');
  }
  if (lines.length === 0) errors.push('No transaction line was extracted from the matched Excel profile.');

  lines.sort((left, right) => {
    const dayDelta = strictDateToUtc(left.operationDate as string) - strictDateToUtc(right.operationDate as string);
    if (dayDelta !== 0) return dayDelta;
    return profile.rowOrder === 'descending'
      ? right.sourceRowIndex - left.sourceRowIndex
      : left.sourceRowIndex - right.sourceRowIndex;
  });

  const periodStart = lines[0]?.operationDate;
  const periodEnd = lines[lines.length - 1]?.operationDate;
  const lineBalancesConsistent = validateDailyRunningBalanceChains(lines);
  if (lineBalancesConsistent === false) {
    warnings.push('At least one daily running-balance chain is incoherent; affected units require review.');
    reviewReasonCodes.push('RUNNING_BALANCE_CHAIN_INCOHERENT');
  }
  if (lines.some((line) => line.balance === undefined)) {
    warnings.push('At least one transaction has no running balance; derived balances may be unavailable.');
    reviewReasonCodes.push('RUNNING_BALANCE_MISSING');
  }
  if (currencies.size === 0) {
    warnings.push('The matched Excel profile carries no currency; trusted operator currency is required.');
    reviewReasonCodes.push('TRUSTED_CURRENCY_UNCORROBORATED');
  }
  const forceReviewAllUnits = currencies.size === 0;

  const status: StructuredBankStatementStatus = errors.length > 0
    ? 'invalid'
    : warnings.length > 0
      ? 'needs_review'
      : 'valid';
  const validation: StructuredBankStatementValidation = {
    status,
    openingBalanceFound: false,
    closingBalanceFound: false,
    declaredTotalsFound: false,
    lineBalancesConsistent,
    errors: [...errors],
    warnings: [...warnings],
  };

  return {
    bankHint: profile.bank,
    sourceFormat,
    sourceFileName: options.sourceFileName,
    parserVersion: `structured-excel-0q/${profile.version}`,
    currency: currencies.size === 1 ? [...currencies][0] : undefined,
    periodStart,
    periodEnd,
    forceReviewAllUnits,
    reviewReasonCodes,
    lines,
    validation,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

function locateProfiles(workbook: XLSX.WorkBook): ProfileMatch[] {
  const matches: ProfileMatch[] = [];
  for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex += 1) {
    const sheetName = workbook.SheetNames[sheetIndex];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const lastHeaderRow = Math.min(range.e.r, range.s.r + HEADER_SCAN_ROWS - 1);
    for (const profile of STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES) {
      for (let rowIndex = range.s.r; rowIndex <= lastHeaderRow; rowIndex += 1) {
        const matched = profile.requiredHeaders.every(({ column, aliases }) => {
          const header = normalizeStructuredExcelHeader(cellValue(sheet, rowIndex, column));
          return aliases.some((alias) => alias === header);
        });
        if (matched) {
          matches.push({ profile, sheetName, sheetIndex, headerRowIndex: rowIndex });
          break;
        }
      }
    }
  }
  return matches;
}

function worksheetContainsFormula(sheet: XLSX.WorkSheet): boolean {
  return Object.entries(sheet).some(
    ([address, cell]) => !address.startsWith('!') && Boolean((cell as XLSX.CellObject | undefined)?.f),
  );
}

function countDistinctAccountIdentifiers(
  sheet: XLSX.WorkSheet,
  headerRowIndex: number,
): number {
  const identifiersByKind = {
    account: new Set<string>(),
    iban: new Set<string>(),
  };
  const reference = sheet['!ref'];
  if (!reference) return 0;
  const range = XLSX.utils.decode_range(reference);
  for (let row = range.s.r; row < headerRowIndex; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const value = cellValue(sheet, row, column);
      if (typeof value !== 'string') continue;
      const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      if (!/\b(compte|account|iban)\b/.test(normalized)) continue;
      const kind = /\biban\b/.test(normalized) ? 'iban' : 'account';
      for (const candidate of [value, cellValue(sheet, row, column + 1)]) {
        const digits = String(candidate ?? '').replace(/\D/g, '');
        if (digits.length >= 8) identifiersByKind[kind].add(digits);
      }
    }
  }
  return Math.max(identifiersByKind.account.size, identifiersByKind.iban.size);
}

function looksLikeMalformedTransactionRow(
  sheet: XLSX.WorkSheet,
  rowIndex: number,
  profile: StructuredBankStatementExcelProfile,
): boolean {
  const description = sanitizeText(cellValue(sheet, rowIndex, profile.columns.description));
  const reference = profile.columns.reference === undefined
    ? ''
    : sanitizeText(cellValue(sheet, rowIndex, profile.columns.reference));
  if (!description && !reference) return false;
  if (profile.amountModel.kind === 'signed') {
    return hasRawCellValue(cellValue(sheet, rowIndex, profile.amountModel.amountColumn));
  }
  return [profile.amountModel.debitColumn, profile.amountModel.creditColumn].some(
    (column) => hasRawCellValue(cellValue(sheet, rowIndex, column)),
  );
}

function hasRawCellValue(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
}

function parseExcelDate(value: unknown, date1904: boolean): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0 || Math.abs(value - Math.trunc(value)) > Number.EPSILON) return undefined;
    const epoch = date1904 ? EXCEL_1904_EPOCH_UTC : EXCEL_1900_EPOCH_UTC;
    return utcToStrictDate(epoch + Math.trunc(value) * MILLISECONDS_PER_DAY);
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return utcToStrictDate(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  let match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return calendarToStrictDate(Number(match[1]), Number(match[2]), year);
  }
  match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text);
  if (match) return calendarToStrictDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = /^(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\s+(\d{4})$/.exec(text);
  if (!match) return undefined;
  const month = wordMonth(match[2]);
  return month === undefined
    ? undefined
    : calendarToStrictDate(Number(match[1]), month, Number(match[3]));
}

function wordMonth(value: string): number | undefined {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    janvier: 1,
    feb: 2,
    february: 2,
    fev: 2,
    fevrier: 2,
    mar: 3,
    march: 3,
    mars: 3,
    apr: 4,
    april: 4,
    avr: 4,
    avril: 4,
    may: 5,
    mai: 5,
    jun: 6,
    june: 6,
    juin: 6,
    jul: 7,
    july: 7,
    juil: 7,
    juillet: 7,
    aug: 8,
    august: 8,
    aou: 8,
    aout: 8,
    sep: 9,
    september: 9,
    septembre: 9,
    oct: 10,
    october: 10,
    octobre: 10,
    nov: 11,
    november: 11,
    novembre: 11,
    dec: 12,
    december: 12,
    decembre: 12,
  };
  return months[normalized];
}

function calendarToStrictDate(day: number, month: number, year: number): string | undefined {
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`;
}

function utcToStrictDate(utc: number): string | undefined {
  const date = new Date(utc);
  if (!Number.isFinite(date.getTime())) return undefined;
  return calendarToStrictDate(date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear());
}

function parseStrictAmount(
  value: unknown,
  options: { balanceSemantics?: boolean } = {},
): ParsedAmount {
  if (value === undefined || value === null || value === '') return { kind: 'empty' };
  if (typeof value === 'number') return strictNumber(value);
  if (typeof value !== 'string') return { kind: 'invalid' };

  const raw = value.trim();
  if (!raw) return { kind: 'empty' };
  let normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  let semanticSign: -1 | 1 | undefined;
  const semanticSuffix = /\s*(crediteur|credit|debiteur|debit)\s*$/.exec(normalized);
  if (semanticSuffix) {
    if (!options.balanceSemantics) return { kind: 'invalid' };
    semanticSign = semanticSuffix[1] === 'debiteur' || semanticSuffix[1] === 'debit' ? -1 : 1;
    normalized = normalized.slice(0, semanticSuffix.index).trim();
  }
  if (/\p{L}/u.test(normalized)) return { kind: 'invalid' };

  let explicitSign: -1 | 1 | undefined;
  if (/^\(.*\)$/.test(normalized)) {
    explicitSign = -1;
    normalized = normalized.slice(1, -1).trim();
  } else {
    const prefix = /^[+-]/.exec(normalized)?.[0];
    const suffix = /[+-]$/.exec(normalized)?.[0];
    if (prefix && suffix) return { kind: 'invalid' };
    if (prefix) {
      explicitSign = prefix === '-' ? -1 : 1;
      normalized = normalized.slice(1).trim();
    } else if (suffix) {
      explicitSign = suffix === '-' ? -1 : 1;
      normalized = normalized.slice(0, -1).trim();
    }
  }
  if (/[+-]/.test(normalized)) return { kind: 'invalid' };
  if (semanticSign !== undefined && explicitSign !== undefined && semanticSign !== explicitSign) {
    return { kind: 'invalid' };
  }

  const canonical = canonicalizeAmountText(normalized);
  if (!canonical) return { kind: 'invalid' };
  const fraction = canonical.fraction.padEnd(2, '0');
  const absoluteCents = BigInt(canonical.whole) * 100n + BigInt(fraction || '0');
  if (absoluteCents > BigInt(MAX_ABSOLUTE_AMOUNT_CENTS)) return { kind: 'invalid' };
  const sign = semanticSign ?? explicitSign ?? 1;
  const cents = Number(absoluteCents) * sign;
  const parsed = cents / 100;
  return { kind: 'value', value: Object.is(parsed, -0) ? 0 : parsed };
}

function strictNumber(value: number): ParsedAmount {
  if (!Number.isFinite(value)) return { kind: 'invalid' };
  const cents = Math.round(value * 100);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(cents) > MAX_ABSOLUTE_AMOUNT_CENTS ||
    Math.abs(value * 100 - cents) > 1e-7
  ) {
    return { kind: 'invalid' };
  }
  const normalized = cents / 100;
  if (!/^-?\d{1,13}(?:\.\d{1,2})?$/.test(String(normalized))) return { kind: 'invalid' };
  return { kind: 'value', value: Object.is(normalized, -0) ? 0 : normalized };
}

function canonicalizeAmountText(value: string): { whole: string; fraction: string } | undefined {
  const normalized = value.replace(/[\u00a0\u202f]/g, ' ').trim();
  if (!/^[0-9.,' ]+$/.test(normalized)) return undefined;

  const commaCount = (normalized.match(/,/g) ?? []).length;
  const dotCount = (normalized.match(/\./g) ?? []).length;
  let integerPart = normalized;
  let fraction = '';

  if (commaCount > 0 && dotCount > 0) {
    const decimalSeparator = normalized.lastIndexOf(',') > normalized.lastIndexOf('.') ? ',' : '.';
    if ((decimalSeparator === ',' ? commaCount : dotCount) !== 1) return undefined;
    const decimalIndex = normalized.lastIndexOf(decimalSeparator);
    integerPart = normalized.slice(0, decimalIndex);
    fraction = normalized.slice(decimalIndex + 1);
    if (!/^\d{1,2}$/.test(fraction)) return undefined;
  } else if (commaCount === 1 || dotCount === 1) {
    const separator = commaCount === 1 ? ',' : '.';
    const separatorIndex = normalized.indexOf(separator);
    const trailing = normalized.slice(separatorIndex + 1);
    if (/^\d{1,2}$/.test(trailing)) {
      integerPart = normalized.slice(0, separatorIndex);
      fraction = trailing;
    }
  } else if (commaCount > 1 || dotCount > 1) {
    const separator = commaCount > 1 ? ',' : '.';
    if (!isStrictGroupedInteger(normalized, separator)) return undefined;
    return { whole: normalized.split(separator).join(''), fraction: '' };
  }

  const groupingCharacters = [',', '.', "'", ' '].filter((character) => integerPart.includes(character));
  if (groupingCharacters.length > 1) return undefined;
  if (groupingCharacters.length === 0) {
    if (!/^\d+$/.test(integerPart)) return undefined;
    return { whole: integerPart, fraction };
  }
  const grouping = groupingCharacters[0];
  if (!isStrictGroupedInteger(integerPart, grouping)) return undefined;
  return { whole: integerPart.split(grouping).join(''), fraction };
}

function isStrictGroupedInteger(value: string, separator: string): boolean {
  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`).test(value);
}

function validateDailyRunningBalanceChains(
  lines: StructuredBankStatementLine[],
): boolean | undefined {
  if (lines.some((line) => line.balance === undefined)) return undefined;
  const previousByDay = new Map<string, StructuredBankStatementLine>();
  for (const line of lines) {
    const day = line.operationDate as string;
    const previous = previousByDay.get(day);
    if (previous) {
      const expectedCents = toCents(previous.balance as number) + toCents(line.signedAmount);
      if (toCents(line.balance as number) !== expectedCents) return false;
    }
    previousByDay.set(day, line);
  }
  return true;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function strictDateToUtc(value: string): number {
  const [day, month, year] = value.split('/').map(Number);
  return Date.UTC(year, month - 1, day);
}

function sanitizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cellValue(sheet: XLSX.WorkSheet, row: number, column: number): unknown {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v;
}

function fileExtension(fileName: string): string {
  const lower = fileName.trim().toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

function hasExpectedExcelContainerSignature(bytes: Uint8Array, extension: string): boolean {
  if (extension === '.xls') {
    const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return cfb.every((value, index) => bytes[index] === value);
  }
  return bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08));
}

function failureDocument(input: {
  sourceFormat: StructuredBankStatementExcelSourceFormat;
  sourceFileName?: string;
  errors: string[];
  status?: 'invalid' | 'unsupported';
}): StructuredBankStatementExcelDocument {
  const validation: StructuredBankStatementValidation = {
    status: input.status ?? 'invalid',
    openingBalanceFound: false,
    closingBalanceFound: false,
    declaredTotalsFound: false,
    errors: [...input.errors],
    warnings: [],
  };
  return {
    bankHint: 'UNKNOWN',
    sourceFormat: input.sourceFormat,
    sourceFileName: input.sourceFileName,
    parserVersion: 'structured-excel-0q/unmatched',
    reviewReasonCodes: [],
    lines: [],
    validation,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}
