import type {
  InternalBook,
  InternalBookBank,
  InternalBookIgnoredSheet,
  InternalBookStatus,
  InternalBookValidationIssue,
} from '@/types/internalBook';

export type InternalBookImportResultStatus = 'ready' | 'needs_review' | 'unsupported' | 'empty' | 'failed';

export type InternalBookImportResultMode = 'latest' | 'all';

export interface InternalBookImportResultSummary {
  selectedCount: number;
  skippedOlderCount: number;
  retainedCount: number;
  ignoredSheetCount: number;
  parserErrorCount: number;
  parserWarningCount: number;
  selectedReportDate?: string;
  selectedStatusCounts: Record<InternalBookStatus, number>;
}

export interface InternalBookImportResultDebugInfo {
  parserSuccess: boolean;
  parsedBookCount: number;
  selectedSheetNames: string[];
  skippedOlderSheetNames: string[];
  retainedSheetNames: string[];
}

export interface InternalBookImportResult {
  kind: 'internal_book_import_result';
  pipeline: 'internal_book';
  status: InternalBookImportResultStatus;
  importable: boolean;
  needsReview: boolean;
  sourceFile: string;
  bank: InternalBookBank;
  mode: InternalBookImportResultMode;
  selectedBooks: InternalBook[];
  skippedOlderBooks: InternalBook[];
  retainedBooks: InternalBook[];
  ignoredSheets: InternalBookIgnoredSheet[];
  parserErrors: InternalBookValidationIssue[];
  parserWarnings: InternalBookValidationIssue[];
  selectionWarnings: string[];
  summary: InternalBookImportResultSummary;
  debugInfo: InternalBookImportResultDebugInfo;
}
