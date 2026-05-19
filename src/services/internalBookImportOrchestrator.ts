import type { InternalBook, InternalBookParseResult } from '@/types/internalBook';
import {
  selectInternalBooksForImport,
  type InternalBookImportSelection,
  type InternalBookSelectionMode,
} from './internalBookImportSelector';

export type InternalBookImportMode = InternalBookSelectionMode;

export interface InternalBookImportOrchestrationOptions {
  mode?: InternalBookImportMode;
}

export interface InternalBookImportOrchestrationResult {
  parseResult: InternalBookParseResult;
  selection: InternalBookImportSelection;
  selectedBooks: InternalBook[];
  skippedOlderBooks: InternalBook[];
  retainedBooks: InternalBook[];
  warnings: string[];
}

export function orchestrateInternalBookImport(
  parseResult: InternalBookParseResult,
  options: InternalBookImportOrchestrationOptions = {},
): InternalBookImportOrchestrationResult {
  const selection = selectInternalBooksForImport(parseResult, options.mode ?? 'latest');

  return {
    parseResult,
    selection,
    selectedBooks: selection.selectedBooks,
    skippedOlderBooks: selection.skippedOlderBooks,
    retainedBooks: selection.retainedBooks,
    warnings: selection.warnings,
  };
}
