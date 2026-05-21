import {
  extractBDKAccountStatement,
  type BDKAccountStatementExtractionResult
} from './bdkAccountStatementExtractor';

export type BDKBankStatementDetectedFormat =
  | 'bdk_account_statement'
  | 'bdk_analysis_report'
  | 'unknown';

export interface BDKBankStatementDiagnosticResult {
  success: boolean;
  detectedFormat: BDKBankStatementDetectedFormat;
  accountStatement?: BDKAccountStatementExtractionResult;
  errors: string[];
}

const ACCOUNT_STATEMENT_MARKERS = [
  'EXTRAIT DE COMPTE',
  'SOLDE INITIAL (XOF)',
  'DEBIT',
  'CREDIT',
  'SOLDE (XOF) AU'
];

const ANALYSIS_REPORT_MARKERS = [
  'OPENING BALANCE',
  'DEPOSIT NOT YET CLEARED',
  'CHECK NOT YET CLEARED',
  'CLOSING BALANCE AS PER BOOK'
];

export function analyzeBDKBankStatementText(textContent: string): BDKBankStatementDiagnosticResult {
  const normalizedText = normalizeMarkers(textContent);

  if (hasMarkers(normalizedText, ACCOUNT_STATEMENT_MARKERS)) {
    const accountStatement = extractBDKAccountStatement(textContent);

    return {
      success: accountStatement.success,
      detectedFormat: 'bdk_account_statement',
      accountStatement,
      errors: accountStatement.errors
    };
  }

  if (hasMarkers(normalizedText, ANALYSIS_REPORT_MARKERS)) {
    return {
      success: false,
      detectedFormat: 'bdk_analysis_report',
      errors: ['BDK analysis report detected but not handled by this diagnostic service.']
    };
  }

  return {
    success: false,
    detectedFormat: 'unknown',
    errors: ['Unknown BDK bank statement format.']
  };
}

function hasMarkers(textContent: string, markers: string[]): boolean {
  return markers.every((marker) => textContent.includes(marker));
}

function normalizeMarkers(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}
