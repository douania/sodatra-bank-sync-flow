export type CollectionCapability =
  | 'ENTRY'
  | 'VALIDATE_REMITTANCE'
  | 'PROPOSE_MATCH'
  | 'CONFIRM_MATCH'
  | 'AUDIT';

export type ReceiptMethod = 'CHECK' | 'EFFECT' | 'TRANSFER' | 'CASH';
export type EvidenceBasis = 'EXACT_CREDIT' | 'NET_OF_DISCOUNT';

export interface CollectionAccount {
  id: string;
  bank: string;
  currency: string;
  safeAlias: string;
}

export interface CollectionEntryInput {
  clientName: string;
  method: ReceiptMethod;
  amount: number;
  currency: string;
  clientBank: string;
  depositAccountId: string;
  depositDate: string;
  declaredCreditDate: string;
  instrumentReference: string;
  maturityDate: string;
  invoiceReference: string;
  slipReference: string;
  businessNature: 'STANDARD' | 'PROROGATION';
  note: string;
}

export interface RemittanceWorkItem {
  remittanceId: string;
  remittanceCreatedBy: string;
  depositDate: string;
  depositAccountId: string;
  amount: number;
  currency: string;
  slipReference: string | null;
  remittanceStatus: string;
  itemId: string;
  itemStatus: string;
  receiptId: string;
  clientName: string;
  method: ReceiptMethod;
  clientBank: string | null;
  instrumentReference: string | null;
}

export interface CreditLine {
  id: string;
  canonicalUnitId: string;
  dailyLineHash: string;
  accountingDate: string;
  valueDate: string | null;
  description: string;
  amount: number;
  unallocatedAmount: number;
  currency: string;
  accountId: string;
  sourceAttemptId: string;
  sourceRawTextHash: string;
  referenceSignal: string;
  reasonCodes: string[];
}

export interface MatchProposal {
  id: string;
  createdAt: string;
  proposedBy: string;
  remittanceItemId: string;
  clientName: string;
  depositAccountId: string;
  accountAlias: string;
  nominalAmount: number;
  creditAmount: number;
  feeAmount: number;
  evidenceBasis: string;
  reason: string;
  accountingDate: string;
  description: string;
  referenceSignal: string;
  reasonCodes: string[];
  evidenceAvailable: boolean;
}

export interface RegisterRow {
  remittanceItemId: string;
  depositDate: string;
  clientName: string;
  receiptMethod: ReceiptMethod;
  instrumentReference: string | null;
  expectedAmount: number;
  settledGrossAmount: number;
  observedFeeAmount: number;
  netLiquidityAmount: number;
  currency: string;
  itemStatus: string;
  proofClass: string;
  declaredCreditDate: string | null;
  provenCreditDate: string | null;
  remainingAmount: number;
  currentExceptionCode: string | null;
}
