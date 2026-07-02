/**
 * Pure CSV parser for structured bank statement exports (BDK / ORA "ONLINE" CSV).
 *
 * Scope (POC-BANK-STRUCTURED-EXPORTS-0B):
 * - Input is a raw CSV string. Windows-1252 -> UTF-8 decoding is the caller's
 *   responsibility (runtime, out of scope here). This function performs NO I/O.
 * - It produces an intermediate `StructuredBankStatementDocument` that deliberately
 *   sits *before* `BankAccountStatement`. Mapping to `BankAccountStatement` is a
 *   later micro-lot and is intentionally NOT done here.
 * - No dependency, no DB, no UI, no upload, no PDF parser reuse.
 *
 * The raw account number is never exposed: only a masked form is returned.
 */

export type StructuredBankStatementDirection = 'debit' | 'credit' | 'unknown';

export type StructuredBankStatementStatus = 'valid' | 'needs_review' | 'invalid' | 'unsupported';

export type StructuredBankStatementDelimiter = ';' | ',' | '\t';

export interface StructuredBankStatementLine {
  sourceRowIndex: number;
  operationDate?: string;
  valueDate?: string;
  descriptionSanitized: string;
  debit?: number;
  credit?: number;
  signedAmount: number;
  balance?: number;
  direction: StructuredBankStatementDirection;
  warnings?: string[];
}

export interface StructuredBankStatementValidation {
  status: StructuredBankStatementStatus;
  openingBalanceFound: boolean;
  closingBalanceFound: boolean;
  declaredTotalsFound: boolean;
  declaredTotalsMatchLines?: boolean;
  lineBalancesConsistent?: boolean;
  computedClosingBalance?: number;
  closingBalanceDiscrepancy?: number;
  errors: string[];
  warnings: string[];
}

export interface StructuredBankStatementDocument {
  bankHint: 'BDK' | 'ORA' | 'UNKNOWN';
  detectedDelimiter: StructuredBankStatementDelimiter;
  sourceFileName?: string;
  currency?: string;
  accountNumberMasked?: string;
  accountFingerprint?: string;
  ibanMasked?: string;
  periodStart?: string;
  periodEnd?: string;
  statementDate?: string;
  openingBalance?: number;
  declaredTotalDebits?: number;
  declaredTotalCredits?: number;
  declaredClosingBalance?: number;
  lines: StructuredBankStatementLine[];
  validation: StructuredBankStatementValidation;
  errors: string[];
  warnings: string[];
}

export interface ParseStructuredBankStatementCsvOptions {
  sourceFileName?: string;
  accountNumberMasked?: string;
  accountFingerprint?: string;
  currency?: string;
  delimiter?: StructuredBankStatementDelimiter;
}

type ColumnKey = 'operationDate' | 'valueDate' | 'description' | 'debit' | 'credit' | 'balance';

type ColumnMap = Partial<Record<ColumnKey, number>>;

const REQUIRED_COLUMNS: ColumnKey[] = ['operationDate', 'description', 'debit', 'credit', 'balance'];

const COLUMN_MATCHERS: Record<ColumnKey, string[]> = {
  operationDate: ['date'],
  valueDate: ['valeur'],
  description: ['libell'],
  debit: ['debit', 'dbit'],
  credit: ['credit', 'crdit'],
  balance: ['solde']
};

const DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;

// Trailing currency code found on some account-number cells (e.g. "…-46 XOF").
// Restricted to a known whitelist so genuine account characters are never stripped.
const CURRENCY_SUFFIX_PATTERN = /\s*\b(XOF|XAF|EUR|USD|GBP|CAD|CHF|JPY|CNY)\b\s*$/i;

export function parseStructuredBankStatementCsv(
  rawCsv: string,
  options: ParseStructuredBankStatementCsvOptions = {}
): StructuredBankStatementDocument {
  const text = stripBom(rawCsv ?? '');
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const { rows, unterminatedQuote } = tokenizeCsv(text, delimiter);

  const errors: string[] = [];
  const warnings: string[] = [];

  const bankHint = detectBankHint(options.sourceFileName);

  // A quoted field left open would otherwise swallow every following row into a
  // single cell, silently dropping the remaining transaction lines. Fail closed.
  if (unterminatedQuote) {
    return buildDocument({
      bankHint,
      delimiter,
      sourceFileName: options.sourceFileName,
      currency: options.currency,
      accountNumberMasked: options.accountNumberMasked,
      accountFingerprint: options.accountFingerprint,
      metadata: {},
      lines: [],
      declaredTotals: { debit: undefined, credit: undefined, found: false },
      status: 'invalid',
      errors: ['Unterminated quoted field in CSV.'],
      warnings
    });
  }

  // The transaction header must be located before metadata extraction so that
  // identity/opening/period fields can be bounded to the pre-header region.
  const header = locateHeader(rows);
  const metadata = extractMetadata(rows, header?.rowIndex, header?.columns.operationDate);
  const currency = options.currency ?? metadata.currency;
  const accountNumberMasked = options.accountNumberMasked ?? metadata.accountNumberMasked;

  if (!header) {
    return buildDocument({
      bankHint,
      delimiter,
      sourceFileName: options.sourceFileName,
      currency,
      accountNumberMasked,
      accountFingerprint: options.accountFingerprint,
      metadata,
      lines: [],
      declaredTotals: { debit: undefined, credit: undefined, found: false },
      status: 'unsupported',
      errors: ['No recognizable transaction header row found in CSV.'],
      warnings
    });
  }

  const missingColumns = REQUIRED_COLUMNS.filter((column) => header.columns[column] === undefined);
  if (missingColumns.length > 0) {
    return buildDocument({
      bankHint,
      delimiter,
      sourceFileName: options.sourceFileName,
      currency,
      accountNumberMasked,
      accountFingerprint: options.accountFingerprint,
      metadata,
      lines: [],
      declaredTotals: { debit: undefined, credit: undefined, found: false },
      status: 'invalid',
      errors: [`Missing required column headers: ${missingColumns.join(', ')}.`],
      warnings
    });
  }

  const extraction = extractLines(rows, header.rowIndex, header.columns);
  errors.push(...extraction.errors);
  const declaredTotals = extraction.declaredTotals;

  if (extraction.lines.length === 0) {
    return buildDocument({
      bankHint,
      delimiter,
      sourceFileName: options.sourceFileName,
      currency,
      accountNumberMasked,
      accountFingerprint: options.accountFingerprint,
      metadata,
      lines: [],
      declaredTotals,
      status: 'invalid',
      errors: errors.length > 0 ? errors : ['No transaction lines extracted.'],
      warnings
    });
  }

  const hasUnexploitableLine = extraction.lines.some((line) => line.direction === 'unknown');

  return buildDocument({
    bankHint,
    delimiter,
    sourceFileName: options.sourceFileName,
    currency,
    accountNumberMasked,
    accountFingerprint: options.accountFingerprint,
    metadata,
    lines: extraction.lines,
    declaredTotals,
    status: hasUnexploitableLine ? 'invalid' : undefined,
    errors,
    warnings
  });
}

interface BuildDocumentInput {
  bankHint: StructuredBankStatementDocument['bankHint'];
  delimiter: StructuredBankStatementDelimiter;
  sourceFileName?: string;
  currency?: string;
  accountNumberMasked?: string;
  accountFingerprint?: string;
  metadata: ExtractedMetadata;
  lines: StructuredBankStatementLine[];
  declaredTotals: DeclaredTotals;
  status?: StructuredBankStatementStatus;
  errors: string[];
  warnings: string[];
}

function buildDocument(input: BuildDocumentInput): StructuredBankStatementDocument {
  const {
    bankHint,
    delimiter,
    sourceFileName,
    currency,
    accountNumberMasked,
    accountFingerprint,
    metadata,
    lines,
    declaredTotals,
    errors,
    warnings
  } = input;

  const validation = buildValidation({
    forcedStatus: input.status,
    openingBalance: metadata.openingBalance,
    closingBalance: metadata.closingBalance,
    declaredTotals,
    lines,
    errors: [...errors],
    warnings: [...warnings]
  });

  return {
    bankHint,
    detectedDelimiter: delimiter,
    sourceFileName,
    currency,
    accountNumberMasked,
    accountFingerprint,
    ibanMasked: metadata.ibanMasked,
    periodStart: metadata.periodStart,
    periodEnd: metadata.periodEnd,
    statementDate: metadata.statementDate,
    openingBalance: metadata.openingBalance,
    declaredTotalDebits: declaredTotals.debit,
    declaredTotalCredits: declaredTotals.credit,
    declaredClosingBalance: metadata.closingBalance,
    lines,
    validation,
    errors: validation.errors,
    warnings: validation.warnings
  };
}

interface BuildValidationInput {
  forcedStatus?: StructuredBankStatementStatus;
  openingBalance?: number;
  closingBalance?: number;
  declaredTotals: DeclaredTotals;
  lines: StructuredBankStatementLine[];
  errors: string[];
  warnings: string[];
}

function buildValidation(input: BuildValidationInput): StructuredBankStatementValidation {
  const { openingBalance, closingBalance, declaredTotals, lines } = input;
  const errors = [...input.errors];
  const warnings = [...input.warnings];

  const openingBalanceFound = openingBalance !== undefined;
  const closingBalanceFound = closingBalance !== undefined;
  const declaredTotalsFound = declaredTotals.found;

  // Terminal states that do not depend on balance reconciliation.
  if (input.forcedStatus === 'unsupported' || input.forcedStatus === 'invalid') {
    return {
      status: input.forcedStatus,
      openingBalanceFound,
      closingBalanceFound,
      declaredTotalsFound,
      declaredTotalsMatchLines: undefined,
      lineBalancesConsistent: undefined,
      computedClosingBalance: undefined,
      closingBalanceDiscrepancy: undefined,
      errors,
      warnings
    };
  }

  const lineTotals = lines.reduce(
    (totals, line) => ({
      debit: totals.debit + (line.debit ?? 0),
      credit: totals.credit + (line.credit ?? 0),
      signed: totals.signed + line.signedAmount
    }),
    { debit: 0, credit: 0, signed: 0 }
  );

  const declaredTotalsMatchLines = declaredTotalsFound
    ? declaredTotals.debit === lineTotals.debit && declaredTotals.credit === lineTotals.credit
    : undefined;

  const lineBalancesConsistent = openingBalanceFound
    ? checkRunningBalances(openingBalance as number, lines)
    : undefined;

  const computedClosingBalance = openingBalanceFound
    ? (openingBalance as number) + lineTotals.signed
    : undefined;

  const closingBalanceDiscrepancy =
    computedClosingBalance !== undefined && closingBalanceFound
      ? computedClosingBalance - (closingBalance as number)
      : undefined;

  const anomalies: string[] = [];
  if (!openingBalanceFound) {
    anomalies.push('Opening balance was not found.');
  }
  if (!closingBalanceFound) {
    anomalies.push('Declared closing balance was not found.');
  }
  if (!declaredTotalsFound) {
    anomalies.push('Declared debit/credit totals row was not found.');
  }
  if (declaredTotalsMatchLines === false) {
    anomalies.push('Declared totals do not match the sum of transaction lines.');
  }
  if (lineBalancesConsistent === false) {
    anomalies.push('Running balances are not internally consistent.');
  }
  if (closingBalanceDiscrepancy !== undefined && closingBalanceDiscrepancy !== 0) {
    anomalies.push('Computed closing balance does not match the declared closing balance.');
  }

  warnings.push(...anomalies);

  const status: StructuredBankStatementStatus = anomalies.length === 0 ? 'valid' : 'needs_review';

  return {
    status,
    openingBalanceFound,
    closingBalanceFound,
    declaredTotalsFound,
    declaredTotalsMatchLines,
    lineBalancesConsistent,
    computedClosingBalance,
    closingBalanceDiscrepancy,
    errors,
    warnings
  };
}

function checkRunningBalances(openingBalance: number, lines: StructuredBankStatementLine[]): boolean {
  let previous = openingBalance;

  for (const line of lines) {
    const expected = previous + line.signedAmount;
    if (line.balance !== undefined && line.balance !== expected) {
      return false;
    }
    previous = line.balance ?? expected;
  }

  return true;
}

interface DeclaredTotals {
  debit?: number;
  credit?: number;
  found: boolean;
}

interface LineExtractionResult {
  lines: StructuredBankStatementLine[];
  declaredTotals: DeclaredTotals;
  errors: string[];
}

function extractLines(rows: string[][], headerRowIndex: number, columns: ColumnMap): LineExtractionResult {
  const lines: StructuredBankStatementLine[] = [];
  const errors: string[] = [];
  let declaredTotals: DeclaredTotals = { debit: undefined, credit: undefined, found: false };

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const descriptionCell = cell(row, columns.description);
    const operationDate = cell(row, columns.operationDate);

    if (isEmptyRow(row)) {
      continue;
    }

    // Declared totals row: e.g. ";;Total;122635461;93654517;"
    if (reduce(descriptionCell) === 'total') {
      declaredTotals = {
        debit: parseAmount(cell(row, columns.debit)),
        credit: parseAmount(cell(row, columns.credit)),
        found: true
      };
      continue;
    }

    // Non-transaction rows (embedded opening/closing balance, footnotes, blanks):
    // a real transaction row always starts with a dd/mm/yyyy operation date.
    if (!DATE_PATTERN.test(operationDate.trim())) {
      continue;
    }

    const debit = parseAmount(cell(row, columns.debit));
    const credit = parseAmount(cell(row, columns.credit));
    const balance = parseAmount(cell(row, columns.balance));
    const descriptionSanitized = sanitize(descriptionCell);
    const valueDate = normalizeDate(cell(row, columns.valueDate));

    if (debit !== undefined && credit !== undefined) {
      const message = `Row ${rowIndex} has both a debit and a credit amount.`;
      errors.push(message);
      lines.push({
        sourceRowIndex: rowIndex,
        operationDate: operationDate.trim(),
        valueDate,
        descriptionSanitized,
        debit,
        credit,
        signedAmount: 0,
        balance,
        direction: 'unknown',
        warnings: [message]
      });
      continue;
    }

    if (debit === undefined && credit === undefined) {
      const message = `Row ${rowIndex} has neither a debit nor a credit amount.`;
      errors.push(message);
      lines.push({
        sourceRowIndex: rowIndex,
        operationDate: operationDate.trim(),
        valueDate,
        descriptionSanitized,
        signedAmount: 0,
        balance,
        direction: 'unknown',
        warnings: [message]
      });
      continue;
    }

    const isDebit = debit !== undefined;
    lines.push({
      sourceRowIndex: rowIndex,
      operationDate: operationDate.trim(),
      valueDate,
      descriptionSanitized,
      debit: isDebit ? debit : undefined,
      credit: isDebit ? undefined : credit,
      signedAmount: isDebit ? -(debit as number) : (credit as number),
      balance,
      direction: isDebit ? 'debit' : 'credit'
    });
  }

  return { lines, declaredTotals, errors };
}

interface ExtractedMetadata {
  currency?: string;
  accountNumberMasked?: string;
  ibanMasked?: string;
  periodStart?: string;
  periodEnd?: string;
  statementDate?: string;
  openingBalance?: number;
  closingBalance?: number;
}

function extractMetadata(
  rows: string[][],
  headerRowIndex?: number,
  operationDateColumn?: number
): ExtractedMetadata {
  const metadata: ExtractedMetadata = {};

  // Identity / opening / period metadata always appear *before* the transaction
  // header. Bounding this scan to the pre-header region prevents a transaction
  // label from impersonating "Solde initial", "Periode", "Numero de compte" or
  // "Code IBAN". When no header was located, fall back to the whole document so
  // the unsupported/invalid branches keep whatever they can find.
  const preHeaderEnd = headerRowIndex ?? rows.length;
  for (let rowIndex = 0; rowIndex < preHeaderEnd; rowIndex++) {
    const row = rows[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      const raw = row[columnIndex];
      const deburred = deburr(raw);
      const reduced = reduce(raw);

      if (metadata.openingBalance === undefined && /solde\s+initial/.test(deburred)) {
        metadata.openingBalance = parseTrailingAmount(raw);
        metadata.currency = metadata.currency ?? extractCurrency(raw);
      }

      if (reduced.startsWith('periode')) {
        const dates = row.map((value) => value.trim()).filter((value) => DATE_PATTERN.test(value));
        metadata.periodStart = metadata.periodStart ?? dates[0];
        metadata.periodEnd = metadata.periodEnd ?? dates[1];
      }

      if (metadata.accountNumberMasked === undefined && reduced === 'numerodecompte') {
        const value = row[columnIndex + 1];
        if (value && value.trim() !== '') {
          metadata.currency = metadata.currency ?? extractCurrencySuffix(value);
          metadata.accountNumberMasked = maskIdentifier(stripCurrencySuffix(value));
        }
      }

      if (metadata.ibanMasked === undefined && reduced === 'codeiban') {
        const value = row[columnIndex + 1];
        if (value && value.trim() !== '') {
          metadata.ibanMasked = maskIdentifier(value);
        }
      }
    }
  }

  // Closing balance / statement date live in the closing footer, after the
  // header. When no header was located, scan the whole document as a fallback.
  const footerStart = headerRowIndex !== undefined ? headerRowIndex + 1 : 0;
  for (let rowIndex = footerStart; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    // Closing metadata only appears in footer rows, never in a genuine
    // transaction row: one that carries a dd/mm/yyyy operation date. This keeps
    // a transaction label like "VIR SOLDE AU 30/06/2026 : 999999" from being
    // mistaken for the real closing footer.
    if (operationDateColumn !== undefined && DATE_PATTERN.test((row[operationDateColumn] ?? '').trim())) {
      continue;
    }

    for (const raw of row) {
      const deburred = deburr(raw);

      if (metadata.closingBalance === undefined && /solde.*\bau\b\s*\d{2}\/\d{2}\/\d{4}/.test(deburred)) {
        metadata.closingBalance = parseTrailingAmount(raw);
        metadata.statementDate = metadata.statementDate ?? extractDate(raw);
        metadata.currency = metadata.currency ?? extractCurrency(raw);
      }
    }
  }

  return metadata;
}

interface HeaderLocation {
  rowIndex: number;
  columns: ColumnMap;
}

function locateHeader(rows: string[][]): HeaderLocation | undefined {
  let best: HeaderLocation | undefined;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const columns = matchColumns(rows[rowIndex]);
    const score = Object.keys(columns).length;

    if (score > bestScore) {
      best = { rowIndex, columns };
      bestScore = score;
    }
  }

  // A single incidental keyword match is not a header.
  return bestScore >= 2 ? best : undefined;
}

function matchColumns(row: string[]): ColumnMap {
  const columns: ColumnMap = {};

  (Object.keys(COLUMN_MATCHERS) as ColumnKey[]).forEach((column) => {
    const matchers = COLUMN_MATCHERS[column];
    const index = row.findIndex((value) => {
      const reduced = reduce(value);
      if (reduced === '') {
        return false;
      }
      return matchers.some((matcher) =>
        column === 'operationDate' ? reduced.startsWith(matcher) : reduced.includes(matcher)
      );
    });

    if (index !== -1) {
      columns[column] = index;
    }
  });

  return columns;
}

function detectBankHint(sourceFileName: string | undefined): StructuredBankStatementDocument['bankHint'] {
  // Bank identity is inferred only from a trusted source name, never from the
  // transactional body (counterparty labels routinely mention other banks).
  if (!sourceFileName) {
    return 'UNKNOWN';
  }

  const name = deburr(sourceFileName);
  if (/\bora\b|orabank/.test(name)) {
    return 'ORA';
  }
  if (/\bbdk\b|banque de dakar/.test(name)) {
    return 'BDK';
  }
  return 'UNKNOWN';
}

function detectDelimiter(text: string): StructuredBankStatementDelimiter {
  const candidates: StructuredBankStatementDelimiter[] = [';', ',', '\t'];
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (inQuotes) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          i++;
          continue;
        }
        inQuotes = false;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character in counts) {
      counts[character]++;
    }
  }

  return candidates.reduce((best, candidate) => (counts[candidate] > counts[best] ? candidate : best), ';');
}

function tokenizeCsv(
  text: string,
  delimiter: string
): { rows: string[][]; unterminatedQuote: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];

    if (inQuotes) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += character;
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (character === '\r') {
      continue;
    }
    if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += character;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return { rows, unterminatedQuote: inQuotes };
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) {
    return '';
  }
  return row[index] ?? '';
}

function isEmptyRow(row: string[]): boolean {
  return row.every((value) => value.trim() === '');
}

function normalizeDate(value: string): string | undefined {
  const trimmed = value.trim();
  return DATE_PATTERN.test(trimmed) ? trimmed : undefined;
}

function parseAmount(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  const negative = trimmed.startsWith('-') || (trimmed.startsWith('(') && trimmed.endsWith(')'));
  const digits = trimmed
    .replace(/[()]/g, '')
    .replace(/^-/, '')
    .replace(/[\s  ]/g, '');

  if (!/^\d+([.,]\d+)?$/.test(digits)) {
    return undefined;
  }

  const magnitude = Number.parseFloat(digits.replace(',', '.'));
  return negative ? -magnitude : magnitude;
}

function parseTrailingAmount(value: string): number | undefined {
  const match = deburr(value).match(/(-?\d[\d\s  ]*)\s*$/);
  return match ? parseAmount(match[1]) : undefined;
}

function extractDate(value: string): string | undefined {
  const match = value.match(/(\d{2}\/\d{2}\/\d{4})/);
  return match?.[1];
}

function extractCurrency(value: string): string | undefined {
  const match = value.match(/\(([A-Za-z]{3})\)/);
  return match?.[1].toUpperCase();
}

function extractCurrencySuffix(value: string): string | undefined {
  const match = value.trim().match(CURRENCY_SUFFIX_PATTERN);
  return match?.[1].toUpperCase();
}

function stripCurrencySuffix(value: string): string {
  return value.trim().replace(CURRENCY_SUFFIX_PATTERN, '').trim();
}

function maskIdentifier(value: string): string {
  const alphanumeric = value.replace(/[^0-9A-Za-z]/g, '');
  if (alphanumeric.length <= 4) {
    return '****';
  }
  return `****${alphanumeric.slice(-4)}`;
}

function sanitize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function deburr(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[  ]/g, ' ')
    .toLowerCase();
}

function reduce(value: string): string {
  return deburr(value).replace(/[^a-z0-9]/g, '');
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
