import type {
  BDKAccountStatementPositionedBalancesResult
} from './bdkAccountStatementPositionedBalanceExtractor';
import {
  extractBDKAccountStatementPositionedBalances
} from './bdkAccountStatementPositionedBalanceExtractor';
import type { BDKPositionedRowsValidationResult } from './bdkAccountStatementPositionedRowsValidator';
import { validateBDKAccountStatementPositionedRows } from './bdkAccountStatementPositionedRowsValidator';
import type { BDKAccountStatementPositionalRowsResult } from './bdkAccountStatementPositionalRows';
import { reconstructBDKAccountStatementRows } from './bdkAccountStatementPositionalRows';
import type { TextItem } from './positionalExtractionService';

export interface BDKAccountStatementPositionedAnalysisResult {
  success: boolean;
  balances: BDKAccountStatementPositionedBalancesResult;
  rows: BDKAccountStatementPositionalRowsResult;
  validation?: BDKPositionedRowsValidationResult;
  errors: string[];
  warnings: string[];
}

export function analyzeBDKAccountStatementPositioned(
  items: TextItem[]
): BDKAccountStatementPositionedAnalysisResult {
  const balances = extractBDKAccountStatementPositionedBalances(items);
  const rows = reconstructBDKAccountStatementRows(items);
  const validation = balances.openingBalance === undefined
    ? undefined
    : validateBDKAccountStatementPositionedRows({
      openingBalance: balances.openingBalance,
      closingBalance: balances.closingBalance,
      positionedRows: rows.positionedRows
    });
  const errors = [
    ...balances.errors,
    ...rows.errors,
    ...(validation?.errors ?? [])
  ];
  const warnings = [
    ...balances.warnings,
    ...rows.warnings,
    ...(validation?.warnings ?? [])
  ];

  return {
    success: balances.errors.length === 0
      && rows.success
      && validation !== undefined
      && validation.success
      && errors.length === 0,
    balances,
    rows,
    validation,
    errors,
    warnings
  };
}
