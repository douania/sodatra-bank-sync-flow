import type { ProcessingResult } from '@/types/processing';
import type { InternalBookFileDetectionResult } from './internalBookFileDetection';
import { detectInternalBookFile } from './internalBookFileDetection';
import { internalBookExcelParser } from './internalBookExcelParser';
import {
  orchestrateInternalBookImport,
  type InternalBookImportMode,
} from './internalBookImportOrchestrator';
import { buildInternalBookImportResult } from './internalBookImportResult';
import { adaptInternalBookImportResultToProcessingResult } from './internalBookProcessingResultAdapter';

export interface InternalBookRuntimeProcessingOptions {
  mode?: InternalBookImportMode;
}

export interface InternalBookRuntimeProcessingResult {
  detection: InternalBookFileDetectionResult;
  processingResult: ProcessingResult;
}

const NON_INTERNAL_BOOK_DETECTION: InternalBookFileDetectionResult = {
  isInternalBook: false,
  confidence: 'low',
  reason: 'File extension is not supported for Internal Book detection.',
  detectedDailySheets: [],
  ignoredSheets: [],
  matchedSignals: [],
};

export async function detectInternalBookRuntimeFile(file: File): Promise<InternalBookFileDetectionResult> {
  if (!isExcelFile(file)) {
    return { ...NON_INTERNAL_BOOK_DETECTION };
  }

  return detectInternalBookFile(file);
}

export async function processInternalBookRuntimeFile(
  file: File,
  options: InternalBookRuntimeProcessingOptions = {},
): Promise<InternalBookRuntimeProcessingResult> {
  const detection = await detectInternalBookRuntimeFile(file);
  const mode = options.mode ?? 'latest';

  if (!detection.isInternalBook) {
    return {
      detection,
      processingResult: createEmptyProcessingResult(false, [
        `File is not an Internal Book: ${detection.reason}`,
      ]),
    };
  }

  const parseResult = await internalBookExcelParser.parseFile(file);
  const orchestrationResult = orchestrateInternalBookImport(parseResult, { mode });
  const importResult = buildInternalBookImportResult(orchestrationResult);
  const processingResult = adaptInternalBookImportResultToProcessingResult(importResult);

  return {
    detection,
    processingResult: {
      ...processingResult,
      debugInfo: {
        internalBooks: [
          {
            detection,
            ...processingResult.debugInfo,
          },
        ],
      },
    },
  };
}

export function appendInternalBookProcessingResult(
  target: ProcessingResult,
  source: InternalBookRuntimeProcessingResult,
): void {
  ensureProcessingData(target);

  const sourceResult = source.processingResult;
  const internalBooks = sourceResult.debugInfo?.internalBooks ?? [
    {
      detection: source.detection,
      ...sourceResult.debugInfo,
    },
  ];

  target.debugInfo = {
    ...(target.debugInfo ?? {}),
    internalBooks: [
      ...((target.debugInfo?.internalBooks ?? []) as unknown[]),
      ...internalBooks,
    ],
  };

  if (sourceResult.errors?.length) {
    target.errors = [...(target.errors ?? []), ...sourceResult.errors];
  }
}

function createEmptyProcessingResult(success: boolean, errors: string[]): ProcessingResult {
  return {
    success,
    data: {
      bankReports: [],
      fundPosition: undefined,
      clientReconciliation: [],
      collectionReports: [],
      syncResult: undefined,
    },
    errors,
    debugInfo: {
      internalBooks: [],
    },
  };
}

function ensureProcessingData(result: ProcessingResult): void {
  result.data ??= {
    bankReports: [],
    fundPosition: undefined,
    clientReconciliation: [],
    collectionReports: [],
    syncResult: undefined,
  };
  result.data.bankReports ??= [];
  result.data.collectionReports ??= [];
  result.data.clientReconciliation ??= [];
}

function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.xlsx') || name.endsWith('.xls');
}
