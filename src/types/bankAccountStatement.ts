export type BankAccountStatementLineDirection = 'debit' | 'credit' | 'unknown';

export type BankAccountStatementValidationStatus =
  | 'valid'
  | 'needs_review'
  | 'invalid'
  | 'unsupported';

export interface BankAccountStatementAccountIdentity {
  accountNumberMasked: string;
  accountFingerprint?: string;
}

export interface BankAccountStatementValidation {
  calculatedClosing: number;
  discrepancy: number;
  isValid: boolean;
  status: BankAccountStatementValidationStatus;
  openingBalanceFound: boolean;
  totalDebitsFound: boolean;
  totalCreditsFound: boolean;
  closingBalanceFound: boolean;
  declaredTotalsMatchLines?: boolean;
  lineBalancesConsistent?: boolean;
  errors: string[];
  warnings: string[];
}

export interface BankAccountStatementLine {
  id?: string;
  statementId?: string;
  sourceLineIndex: number;
  transactionDate?: string;
  valueDate?: string;
  descriptionSanitized: string;
  referenceSanitized?: string;
  counterpartyMasked?: string;
  debitAmount?: number;
  creditAmount?: number;
  signedAmount: number;
  runningBalance?: number;
  direction: BankAccountStatementLineDirection;
  currency?: string;
  lineHash?: string;
  errors?: string[];
  warnings?: string[];
}

export interface BankAccountStatement {
  id?: string;
  bank: string;
  currency: string;
  periodStartDate?: string;
  periodEndDate?: string;
  statementDate?: string;
  closingDate?: string;
  accountIdentity: BankAccountStatementAccountIdentity;
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  lines: BankAccountStatementLine[];
  validation: BankAccountStatementValidation;
  sourceFileName?: string;
  sourceFormat: string;
  importId?: string;
  rawTextHash?: string;
  status: BankAccountStatementValidationStatus;
  errors: string[];
  warnings: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BankAccountStatementImportResult {
  success: boolean;
  statement?: BankAccountStatement;
  detectedFormat: string;
  bank: string;
  sourceFileName?: string;
  validation: BankAccountStatementValidation;
  errors: string[];
  warnings: string[];
  rejectedReason?: string;
}
