export type BankStatementSignMode = 'column' | 'signed';

export type PositionedBankStatementColumnKey =
  | 'transactionDate'
  | 'valueDate'
  | 'description'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'signedAmount'
  | 'balance';

export type PositionedBankStatementDirection = 'debit' | 'credit' | 'unknown';

export interface BankStatementAmountFormat {
  thousandSeparators: readonly string[];
  decimalSeparator?: string;
}

export interface BankStatementSummaryRules {
  opening: readonly string[];
  totals: readonly string[];
  closing: readonly string[];
}

export interface BankStatementProfile {
  id: string;
  bank: string;
  signMode: BankStatementSignMode;
  expectedColumns: readonly PositionedBankStatementColumnKey[];
  headerAliases: Partial<Record<PositionedBankStatementColumnKey, readonly string[]>>;
  dateFormat: string;
  amountFormat: BankStatementAmountFormat;
  summaryRules: BankStatementSummaryRules;
}

export type PositionedBankStatementAmountColumn = Extract<
  PositionedBankStatementColumnKey,
  'debit' | 'credit' | 'signedAmount'
>;

export interface PositionedBankStatementRow {
  sourceRowIndex: number;
  transactionDate: string;
  valueDate: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  amountColumn?: PositionedBankStatementAmountColumn;
  direction: PositionedBankStatementDirection;
}

export interface PositionedBankStatementExtractionResult {
  success: boolean;
  profile: BankStatementProfile;
  positionedRows: PositionedBankStatementRow[];
  errors: string[];
  warnings: string[];
}
