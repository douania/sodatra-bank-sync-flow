import assert from 'node:assert/strict';
import test from 'node:test';
import type { InternalBook, InternalBookParseResult } from '@/types/internalBook';
import { selectInternalBooksForImport } from './internalBookImportSelector';

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

test('selects only the latest report date in latest mode', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const latestBook = createBook('2026-05-07', '070526');
  const result = selectInternalBooksForImport(createParseResult([olderBook, latestBook]));

  assert.equal(result.mode, 'latest');
  assert.equal(result.selectedReportDate, '2026-05-07');
  assert.deepEqual(result.selectedBooks, [latestBook]);
  assert.deepEqual(result.retainedBooks, [olderBook, latestBook]);
});

test('keeps every parsed book in all mode', () => {
  const books = [createBook('2026-05-05', '050526'), createBook('2026-05-07', '070526')];
  const result = selectInternalBooksForImport(createParseResult(books), 'all');

  assert.equal(result.mode, 'all');
  assert.equal(result.selectedReportDate, undefined);
  assert.deepEqual(result.selectedBooks, books);
  assert.deepEqual(result.skippedOlderBooks, []);
  assert.deepEqual(result.retainedBooks, books);
});

test('keeps older books available as skippedOlderBooks in latest mode', () => {
  const oldestBook = createBook('2026-05-01', '010526');
  const olderBook = createBook('2026-05-05', '050526');
  const latestBook = createBook('2026-05-07', '070526');
  const result = selectInternalBooksForImport(createParseResult([oldestBook, latestBook, olderBook]));

  assert.deepEqual(result.selectedBooks, [latestBook]);
  assert.deepEqual(result.skippedOlderBooks, [oldestBook, olderBook]);
  assert.deepEqual(result.retainedBooks, [oldestBook, latestBook, olderBook]);
});

test('returns an empty selection without throwing when there are no books', () => {
  const result = selectInternalBooksForImport(createParseResult([]));

  assert.equal(result.selectedReportDate, undefined);
  assert.deepEqual(result.selectedBooks, []);
  assert.deepEqual(result.skippedOlderBooks, []);
  assert.deepEqual(result.retainedBooks, []);
  assert.deepEqual(result.warnings, []);
});

test('selects every book tied on the latest report date and warns', () => {
  const olderBook = createBook('2026-05-05', '050526');
  const firstLatestBook = createBook('2026-05-07', '070526-A');
  const secondLatestBook = createBook('2026-05-07', '070526-B');
  const result = selectInternalBooksForImport(
    createParseResult([olderBook, firstLatestBook, secondLatestBook]),
  );

  assert.equal(result.selectedReportDate, '2026-05-07');
  assert.deepEqual(result.selectedBooks, [firstLatestBook, secondLatestBook]);
  assert.deepEqual(result.skippedOlderBooks, [olderBook]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Multiple internal book sheets share the latest report date 2026-05-07/);
});

test('does not mutate the original books order', () => {
  const books = [
    createBook('2026-05-05', '050526'),
    createBook('2026-05-07', '070526'),
    createBook('2026-05-01', '010526'),
  ];
  const parseResult = createParseResult(books);
  const originalOrder = parseResult.books.map((book) => book.sheetName);

  selectInternalBooksForImport(parseResult);

  assert.deepEqual(
    parseResult.books.map((book) => book.sheetName),
    originalOrder,
  );
});

test('depends only on parsed books and ignores parser sheet filtering details', () => {
  const book = createBook('2026-05-07', '070526');
  const parseResult = createParseResult([book]);
  parseResult.ignoredSheets = [{ sheetName: 'NOTES', reason: 'synthetic ignored sheet' }];

  const result = selectInternalBooksForImport(parseResult);

  assert.deepEqual(result.selectedBooks, [book]);
  assert.deepEqual(result.retainedBooks, [book]);
});
