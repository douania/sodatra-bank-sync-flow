import type {
  BDKAccountStatementPositionedAnalysisResult
} from './bdkAccountStatementPositionedAnalyzer';
import { analyzeBDKAccountStatementPositioned } from './bdkAccountStatementPositionedAnalyzer';
import type { PositionalData } from './positionalExtractionService';

export interface BDKAccountStatementPositionedDocumentAnalysisResult {
  success: boolean;
  analysis?: BDKAccountStatementPositionedAnalysisResult;
  pageCount: number;
  itemCount: number;
  analyzedPageIndexes: number[];
  errors: string[];
  warnings: string[];
}

export function analyzeBDKAccountStatementPositionedDocument(
  pages: PositionalData[]
): BDKAccountStatementPositionedDocumentAnalysisResult {
  const pageCount = pages.length;
  const analyzedPageIndexes = pages.flatMap((page, index) => (
    page.items.length > 0 ? [index] : []
  ));
  const allItems = pages.flatMap((page) => page.items);
  const itemCount = allItems.length;

  if (pageCount === 0) {
    return buildRejectedDocumentResult(
      pageCount,
      itemCount,
      analyzedPageIndexes,
      'No BDK positioned document pages to analyze.'
    );
  }

  if (itemCount === 0) {
    return buildRejectedDocumentResult(
      pageCount,
      itemCount,
      analyzedPageIndexes,
      'No BDK positioned document text items to analyze.'
    );
  }

  const analysis = analyzeBDKAccountStatementPositioned(allItems);

  return {
    success: analysis.success,
    analysis,
    pageCount,
    itemCount,
    analyzedPageIndexes,
    errors: analysis.errors,
    warnings: analysis.warnings
  };
}

function buildRejectedDocumentResult(
  pageCount: number,
  itemCount: number,
  analyzedPageIndexes: number[],
  error: string
): BDKAccountStatementPositionedDocumentAnalysisResult {
  return {
    success: false,
    pageCount,
    itemCount,
    analyzedPageIndexes,
    errors: [error],
    warnings: []
  };
}
