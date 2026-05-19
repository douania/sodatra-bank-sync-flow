import assert from 'node:assert/strict';
import test from 'node:test';
import type { InternalBook, InternalBookParseResult } from '@/types/internalBook';
import { orchestrateInternalBookImport } from './internalBookImportOrchestrator';

function createBook(reportDate: string, sheetName = reportDate): InternalBook {
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
      status: 'valid',
      needsReview: false,
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
      parsedAt: '2026-05-19T00:00:00.000Z',
      workbookSheetCount: 1,
      ignoredSheets: [],
      labelProfile: 'synthetic',
    },
  };
}

function createParseResult(books: InternalBook[]): InternalBookParseResult {
  return {
    success: true,
    bank: 'BIS',
    sourceFile: 'synthetic-internal-book.xlsx',
    books,
    ignoredSheets: [],
    errors: [],
    warnings: [],
  };
}

test('orchestrates latest mode by selecting only the most recent report date', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const latestBook = createBook('2026-05-07', '070526');
  const parseResult = createParseResult([olderBook, latestBook]);
  const result = orchestrateInternalBookImport(parseResult);

  assert.equal(result.parseResult, parseResult);
  assert.equal(result.selection.mode, 'latest');
  assert.equal(result.selection.selectedReportDate, '2026-05-07');
  assert.deepEqual(result.selectedBooks, [latestBook]);
  assert.deepEqual(result.skippedOlderBooks, [olderBook]);
  assert.deepEqual(result.retainedBooks, [olderBook, latestBook]);
  assert.deepEqual(result.warnings, []);
});

test('orchestrates all mode by selecting every parsed book', () => {
  const books = [createBook('2026-05-05', '050526'), createBook('2026-05-07', '070526')];
  const result = orchestrateInternalBookImport(createParseResult(books), { mode: 'all' });

  assert.equal(result.selection.mode, 'all');
  assert.deepEqual(result.selectedBooks, books);
  assert.deepEqual(result.skippedOlderBooks, []);
  assert.deepEqual(result.retainedBooks, books);
});

test('retains all books while exposing skipped older books in latest mode', () => {
  const oldestBook = createBook('2026-05-01', '010526');
  const olderBook = createBook('2026-05-05', '050526');
  const latestBook = createBook('2026-05-07', '070526');
  const result = orchestrateInternalBookImport(createParseResult([oldestBook, latestBook, olderBook]));

  assert.deepEqual(result.selectedBooks, [latestBook]);
  assert.deepEqual(result.skippedOlderBooks, [oldestBook, olderBook]);
  assert.deepEqual(result.retainedBooks, [oldestBook, latestBook, olderBook]);
});

test('returns an empty orchestration result without throwing when there are no books', () => {
  const result = orchestrateInternalBookImport(createParseResult([]));

  assert.equal(result.selection.selectedReportDate, undefined);
  assert.deepEqual(result.selectedBooks, []);
  assert.deepEqual(result.skippedOlderBooks, []);
  assert.deepEqual(result.retainedBooks, []);
  assert.deepEqual(result.warnings, []);
});

test('selects all books tied on the latest report date and returns the selector warning', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const firstLatestBook = createBook('2026-05-07', '070526-A');
  const secondLatestBook = createBook('2026-05-07', '070526-B');
  const result = orchestrateInternalBookImport(
    createParseResult([olderBook, firstLatestBook, secondLatestBook]),
  );

  assert.equal(result.selection.selectedReportDate, '2026-05-07');
  assert.deepEqual(result.selectedBooks, [firstLatestBook, secondLatestBook]);
  assert.deepEqual(result.skippedOlderBooks, [olderBook]);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings, result.selection.warnings);
  assert.match(result.warnings[0], /Multiple internal book sheets share the latest report date 2026-05-07/);
});

test('does not refilter ignoredSheets and depends only on parseResult.books', () => {
  const book = createBook('2026-05-07', '070526');
  const parseResult = createParseResult([book]);
  parseResult.ignoredSheets = [{ sheetName: 'README', reason: 'synthetic ignored sheet' }];

  const result = orchestrateInternalBookImport(parseResult);

  assert.equal(result.parseResult.ignoredSheets, parseResult.ignoredSheets);
  assert.deepEqual(result.selectedBooks, [book]);
  assert.deepEqual(result.retainedBooks, [book]);
});

test('does not mutate parseResult.books order after orchestration', () => {
  const books = [
    createBook('2026-05-05', '050526'),
    createBook('2026-05-07', '070526'),
    createBook('2026-05-01', '010526'),
  ];
  const parseResult = createParseResult(books);
  const originalOrder = parseResult.books.map((book) => book.sheetName);

  orchestrateInternalBookImport(parseResult);

  assert.deepEqual(
    parseResult.books.map((book) => book.sheetName),
    originalOrder,
  );
});
