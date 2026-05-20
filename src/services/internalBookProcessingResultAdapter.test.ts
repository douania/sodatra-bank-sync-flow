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
import { adaptInternalBookImportResultToProcessingResult } from './internalBookProcessingResultAdapter';

function createIssue(
  code: InternalBookValidationIssue['code'],
  severity: InternalBookValidationIssue['severity'],
  message = `Synthetic ${code}`,
): InternalBookValidationIssue {
  return {
    code,
    severity,
    message,
    sheetName: '070526',
    section: 'totalBalanceA',
  };
}

function createBook(
  reportDate: string,
  sheetName = reportDate,
  status: InternalBookStatus = 'valid',
  issues: InternalBookValidationIssue[] = [],
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
      needsReview: status !== 'valid' || issues.some((issue) => issue.severity === 'error'),
      tolerance: 1,
      issues,
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

test('adapts a ready Internal Book import result to a successful legacy ProcessingResult without runtime data pollution', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const latestBook = createBook('2026-05-07', '070526');
  const importResult = buildInternalBookImportResult(
    orchestrateInternalBookImport(createParseResult([olderBook, latestBook])),
  );
  const processingResult = adaptInternalBookImportResultToProcessingResult(importResult);

  assert.equal(processingResult.success, true);
  assert.deepEqual(processingResult.data?.bankReports, []);
  assert.equal(processingResult.data?.fundPosition, undefined);
  assert.deepEqual(processingResult.data?.clientReconciliation, []);
  assert.deepEqual(processingResult.data?.collectionReports, []);
  assert.equal(processingResult.data?.syncResult, undefined);
  assert.deepEqual(processingResult.errors, []);
  assert.equal(processingResult.debugInfo.pipeline, 'internal_book');
  assert.equal(processingResult.debugInfo.status, 'ready');
  assert.deepEqual(processingResult.debugInfo.selectedSheetNames, ['070526']);
  assert.deepEqual(processingResult.debugInfo.skippedOlderSheetNames, ['050526']);
});

test('adapts needs_review to a failed ProcessingResult with selected book error details', () => {
  const issue = createIssue('A_MINUS_B_MISMATCH', 'error', 'Synthetic mismatch');
  const book = createBook('2026-05-07', '070526', 'needs_review', [issue]);
  const importResult = buildInternalBookImportResult(orchestrateInternalBookImport(createParseResult([book])));
  const processingResult = adaptInternalBookImportResultToProcessingResult(importResult);

  assert.equal(processingResult.success, false);
  assert.equal(processingResult.errors?.[0], 'Internal Book requires review before import.');
  assert.ok(processingResult.errors?.some((message) => message.includes('A_MINUS_B_MISMATCH [070526]')));
  assert.equal(processingResult.debugInfo.needsReview, true);
  assert.equal(processingResult.debugInfo.selectedBookIssues.length, 1);
  assert.deepEqual(processingResult.debugInfo.selectedBookIssues[0], {
    code: 'A_MINUS_B_MISMATCH',
    severity: 'error',
    message: 'Synthetic mismatch',
    section: 'totalBalanceA',
    sheetName: '070526',
    rowIndex: undefined,
    columnIndex: undefined,
  });
});

test('adapts unsupported and empty statuses without introducing fake bank reports', () => {
  const unsupportedResult = adaptInternalBookImportResultToProcessingResult(
    buildInternalBookImportResult(
      orchestrateInternalBookImport(createParseResult([createBook('2026-05-07', '070526', 'unsupported')]))
    ),
  );
  const emptyResult = adaptInternalBookImportResultToProcessingResult(
    buildInternalBookImportResult(orchestrateInternalBookImport(createParseResult([]))),
  );

  assert.equal(unsupportedResult.success, false);
  assert.equal(unsupportedResult.errors?.[0], 'Internal Book is unsupported and cannot be imported.');
  assert.deepEqual(unsupportedResult.data?.bankReports, []);
  assert.equal(emptyResult.success, false);
  assert.equal(emptyResult.errors?.[0], 'No Internal Book sheet was selected for import.');
  assert.deepEqual(emptyResult.data?.bankReports, []);
});

test('preserves parser warnings, parser errors, selection warnings, and ignored sheets in debug info', () => {
  const parserWarning = createIssue('INVALID_SHEET_DATE', 'warning', 'Invalid synthetic date');
  const parserError = createIssue('MISSING_REQUIRED_SECTION', 'error', 'Missing synthetic section');
  const ignoredSheet: InternalBookIgnoredSheet = {
    sheetName: 'README',
    reason: 'Synthetic ignored sheet',
    issue: parserWarning,
  };
  const firstLatestBook = createBook('2026-05-07', '070526-A');
  const secondLatestBook = createBook('2026-05-07', '070526-B');
  const importResult = buildInternalBookImportResult(
    orchestrateInternalBookImport(
      createParseResult([firstLatestBook, secondLatestBook], {
        errors: [parserError],
        warnings: [parserWarning],
        ignoredSheets: [ignoredSheet],
      }),
    ),
  );
  const processingResult = adaptInternalBookImportResultToProcessingResult(importResult);

  assert.equal(processingResult.success, true);
  assert.equal(processingResult.debugInfo.selectionWarnings.length, 1);
  assert.equal(processingResult.debugInfo.parserErrors.length, 1);
  assert.equal(processingResult.debugInfo.parserWarnings.length, 1);
  assert.equal(processingResult.debugInfo.summary.ignoredSheetCount, 1);
  assert.deepEqual(processingResult.debugInfo.selectedSheetNames, ['070526-A', '070526-B']);
});

test('returns defensive array copies and does not mutate the import result', () => {
  const book = createBook('2026-05-07', '070526');
  const importResult = buildInternalBookImportResult(orchestrateInternalBookImport(createParseResult([book])));
  const processingResult = adaptInternalBookImportResultToProcessingResult(importResult);

  processingResult.errors?.push('mutated externally');
  processingResult.debugInfo.selectedSheetNames.push('mutated-sheet');
  processingResult.debugInfo.selectionWarnings.push('mutated-warning');

  assert.deepEqual(importResult.selectionWarnings, []);
  assert.deepEqual(importResult.debugInfo.selectedSheetNames, ['070526']);
  assert.equal(processingResult.errors?.includes('mutated externally'), true);
});
