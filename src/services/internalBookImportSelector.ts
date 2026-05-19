import type { InternalBook, InternalBookParseResult } from '@/types/internalBook';

export type InternalBookSelectionMode = 'latest' | 'all';

export interface InternalBookImportSelection {
  mode: InternalBookSelectionMode;
  selectedBooks: InternalBook[];
  skippedOlderBooks: InternalBook[];
  retainedBooks: InternalBook[];
  selectedReportDate?: string;
  warnings: string[];
}

export function selectInternalBooksForImport(
  parseResult: InternalBookParseResult,
  mode: InternalBookSelectionMode = 'latest',
): InternalBookImportSelection {
  const retainedBooks = [...parseResult.books];

  if (mode === 'all') {
    return {
      mode,
      selectedBooks: [...retainedBooks],
      skippedOlderBooks: [],
      retainedBooks,
      warnings: [],
    };
  }

  if (retainedBooks.length === 0) {
    return {
      mode,
      selectedBooks: [],
      skippedOlderBooks: [],
      retainedBooks,
      warnings: [],
    };
  }

  const selectedReportDate = retainedBooks.reduce((latestDate, book) => {
    return book.reportDate > latestDate ? book.reportDate : latestDate;
  }, retainedBooks[0].reportDate);

  const selectedBooks = retainedBooks.filter((book) => book.reportDate === selectedReportDate);
  const skippedOlderBooks = retainedBooks.filter((book) => book.reportDate !== selectedReportDate);
  const warnings =
    selectedBooks.length > 1
      ? [`Multiple internal book sheets share the latest report date ${selectedReportDate}; all were selected.`]
      : [];

  return {
    mode,
    selectedBooks,
    skippedOlderBooks,
    retainedBooks,
    selectedReportDate,
    warnings,
  };
}
