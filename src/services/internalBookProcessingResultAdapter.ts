import type { InternalBookValidationIssue } from '@/types/internalBook';
import type { InternalBookImportResult } from '@/types/internalBookImportResult';
import type { ProcessingResult } from '@/types/processing';

interface InternalBookProcessingDebugIssue {
  code: InternalBookValidationIssue['code'];
  severity: InternalBookValidationIssue['severity'];
  message: string;
  section?: string;
  sheetName?: string;
  rowIndex?: number;
  columnIndex?: number;
}

export interface InternalBookProcessingDebugInfo {
  pipeline: 'internal_book';
  sourceFile: string;
  bank: InternalBookImportResult['bank'];
  status: InternalBookImportResult['status'];
  importable: boolean;
  needsReview: boolean;
  mode: InternalBookImportResult['mode'];
  summary: InternalBookImportResult['summary'];
  selectedSheetNames: string[];
  skippedOlderSheetNames: string[];
  retainedSheetNames: string[];
  selectionWarnings: string[];
  parserErrors: InternalBookProcessingDebugIssue[];
  parserWarnings: InternalBookProcessingDebugIssue[];
  selectedBookIssues: InternalBookProcessingDebugIssue[];
}

export function adaptInternalBookImportResultToProcessingResult(
  importResult: InternalBookImportResult,
): ProcessingResult {
  return {
    success: importResult.importable,
    data: {
      bankReports: [],
      fundPosition: undefined,
      clientReconciliation: [],
      collectionReports: [],
      syncResult: undefined,
    },
    errors: buildProcessingErrors(importResult),
    debugInfo: buildDebugInfo(importResult),
  };
}

function buildProcessingErrors(importResult: InternalBookImportResult): string[] {
  const errors: string[] = [];

  if (!importResult.importable) {
    errors.push(resolveStatusMessage(importResult));
  }

  for (const issue of importResult.parserErrors) {
    errors.push(formatIssueMessage(issue));
  }

  for (const issue of collectSelectedBookErrorIssues(importResult)) {
    errors.push(formatIssueMessage(issue));
  }

  return unique(errors);
}

function resolveStatusMessage(importResult: InternalBookImportResult): string {
  switch (importResult.status) {
    case 'needs_review':
      return 'Internal Book requires review before import.';
    case 'unsupported':
      return 'Internal Book is unsupported and cannot be imported.';
    case 'empty':
      return 'No Internal Book sheet was selected for import.';
    case 'failed':
      return 'Internal Book import result failed before runtime integration.';
    case 'ready':
      return 'Internal Book import result is ready.';
  }
}

function buildDebugInfo(importResult: InternalBookImportResult): InternalBookProcessingDebugInfo {
  return {
    pipeline: 'internal_book',
    sourceFile: importResult.sourceFile,
    bank: importResult.bank,
    status: importResult.status,
    importable: importResult.importable,
    needsReview: importResult.needsReview,
    mode: importResult.mode,
    summary: importResult.summary,
    selectedSheetNames: [...importResult.debugInfo.selectedSheetNames],
    skippedOlderSheetNames: [...importResult.debugInfo.skippedOlderSheetNames],
    retainedSheetNames: [...importResult.debugInfo.retainedSheetNames],
    selectionWarnings: [...importResult.selectionWarnings],
    parserErrors: importResult.parserErrors.map(toDebugIssue),
    parserWarnings: importResult.parserWarnings.map(toDebugIssue),
    selectedBookIssues: collectSelectedBookIssues(importResult).map(toDebugIssue),
  };
}

function collectSelectedBookIssues(importResult: InternalBookImportResult): InternalBookValidationIssue[] {
  return importResult.selectedBooks.flatMap((book) => book.validation.issues);
}

function collectSelectedBookErrorIssues(importResult: InternalBookImportResult): InternalBookValidationIssue[] {
  return collectSelectedBookIssues(importResult).filter((issue) => issue.severity === 'error');
}

function toDebugIssue(issue: InternalBookValidationIssue): InternalBookProcessingDebugIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    section: issue.section,
    sheetName: issue.sheetName,
    rowIndex: issue.rowIndex,
    columnIndex: issue.columnIndex,
  };
}

function formatIssueMessage(issue: InternalBookValidationIssue): string {
  const location = issue.sheetName ? ` [${issue.sheetName}]` : '';
  return `${issue.code}${location}: ${issue.message}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
