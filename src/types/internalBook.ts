export type InternalBookBank =
  | 'BIS'
  | 'BICIS'
  | 'BDK'
  | 'ORABANK'
  | 'BRIDGE'
  | 'ATLANTIK'
  | 'UNKNOWN';

export type InternalBookStatus = 'valid' | 'needs_review' | 'unsupported';

export type InternalBookSection =
  | 'openingBalance'
  | 'depositsNotYetCleared'
  | 'totalDeposits'
  | 'totalBalanceA'
  | 'checksNotYetCleared'
  | 'totalB'
  | 'closingBalanceC'
  | 'bankFacilities'
  | 'impayes';

export interface InternalBookMoneyCell {
  value: number;
  raw: unknown;
  sheetName: string;
  rowIndex: number;
  columnIndex: number;
  address?: string;
}

export interface InternalBookLine {
  label?: string;
  date?: string;
  reference?: string;
  clientCode?: string;
  description?: string;
  amount: InternalBookMoneyCell;
  rawRow?: unknown[];
}

export interface InternalBookFacilityLine {
  label: string;
  limit?: InternalBookMoneyCell;
  used?: InternalBookMoneyCell;
  balance?: InternalBookMoneyCell;
  rawRow?: unknown[];
}

export interface InternalBookFacilityTotals {
  limit?: number;
  used?: number;
  balance?: number;
}

export type InternalBookValidationIssueCode =
  | 'OPENING_PLUS_DEPOSITS_MISMATCH'
  | 'A_MINUS_B_MISMATCH'
  | 'IMPAYES_TOTAL_MISMATCH'
  | 'FACILITIES_TOTAL_MISMATCH'
  | 'STALE_OUTSTANDING_CHECK'
  | 'HIGH_RISK_STALE_OUTSTANDING_CHECK'
  | 'TOTAL_B_INCLUDES_STALE_CHECKS'
  | 'MISSING_REQUIRED_SECTION'
  | 'MISSING_REQUIRED_AMOUNT'
  | 'AMBIGUOUS_AMOUNT_COLUMN'
  | 'UNSUPPORTED_BANK'
  | 'UNSUPPORTED_SHEET'
  | 'EMPTY_SHEET'
  | 'INVALID_SHEET_DATE';

export interface InternalBookValidationIssue {
  code: InternalBookValidationIssueCode;
  severity: 'error' | 'warning';
  message: string;
  section?: InternalBookSection;
  sheetName?: string;
  rowIndex?: number;
  columnIndex?: number;
  expected?: number;
  actual?: number;
  discrepancy?: number;
  tolerance?: number;
}

export interface InternalBookValidation {
  status: InternalBookStatus;
  needsReview: boolean;
  tolerance: number;
  issues: InternalBookValidationIssue[];
  declaredTotalDeposits?: number;
  calculatedTotalDeposits: number;
  declaredTotalBalanceA?: number;
  calculatedTotalBalanceA?: number;
  declaredTotalChecks?: number;
  calculatedTotalChecks: number;
  calculatedTotalChecksOperational: number;
  calculatedTotalChecksPrudent: number;
  calculatedStaleOutstandingChecksRiskTotal: number;
  highRiskStaleOutstandingChecksTotal?: number;
  declaredClosingBalanceC?: number;
  calculatedClosingBalanceC?: number;
  declaredTotalImpayes?: number;
  calculatedTotalImpayes: number;
  declaredFacilitiesTotals?: InternalBookFacilityTotals;
  calculatedFacilitiesTotals: Required<InternalBookFacilityTotals>;
}

export interface InternalBookMetadata {
  parserVersion: string;
  parsedAt: string;
  workbookSheetCount: number;
  ignoredSheets: string[];
  labelProfile: string;
}

export interface InternalBook {
  bank: InternalBookBank;
  sourceFile: string;
  sheetName: string;
  reportDate: string;
  openingBalance?: InternalBookMoneyCell;
  depositsNotYetCleared: InternalBookLine[];
  totalDeposits?: InternalBookMoneyCell;
  totalBalanceA?: InternalBookMoneyCell;
  checksNotYetCleared: InternalBookLine[];
  staleOutstandingChecks: InternalBookLine[];
  totalB?: InternalBookMoneyCell;
  closingBalanceC?: InternalBookMoneyCell;
  bankFacilities: InternalBookFacilityLine[];
  impayes: InternalBookLine[];
  validation: InternalBookValidation;
  metadata: InternalBookMetadata;
}

export interface InternalBookIgnoredSheet {
  sheetName: string;
  reason: string;
  issue?: InternalBookValidationIssue;
}

export interface InternalBookParseResult {
  success: boolean;
  bank: InternalBookBank;
  sourceFile: string;
  books: InternalBook[];
  ignoredSheets: InternalBookIgnoredSheet[];
  errors: InternalBookValidationIssue[];
  warnings: InternalBookValidationIssue[];
}
