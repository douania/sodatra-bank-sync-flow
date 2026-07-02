/**
 * Runtime diagnostic surface for structured bank statement CSV exports
 * (POC-BANK-STRUCTURED-EXPORTS-0E).
 *
 * This service is a THIN, READ-ONLY boundary around the pure parser
 * `parseStructuredBankStatementCsv`. Its only job is to:
 *  - fail closed on anything that is not a `.csv` file (before any I/O),
 *  - decode the raw bytes as Windows-1252 at the runtime boundary,
 *  - run the pure parser,
 *  - return a SAFE SUMMARY only.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - never returns or logs the raw CSV text,
 *  - never returns the full transaction lines or their sanitized descriptions,
 *  - never maps to `BankAccountStatement`,
 *  - never writes to any database and never touches the PDF fallback,
 *  - `ingestionAllowed` is always `false` in this lot.
 */

import {
  parseStructuredBankStatementCsv,
  type StructuredBankStatementDelimiter,
  type StructuredBankStatementDocument,
  type StructuredBankStatementStatus
} from './structuredBankStatementCsvParser';

/**
 * Minimal `File`-compatible shape. Kept intentionally small so the service can
 * be exercised in Node tests without a DOM `File`.
 */
export interface StructuredBankStatementCsvFileLike {
  name: string;
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StructuredBankStatementCsvDiagnostic {
  detectedFormat: 'structured_bank_statement_csv';
  sourceFileName: string;

  /** True only when the parser reconciled to a fully valid statement. */
  success: boolean;
  /** Ingestion is out of scope for this lot; always false. */
  ingestionAllowed: false;
  /** True when the parser produced an exploitable document (i.e. a .csv was parsed). */
  diagnosticCompleted: boolean;
  /** Marker that the raw CSV content is never surfaced by this service. */
  rawContentHidden: true;

  bankHint?: StructuredBankStatementDocument['bankHint'];
  detectedDelimiter?: StructuredBankStatementDelimiter;
  status?: StructuredBankStatementStatus;
  currency?: string;
  accountNumberMasked?: string;
  periodStart?: string;
  periodEnd?: string;
  statementDate?: string;

  lineCount: number;
  debitLineCount: number;
  creditLineCount: number;
  unknownLineCount: number;

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

const DETECTED_FORMAT = 'structured_bank_statement_csv' as const;
const NON_CSV_ERROR =
  'Only .csv files are supported for structured bank statement diagnostics.';

/**
 * Diagnose a structured bank statement CSV file and return a safe summary.
 *
 * Fail-closed contract: a non-`.csv` file is rejected BEFORE `arrayBuffer()` is
 * ever read, so no bytes are decoded for an unsupported input.
 */
export async function runStructuredBankStatementCsvDiagnostic(
  file: StructuredBankStatementCsvFileLike
): Promise<StructuredBankStatementCsvDiagnostic> {
  const sourceFileName = file.name;

  if (!isCsvFileName(sourceFileName)) {
    return buildRejectedDiagnostic(sourceFileName, NON_CSV_ERROR);
  }

  const buffer = await file.arrayBuffer();
  const rawCsv = decodeWindows1252(buffer);

  // The pure parser performs no I/O and returns an intermediate document. We map
  // only its safe, aggregate fields into the diagnostic summary below.
  const document = parseStructuredBankStatementCsv(rawCsv, { sourceFileName });

  return buildDiagnosticFromDocument(sourceFileName, document);
}

function isCsvFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.csv');
}

function decodeWindows1252(buffer: ArrayBuffer): string {
  // Structured exports are emitted as Windows-1252; decoding happens at this
  // runtime boundary only, never inside the pure parser.
  return new TextDecoder('windows-1252').decode(new Uint8Array(buffer));
}

function buildDiagnosticFromDocument(
  sourceFileName: string,
  document: StructuredBankStatementDocument
): StructuredBankStatementCsvDiagnostic {
  const validation = document.validation;

  let debitLineCount = 0;
  let creditLineCount = 0;
  let unknownLineCount = 0;
  for (const line of document.lines) {
    if (line.direction === 'debit') {
      debitLineCount++;
    } else if (line.direction === 'credit') {
      creditLineCount++;
    } else {
      unknownLineCount++;
    }
  }

  return {
    detectedFormat: DETECTED_FORMAT,
    sourceFileName,
    success: validation.status === 'valid',
    ingestionAllowed: false,
    diagnosticCompleted: true,
    rawContentHidden: true,
    bankHint: document.bankHint,
    detectedDelimiter: document.detectedDelimiter,
    status: validation.status,
    currency: document.currency,
    accountNumberMasked: document.accountNumberMasked,
    periodStart: document.periodStart,
    periodEnd: document.periodEnd,
    statementDate: document.statementDate,
    lineCount: document.lines.length,
    debitLineCount,
    creditLineCount,
    unknownLineCount,
    openingBalanceFound: validation.openingBalanceFound,
    closingBalanceFound: validation.closingBalanceFound,
    declaredTotalsFound: validation.declaredTotalsFound,
    declaredTotalsMatchLines: validation.declaredTotalsMatchLines,
    lineBalancesConsistent: validation.lineBalancesConsistent,
    computedClosingBalance: validation.computedClosingBalance,
    closingBalanceDiscrepancy: validation.closingBalanceDiscrepancy,
    errors: [...validation.errors],
    warnings: [...validation.warnings]
  };
}

function buildRejectedDiagnostic(
  sourceFileName: string,
  error: string
): StructuredBankStatementCsvDiagnostic {
  return {
    detectedFormat: DETECTED_FORMAT,
    sourceFileName,
    success: false,
    ingestionAllowed: false,
    diagnosticCompleted: false,
    rawContentHidden: true,
    lineCount: 0,
    debitLineCount: 0,
    creditLineCount: 0,
    unknownLineCount: 0,
    openingBalanceFound: false,
    closingBalanceFound: false,
    declaredTotalsFound: false,
    errors: [error],
    warnings: []
  };
}
