import type { InternalBookStatus } from '@/types/internalBook';
import type {
  InternalBookImportResult,
  InternalBookImportResultStatus,
} from '@/types/internalBookImportResult';
import type { InternalBookImportOrchestrationResult } from './internalBookImportOrchestrator';

const EMPTY_SELECTED_STATUS_COUNTS: Record<InternalBookStatus, number> = {
  valid: 0,
  needs_review: 0,
  unsupported: 0,
};

export function buildInternalBookImportResult(
  orchestrationResult: InternalBookImportOrchestrationResult,
): InternalBookImportResult {
  const selectedStatusCounts = countSelectedStatuses(orchestrationResult.selectedBooks);
  const status = resolveImportResultStatus(orchestrationResult, selectedStatusCounts);
  const needsReview = status === 'needs_review' || status === 'unsupported' || status === 'failed';

  return {
    kind: 'internal_book_import_result',
    pipeline: 'internal_book',
    status,
    importable: status === 'ready',
    needsReview,
    sourceFile: orchestrationResult.parseResult.sourceFile,
    bank: orchestrationResult.parseResult.bank,
    mode: orchestrationResult.selection.mode,
    selectedBooks: [...orchestrationResult.selectedBooks],
    skippedOlderBooks: [...orchestrationResult.skippedOlderBooks],
    retainedBooks: [...orchestrationResult.retainedBooks],
    ignoredSheets: [...orchestrationResult.parseResult.ignoredSheets],
    parserErrors: [...orchestrationResult.parseResult.errors],
    parserWarnings: [...orchestrationResult.parseResult.warnings],
    selectionWarnings: [...orchestrationResult.warnings],
    summary: {
      selectedCount: orchestrationResult.selectedBooks.length,
      skippedOlderCount: orchestrationResult.skippedOlderBooks.length,
      retainedCount: orchestrationResult.retainedBooks.length,
      ignoredSheetCount: orchestrationResult.parseResult.ignoredSheets.length,
      parserErrorCount: orchestrationResult.parseResult.errors.length,
      parserWarningCount: orchestrationResult.parseResult.warnings.length,
      selectedReportDate: orchestrationResult.selection.selectedReportDate,
      selectedStatusCounts,
    },
    debugInfo: {
      parserSuccess: orchestrationResult.parseResult.success,
      parsedBookCount: orchestrationResult.parseResult.books.length,
      selectedSheetNames: orchestrationResult.selectedBooks.map((book) => book.sheetName),
      skippedOlderSheetNames: orchestrationResult.skippedOlderBooks.map((book) => book.sheetName),
      retainedSheetNames: orchestrationResult.retainedBooks.map((book) => book.sheetName),
    },
  };
}

function resolveImportResultStatus(
  orchestrationResult: InternalBookImportOrchestrationResult,
  selectedStatusCounts: Record<InternalBookStatus, number>,
): InternalBookImportResultStatus {
  if (orchestrationResult.selectedBooks.length === 0) {
    return orchestrationResult.parseResult.errors.length > 0 ? 'failed' : 'empty';
  }

  if (selectedStatusCounts.unsupported > 0) {
    return 'unsupported';
  }

  if (
    selectedStatusCounts.needs_review > 0 ||
    orchestrationResult.selectedBooks.some((book) => book.validation.needsReview)
  ) {
    return 'needs_review';
  }

  return 'ready';
}

function countSelectedStatuses(books: InternalBookImportOrchestrationResult['selectedBooks']): Record<InternalBookStatus, number> {
  return books.reduce<Record<InternalBookStatus, number>>(
    (counts, book) => ({
      ...counts,
      [book.validation.status]: counts[book.validation.status] + 1,
    }),
    { ...EMPTY_SELECTED_STATUS_COUNTS },
  );
}
