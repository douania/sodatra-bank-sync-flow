import type {
  BankAccountStatement,
  BankAccountStatementImportResult,
  BankAccountStatementLine,
  BankAccountStatementValidation
} from '@/types/bankAccountStatement';
import type {
  BDKAccountStatementPositionedDocumentAnalysisResult
} from './bdkAccountStatementPositionedDocumentAnalyzer';

export interface BDKPositionedAccountStatementImportAdapterOptions {
  sourceFileName?: string;
  accountNumberMasked?: string;
  accountFingerprint?: string;
  currency?: string;
  sourceFormat?: string;
}

const BANK = 'BDK';
const DETECTED_FORMAT = 'bdk_account_statement_positioned';
const DEFAULT_CURRENCY = 'XOF';
const DEFAULT_SOURCE_FORMAT = 'pdf_positioned';
const DEFAULT_ACCOUNT_NUMBER_MASKED = 'UNKNOWN_MASKED_ACCOUNT';
const DECLARED_TOTALS_WARNING =
  'BDK positioned adapter computed debit/credit totals from validated rows; declared statement totals are not extracted in this path.';

export function adaptBDKPositionedDocumentAnalysisToBankAccountStatementImportResult(
  documentAnalysis: BDKAccountStatementPositionedDocumentAnalysisResult,
  options: BDKPositionedAccountStatementImportAdapterOptions = {}
): BankAccountStatementImportResult {
  const baseWarnings = [...documentAnalysis.warnings];

  if (!documentAnalysis.success) {
    return buildRejectedResult(documentAnalysis.errors, baseWarnings, documentAnalysis, options);
  }

  const analysis = documentAnalysis.analysis;
  if (!analysis) {
    return buildRejectedResult(
      ['BDK positioned document analysis is missing.'],
      baseWarnings,
      documentAnalysis,
      options
    );
  }

  const { balances } = analysis;
  if (balances.openingBalance === undefined || balances.closingBalance === undefined) {
    return buildRejectedResult(
      [
        ...analysis.errors,
        'BDK positioned document analysis is missing an opening or closing balance.'
      ],
      [...baseWarnings, ...analysis.warnings],
      documentAnalysis,
      options
    );
  }

  const lineResult = adaptLines(analysis.rows.positionedRows, options.currency ?? DEFAULT_CURRENCY);
  if (!lineResult.success) {
    return buildRejectedResult(
      [...analysis.errors, ...lineResult.errors],
      [...baseWarnings, ...analysis.warnings],
      documentAnalysis,
      options
    );
  }

  const calculatedClosing = analysis.validation?.calculatedClosing;
  const discrepancy = calculatedClosing !== undefined
    ? calculatedClosing - balances.closingBalance
    : 0;
  const warnings = [
    ...baseWarnings,
    ...analysis.warnings,
    DECLARED_TOTALS_WARNING
  ];
  const validation: BankAccountStatementValidation = {
    calculatedClosing: calculatedClosing ?? balances.closingBalance,
    discrepancy,
    isValid: analysis.validation?.success === true,
    status: 'needs_review',
    openingBalanceFound: balances.openingBalanceFound,
    totalDebitsFound: false,
    totalCreditsFound: false,
    closingBalanceFound: balances.closingBalanceFound,
    declaredTotalsMatchLines: undefined,
    lineBalancesConsistent: analysis.validation?.success,
    errors: [...analysis.errors],
    warnings
  };
  const totalDebits = lineResult.lines.reduce((sum, line) => sum + (line.debitAmount ?? 0), 0);
  const totalCredits = lineResult.lines.reduce((sum, line) => sum + (line.creditAmount ?? 0), 0);
  const statement: BankAccountStatement = {
    bank: BANK,
    currency: options.currency ?? DEFAULT_CURRENCY,
    statementDate: balances.closingDate,
    closingDate: balances.closingDate,
    accountIdentity: {
      accountNumberMasked: options.accountNumberMasked ?? DEFAULT_ACCOUNT_NUMBER_MASKED,
      accountFingerprint: options.accountFingerprint
    },
    openingBalance: balances.openingBalance,
    totalDebits,
    totalCredits,
    closingBalance: balances.closingBalance,
    lines: lineResult.lines,
    validation,
    sourceFileName: options.sourceFileName,
    sourceFormat: options.sourceFormat ?? DEFAULT_SOURCE_FORMAT,
    status: 'needs_review',
    errors: [...analysis.errors],
    warnings
  };

  return {
    success: true,
    statement,
    detectedFormat: DETECTED_FORMAT,
    bank: BANK,
    sourceFileName: options.sourceFileName,
    validation,
    errors: [...analysis.errors],
    warnings
  };
}

function adaptLines(
  positionedRows: NonNullable<BDKAccountStatementPositionedDocumentAnalysisResult['analysis']>['rows']['positionedRows'],
  currency: string
): { success: true; lines: BankAccountStatementLine[] } | { success: false; errors: string[] } {
  const errors: string[] = [];
  const lines = positionedRows.map((row): BankAccountStatementLine | undefined => {
    const amountColumn = row.amountColumn;
    const rowLabel = `Positioned row ${row.sourceRowIndex}`;

    if (amountColumn !== 'debit' && amountColumn !== 'credit') {
      errors.push(`${rowLabel} has no supported debit or credit amount column.`);
      return undefined;
    }

    if (row.direction !== amountColumn) {
      errors.push(`${rowLabel} direction does not match amount column.`);
      return undefined;
    }

    const amount = parseBDKPositionedAmount(amountColumn === 'debit' ? row.debit : row.credit);
    const runningBalance = parseBDKPositionedAmount(row.balance);

    if (amount === undefined) {
      errors.push(`${rowLabel} has no parsable ${amountColumn} amount.`);
      return undefined;
    }

    if (runningBalance === undefined) {
      errors.push(`${rowLabel} has no parsable running balance.`);
      return undefined;
    }

    return {
      sourceLineIndex: row.sourceRowIndex,
      transactionDate: row.transactionDate,
      valueDate: row.valueDate,
      descriptionSanitized: row.description,
      debitAmount: amountColumn === 'debit' ? amount : undefined,
      creditAmount: amountColumn === 'credit' ? amount : undefined,
      signedAmount: amountColumn === 'debit' ? -amount : amount,
      runningBalance,
      direction: amountColumn,
      currency
    };
  });

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    lines: lines.filter((line): line is BankAccountStatementLine => line !== undefined)
  };
}

function parseBDKPositionedAmount(value: string): number | undefined {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]+/g, '');

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  return Number.parseInt(normalized, 10);
}

function buildRejectedResult(
  errors: string[],
  warnings: string[],
  documentAnalysis: BDKAccountStatementPositionedDocumentAnalysisResult,
  options: BDKPositionedAccountStatementImportAdapterOptions
): BankAccountStatementImportResult {
  return {
    success: false,
    detectedFormat: DETECTED_FORMAT,
    bank: BANK,
    sourceFileName: options.sourceFileName,
    validation: buildInvalidValidation(documentAnalysis, errors, warnings),
    errors,
    warnings,
    rejectedReason: errors.join(' ')
  };
}

function buildInvalidValidation(
  documentAnalysis: BDKAccountStatementPositionedDocumentAnalysisResult,
  errors: string[],
  warnings: string[]
): BankAccountStatementValidation {
  const analysis = documentAnalysis.analysis;
  const closingBalance = analysis?.balances.closingBalance;
  const calculatedClosing = analysis?.validation?.calculatedClosing;

  return {
    calculatedClosing: calculatedClosing ?? 0,
    discrepancy: calculatedClosing !== undefined && closingBalance !== undefined
      ? calculatedClosing - closingBalance
      : 0,
    isValid: false,
    status: 'invalid',
    openingBalanceFound: analysis?.balances.openingBalanceFound ?? false,
    totalDebitsFound: false,
    totalCreditsFound: false,
    closingBalanceFound: analysis?.balances.closingBalanceFound ?? false,
    declaredTotalsMatchLines: undefined,
    lineBalancesConsistent: analysis?.validation?.success,
    errors,
    warnings
  };
}
