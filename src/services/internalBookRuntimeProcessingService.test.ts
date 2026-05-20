import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  appendInternalBookProcessingResult,
  detectInternalBookRuntimeFile,
  processInternalBookRuntimeFile,
} from './internalBookRuntimeProcessingService';
import type { ProcessingResult } from '@/types/processing';

function createWorkbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }

  return workbook;
}

function internalBookRows(overrides: Partial<{
  totalBalanceA: number;
  totalB: number;
  closingBalance: number;
}> = {}): unknown[][] {
  const totalBalanceA = overrides.totalBalanceA ?? 1_100_000;
  const totalB = overrides.totalB ?? 75_000;
  const closingBalance = overrides.closingBalance ?? 1_025_000;

  return [
    ['OPENING BALANCE', 1_000_000],
    ['DEPOSIT NOT YET CLEARED'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ['05/05/2026', 'DEP-SYN-001', 'Synthetic deposit', 100_000],
    ['TOTAL DEPOSIT', 100_000],
    ['TOTAL BALANCE (A)', totalBalanceA],
    ['CHECK NOT YET CLEARED'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ['05/05/2026', 'CHK-SYN-001', 'Synthetic check A', 50_000],
    ['05/05/2026', 'CHK-SYN-002', 'Synthetic check B', 25_000],
    ['TOTAL (B)', totalB],
    ['CLOSING BALANCE C', closingBalance],
    ['BANK FACILITY'],
    ['FACILITY', 'LIMIT', 'USED', 'BALANCE'],
    ['Synthetic facility', 500_000, 0, 500_000],
    ['TOTAL', 500_000, 0, 500_000],
    ['IMPAYE'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ['05/05/2026', 'UNP-SYN-001', 'Synthetic unpaid A', 10_000],
    ['05/05/2026', 'UNP-SYN-002', 'Synthetic unpaid B', 20_000],
    ['TOTAL IMPAYES', 30_000],
  ];
}

function workbookFile(workbook: XLSX.WorkBook, filename: string): File {
  const content = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([content], filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    lastModified: Date.UTC(2026, 4, 20),
  });
}

test('detects a synthetic Internal Book workbook with daily sheets', async () => {
  const file = workbookFile(
    createWorkbook({
      '050526': internalBookRows(),
      '070526': internalBookRows(),
      README: [['Synthetic notes only']],
    }),
    'synthetic-BDK-internal-book.xlsx',
  );

  const detection = await detectInternalBookRuntimeFile(file);

  assert.equal(detection.isInternalBook, true);
  assert.equal(detection.confidence, 'high');
  assert.deepEqual(detection.detectedDailySheets, ['050526', '070526']);
  assert.deepEqual(detection.ignoredSheets, ['README']);
});

test('processInternalBookRuntimeFile selects latest by default and keeps legacy ProcessingResult data empty', async () => {
  const file = workbookFile(
    createWorkbook({
      '050526': internalBookRows(),
      '070526': internalBookRows(),
    }),
    'synthetic-BDK-internal-book.xlsx',
  );

  const result = await processInternalBookRuntimeFile(file);
  const processingResult = result.processingResult;

  assert.equal(processingResult.success, true);
  assert.deepEqual(processingResult.data?.bankReports, []);
  assert.deepEqual(processingResult.data?.collectionReports, []);
  assert.equal(processingResult.data?.fundPosition, undefined);
  assert.deepEqual(processingResult.data?.clientReconciliation, []);
  assert.deepEqual(processingResult.errors, []);
  assert.equal(processingResult.debugInfo.internalBooks[0].pipeline, 'internal_book');
  assert.equal(processingResult.debugInfo.internalBooks[0].mode, 'latest');
  assert.deepEqual(processingResult.debugInfo.internalBooks[0].selectedSheetNames, ['070526']);
  assert.deepEqual(processingResult.debugInfo.internalBooks[0].skippedOlderSheetNames, ['050526']);
});

test('appendInternalBookProcessingResult stores audit details under debugInfo.internalBooks', async () => {
  const target: ProcessingResult = {
    success: false,
    data: {
      bankReports: [],
      fundPosition: undefined,
      clientReconciliation: [],
      collectionReports: [],
      syncResult: undefined,
    },
    errors: [],
  };
  const source = await processInternalBookRuntimeFile(
    workbookFile(createWorkbook({ '070526': internalBookRows() }), 'synthetic-BIS-internal-book.xlsx'),
  );

  appendInternalBookProcessingResult(target, source);

  assert.deepEqual(target.data?.bankReports, []);
  assert.deepEqual(target.data?.collectionReports, []);
  assert.equal(target.data?.fundPosition, undefined);
  assert.deepEqual(target.data?.clientReconciliation, []);
  assert.equal(target.debugInfo?.internalBooks.length, 1);
  assert.equal(target.debugInfo?.internalBooks[0].sourceFile, 'synthetic-BIS-internal-book.xlsx');
});

test('returns success false with errors for an unsupported Internal Book', async () => {
  const file = workbookFile(
    createWorkbook({
      '070526': internalBookRows(),
    }),
    'synthetic-unknown-internal-book.xlsx',
  );

  const result = await processInternalBookRuntimeFile(file);

  assert.equal(result.processingResult.success, false);
  assert.ok(result.processingResult.errors?.includes('Internal Book is unsupported and cannot be imported.'));
  assert.equal(result.processingResult.debugInfo.internalBooks[0].status, 'unsupported');
});

test('returns success false with errors for an Internal Book that needs review', async () => {
  const file = workbookFile(
    createWorkbook({
      '070526': internalBookRows({ closingBalance: 1_024_000 }),
    }),
    'synthetic-BIS-internal-book-needs-review.xlsx',
  );

  const result = await processInternalBookRuntimeFile(file);

  assert.equal(result.processingResult.success, false);
  assert.ok(result.processingResult.errors?.some((error) => error.includes('Internal Book requires review before import.')));
  assert.equal(result.processingResult.debugInfo.internalBooks[0].status, 'needs_review');
});

test('does not detect non Internal Book workbooks or non-Excel files', async () => {
  const collectionReport = workbookFile(
    createWorkbook({
      Collections: [
        ['DATE', 'CLIENT NAME', 'AMOUNT'],
        ['2026-05-05', 'Synthetic client', 100],
      ],
    }),
    'synthetic-collection-report.xlsx',
  );
  const textFile = new File(['Synthetic text only'], 'synthetic-internal-book.csv', { type: 'text/csv' });

  const collectionDetection = await detectInternalBookRuntimeFile(collectionReport);
  const textDetection = await detectInternalBookRuntimeFile(textFile);

  assert.equal(collectionDetection.isInternalBook, false);
  assert.equal(textDetection.isInternalBook, false);
  assert.equal(textDetection.reason, 'File extension is not supported for Internal Book detection.');
});
