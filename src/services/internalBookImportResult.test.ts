import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  InternalBook,
  InternalBookIgnoredSheet,
  InternalBookParseResult,
  InternalBookStatus,
  InternalBookValidationIssue,
} from '@/types/internalBook';
import { orchestrateInternalBookImport } from './internalBookImportOrchestrator';
import { buildInternalBookImportResult } from './internalBookImportResult';

function createBook(
  reportDate: string,
  sheetName = reportDate,
  status: InternalBookStatus = 'valid',
  needsReview = status !== 'valid',
): InternalBook {
  return {
    bank: 'BIS',
    sourceFile: 'synthetic-internal-book.xlsx',
    sheetName,
    reportDate,
    depositsNotYetCleared: [],
    checksNotYetCleared: [],
    bankFacilities: [],
    impayes: [],
    validation: {
      status,
      needsReview,
      tolerance: 1,
      issues: [],
      calculatedTotalDeposits: 0,
      calculatedTotalChecks: 0,
      calculatedTotalImpayes: 0,
      calculatedFacilitiesTotals: {
        limit: 0,
        used: 0,
        balance: 0,
      },
    },
    metadata: {
      parserVersion: 'synthetic',
      parsedAt: '2026-05-20T00:00:00.000Z',
      workbookSheetCount: 1,
      ignoredSheets: [],
      labelProfile: 'synthetic',
    },
  };
}

function createIssue(code: InternalBookValidationIssue['code'], severity: InternalBookValidationIssue['severity']): InternalBookValidationIssue {
  return {
    code,
    severity,
    message: `Synthetic ${code}`,
    sheetName: '070526',
  };
}

function createParseResult(
  books: InternalBook[],
  overrides: Partial<InternalBookParseResult> = {},
): InternalBookParseResult {
  return {
    success: true,
    bank: 'BIS',
    sourceFile: 'synthetic-internal-book.xlsx',
    books,
    ignoredSheets: [],
    errors: [],
    warnings: [],
    ...overrides,
  };
}

test('builds a ready isolated import result for a valid selected latest book', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const latestBook = createBook('2026-05-07', '070526');
  const orchestrationResult = orchestrateInternalBookImport(createParseResult([olderBook, latestBook]));
  const result = buildInternalBookImportResult(orchestrationResult);

  assert.equal(result.kind, 'internal_book_import_result');
  assert.equal(result.pipeline, 'internal_book');
  assert.equal(result.status, 'ready');
  assert.equal(result.importable, true);
  assert.equal(result.needsReview, false);
  assert.equal(result.sourceFile, 'synthetic-internal-book.xlsx');
  assert.equal(result.bank, 'BIS');
  assert.equal(result.mode, 'latest');
  assert.deepEqual(result.selectedBooks, [latestBook]);
  assert.deepEqual(result.skippedOlderBooks, [olderBook]);
  assert.deepEqual(result.retainedBooks, [olderBook, latestBook]);
  assert.deepEqual(result.summary.selectedStatusCounts, { valid: 1, needs_review: 0, unsupported: 0 });
  assert.equal(result.summary.selectedReportDate, '2026-05-07');
  assert.deepEqual(result.debugInfo.selectedSheetNames, ['070526']);
});

test('builds needs_review when the selected latest book requires review', () => {
  const needsReviewBook = createBook('2026-05-07', '070526', 'needs_review', true);
  const orchestrationResult = orchestrateInternalBookImport(createParseResult([needsReviewBook]));
  const result = buildInternalBookImportResult(orchestrationResult);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.importable, false);
  assert.equal(result.needsReview, true);
  assert.deepEqual(result.summary.selectedStatusCounts, { valid: 0, needs_review: 1, unsupported: 0 });
});

test('builds unsupported when the selected latest book is unsupported', () => {
  const unsupportedBook = createBook('2026-05-07', '070526', 'unsupported', true);
  const orchestrationResult = orchestrateInternalBookImport(createParseResult([unsupportedBook]));
  const result = buildInternalBookImportResult(orchestrationResult);

  assert.equal(result.status, 'unsupported');
  assert.equal(result.importable, false);
  assert.equal(result.needsReview, true);
  assert.deepEqual(result.summary.selectedStatusCounts, { valid: 0, needs_review: 0, unsupported: 1 });
});

test('builds empty when no selected books and no parser errors exist', () => {
  const orchestrationResult = orchestrateInternalBookImport(createParseResult([]));
  const result = buildInternalBookImportResult(orchestrationResult);

  assert.equal(result.status, 'empty');
  assert.equal(result.importable, false);
  assert.equal(result.needsReview, false);
  assert.equal(result.summary.selectedCount, 0);
  assert.equal(result.summary.retainedCount, 0);
});

test('builds failed when no selected books exist but parser errors are present', () => {
  const parserError = createIssue('MISSING_REQUIRED_SECTION', 'error');
  const orchestrationResult = orchestrateInternalBookImport(
    createParseResult([], { success: false, errors: [parserError] }),
  );
  const result = buildInternalBookImportResult(orchestrationResult);

  assert.equal(result.status, 'failed');
  assert.equal(result.importable, false);
  assert.equal(result.needsReview, true);
  assert.deepEqual(result.parserErrors, [parserError]);
  assert.equal(result.summary.parserErrorCount, 1);
});

test('preserves selector warnings when multiple sheets share the latest report date', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const firstLatestBook = createBook('2026-05-07', '070526-A');
  const secondLatestBook = createBook('2026-05-07', '070526-B');
  const orchestrationResult = orchestrateInternalBookImport(
    createParseResult([olderBook, firstLatestBook, secondLatestBook]),
  );
  const result = buildInternalBookImportResult(orchestrationResult);

  assert.equal(result.status, 'ready');
  assert.equal(result.summary.selectedCount, 2);
  assert.equal(result.summary.skippedOlderCount, 1);
  assert.equal(result.selectionWarnings.length, 1);
  assert.match(result.selectionWarnings[0], /Multiple internal book sheets share the latest report date 2026-05-07/);
  assert.deepEqual(result.debugInfo.selectedSheetNames, ['070526-A', '070526-B']);
  assert.deepEqual(result.debugInfo.skippedOlderSheetNames, ['050526']);
});

test('preserves parser warnings and ignored sheets for auditability', () => {
  const book = createBook('2026-05-07', '070526');
  const parserWarning = createIssue('INVALID_SHEET_DATE', 'warning');
  const ignoredSheet: InternalBookIgnoredSheet = {
    sheetName: 'README',
    reason: 'Synthetic ignored sheet',
    issue: parserWarning,
  };
  const orchestrationResult = orchestrateInternalBookImport(
    createParseResult([book], { warnings: [parserWarning], ignoredSheets: [ignoredSheet] }),
  );
  const result = buildInternalBookImportResult(orchestrationResult);

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.parserWarnings, [parserWarning]);
  assert.deepEqual(result.ignoredSheets, [ignoredSheet]);
  assert.equal(result.summary.parserWarningCount, 1);
  assert.equal(result.summary.ignoredSheetCount, 1);
});

test('does not mutate orchestration arrays while building the result', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const latestBook = createBook('2026-05-07', '070526');
  const parseResult = createParseResult([olderBook, latestBook]);
  const orchestrationResult = orchestrateInternalBookImport(parseResult);
  const selectedBefore = orchestrationResult.selectedBooks.map((book) => book.sheetName);
  const skippedBefore = orchestrationResult.skippedOlderBooks.map((book) => book.sheetName);
  const retainedBefore = orchestrationResult.retainedBooks.map((book) => book.sheetName);

  const result = buildInternalBookImportResult(orchestrationResult);
  result.selectedBooks.push(createBook('2026-05-08', '080526'));
  result.skippedOlderBooks.length = 0;
  result.retainedBooks.reverse();

  assert.deepEqual(orchestrationResult.selectedBooks.map((book) => book.sheetName), selectedBefore);
  assert.deepEqual(orchestrationResult.skippedOlderBooks.map((book) => book.sheetName), skippedBefore);
  assert.deepEqual(orchestrationResult.retainedBooks.map((book) => book.sheetName), retainedBefore);
  assert.deepEqual(parseResult.books.map((book) => book.sheetName), ['050526', '070526']);
});
