import type {
  BankAccountStatement,
  BankAccountStatementImportResult,
  BankAccountStatementLine,
  BankAccountStatementValidation
} from '@/types/bankAccountStatement';
import { extractBDKAccountStatement } from './bdkAccountStatementExtractor';

export interface BDKAccountStatementParseOptions {
  sourceFileName?: string;
  accountNumberMasked?: string;
  accountFingerprint?: string;
  currency?: string;
  sourceFormat?: string;
}

const TRANSACTION_LINE_PATTERN = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;
const TRANSACTION_AMOUNTS_PATTERN = /^(.*?)\s+(\d[\d ]*?)\s{2,}(\d[\d ]*)\s*$/;

export function parseBDKAccountStatement(
  textContent: string,
  options: BDKAccountStatementParseOptions = {}
): BankAccountStatementImportResult {
  const extracted = extractBDKAccountStatement(textContent);
  const lines = parseTransactionLines(textContent, extracted.openingBalance, options.currency ?? 'XOF');
  const lineWarnings = lines.flatMap((line) => line.warnings ?? []);
  const errors = [...extracted.errors];
  const warnings = [...lineWarnings];

  if (lines.length === 0) {
    errors.push('No transaction lines extracted.');
  }

  if (lines.some((line) => line.direction === 'unknown')) {
    errors.push('One or more transaction lines have an unknown direction.');
  }

  const declaredTotalsMatchLines = hasMatchingLineTotals(lines, extracted.totalDebits, extracted.totalCredits);
  if (lines.length > 0 && !declaredTotalsMatchLines) {
    errors.push('Transaction line totals do not match declared statement totals.');
  }

  const lineBalancesConsistent = hasConsistentLineBalances(lines, extracted.closingBalance);
  if (lines.length > 0 && !lineBalancesConsistent) {
    errors.push('Transaction line balances do not reach declared closing balance.');
  }

  const validation = buildValidation(
    extracted.errors,
    errors,
    warnings,
    extracted.validation.calculatedClosing,
    extracted.validation.discrepancy,
    extracted.validation.isValid,
    declaredTotalsMatchLines,
    lineBalancesConsistent
  );
  const statement = extracted.success && lines.length > 0
    ? buildStatement(lines, validation, extracted, options, errors, warnings)
    : undefined;
  const success = Boolean(statement)
    && !lines.some((line) => line.direction === 'unknown')
    && validation.isValid;

  return {
    success,
    statement,
    detectedFormat: 'bdk_account_statement',
    bank: 'BDK',
    sourceFileName: options.sourceFileName,
    validation,
    errors,
    warnings,
    rejectedReason: success ? undefined : errors[0]
  };
}

function parseTransactionLines(
  textContent: string,
  openingBalance: number,
  currency: string
): BankAccountStatementLine[] {
  let previousBalance = openingBalance;

  return textContent
    .split(/\r?\n/)
    .map((rawLine, sourceLineIndex) => ({ rawLine: rawLine.trim(), sourceLineIndex }))
    .filter(({ rawLine }) => TRANSACTION_LINE_PATTERN.test(rawLine))
    .map(({ rawLine, sourceLineIndex }) => {
      const line = parseTransactionLine(rawLine, sourceLineIndex, previousBalance, currency);

      if (line.runningBalance !== undefined) {
        previousBalance = line.runningBalance;
      }

      return line;
    });
}

function parseTransactionLine(
  rawLine: string,
  sourceLineIndex: number,
  previousBalance: number,
  currency: string
): BankAccountStatementLine {
  const transactionMatch = rawLine.match(TRANSACTION_LINE_PATTERN);
  const transactionDate = transactionMatch?.[1];
  const valueDate = transactionMatch?.[2];
  const content = transactionMatch?.[3] ?? '';
  const amountMatch = content.match(TRANSACTION_AMOUNTS_PATTERN);

  if (!amountMatch) {
    return buildUnknownLine(
      sourceLineIndex,
      transactionDate,
      valueDate,
      sanitizeDescription(content),
      currency,
      'Transaction line skipped because running balance could not be parsed.'
    );
  }

  const descriptionSanitized = sanitizeDescription(amountMatch[1]);
  const amount = parseAmount(amountMatch[2]);
  const runningBalance = parseAmount(amountMatch[3]);

  if (previousBalance - amount === runningBalance) {
    return {
      sourceLineIndex,
      transactionDate,
      valueDate,
      descriptionSanitized,
      debitAmount: amount,
      signedAmount: -amount,
      runningBalance,
      direction: 'debit',
      currency
    };
  }

  if (previousBalance + amount === runningBalance) {
    return {
      sourceLineIndex,
      transactionDate,
      valueDate,
      descriptionSanitized,
      creditAmount: amount,
      signedAmount: amount,
      runningBalance,
      direction: 'credit',
      currency
    };
  }

  return {
    ...buildUnknownLine(
      sourceLineIndex,
      transactionDate,
      valueDate,
      descriptionSanitized,
      currency,
      'Transaction direction could not be derived from previous and running balances.'
    ),
    runningBalance
  };
}

function buildStatement(
  lines: BankAccountStatementLine[],
  validation: BankAccountStatementValidation,
  extracted: ReturnType<typeof extractBDKAccountStatement>,
  options: BDKAccountStatementParseOptions,
  errors: string[],
  warnings: string[]
): BankAccountStatement {
  return {
    bank: 'BDK',
    currency: options.currency ?? 'XOF',
    statementDate: extracted.reportDate,
    closingDate: extracted.reportDate,
    accountIdentity: {
      accountNumberMasked: options.accountNumberMasked ?? 'UNKNOWN_MASKED_ACCOUNT',
      accountFingerprint: options.accountFingerprint
    },
    openingBalance: extracted.openingBalance,
    totalDebits: extracted.totalDebits,
    totalCredits: extracted.totalCredits,
    closingBalance: extracted.closingBalance,
    lines,
    validation,
    sourceFileName: options.sourceFileName,
    sourceFormat: options.sourceFormat ?? 'pdf_text',
    status: validation.status,
    errors,
    warnings
  };
}

function buildValidation(
  extractionErrors: string[],
  errors: string[],
  warnings: string[],
  calculatedClosing: number,
  discrepancy: number,
  extractedIsValid: boolean,
  declaredTotalsMatchLines: boolean,
  lineBalancesConsistent: boolean
): BankAccountStatementValidation {
  const isValid = extractedIsValid
    && errors.length === 0
    && declaredTotalsMatchLines
    && lineBalancesConsistent;

  return {
    calculatedClosing,
    discrepancy,
    isValid,
    status: isValid ? 'valid' : warnings.length > 0 && errors.length === 0 ? 'needs_review' : 'invalid',
    openingBalanceFound: !hasExtractionError(extractionErrors, 'Missing openingBalance'),
    totalDebitsFound: !hasExtractionError(extractionErrors, 'Missing totalDebits'),
    totalCreditsFound: !hasExtractionError(extractionErrors, 'totalCredits'),
    closingBalanceFound: !hasExtractionError(extractionErrors, 'Missing closingBalance'),
    declaredTotalsMatchLines,
    lineBalancesConsistent,
    errors,
    warnings
  };
}

function buildUnknownLine(
  sourceLineIndex: number,
  transactionDate: string | undefined,
  valueDate: string | undefined,
  descriptionSanitized: string,
  currency: string,
  warning: string
): BankAccountStatementLine {
  return {
    sourceLineIndex,
    transactionDate,
    valueDate,
    descriptionSanitized,
    signedAmount: 0,
    direction: 'unknown',
    currency,
    warnings: [warning]
  };
}

function hasMatchingLineTotals(
  lines: BankAccountStatementLine[],
  totalDebits: number,
  totalCredits: number
): boolean {
  const lineTotals = lines.reduce(
    (totals, line) => ({
      debits: totals.debits + (line.debitAmount ?? 0),
      credits: totals.credits + (line.creditAmount ?? 0)
    }),
    { debits: 0, credits: 0 }
  );

  return lineTotals.debits === totalDebits && lineTotals.credits === totalCredits;
}

function hasConsistentLineBalances(lines: BankAccountStatementLine[], closingBalance: number): boolean {
  const lastLine = lines.at(-1);

  return lines.length > 0
    && lines.every((line) => line.direction !== 'unknown' && line.runningBalance !== undefined)
    && lastLine?.runningBalance === closingBalance;
}

function hasExtractionError(errors: string[], expectedText: string): boolean {
  return errors.some((error) => error.includes(expectedText));
}

function parseAmount(value: string): number {
  return Number.parseInt(value.replace(/\s+/g, ''), 10) || 0;
}

function sanitizeDescription(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
