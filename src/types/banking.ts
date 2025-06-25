
export interface BankFacility {
  facilityType: string;
  limitAmount: number;
  usedAmount: number;
  availableAmount: number;
}

export interface DepositNotCleared {
  dateDepot: string;
  dateValeur?: string;
  typeReglement: string;
  reference?: string;
  clientCode?: string;
  montant: number;
}

export interface Impaye {
  dateRetour?: string;
  dateEcheance: string;
  clientCode: string;
  description?: string;
  montant: number;
}

export interface CheckNotCleared {
  dateEmission: string;
  numeroCheque: string;
  beneficiaire?: string;
  montant: number;
}

export interface BankReport {
  id?: string;
  bank: string;
  date: string;
  openingBalance: number;
  closingBalance: number;
  bankFacilities: BankFacility[];
  depositsNotCleared: DepositNotCleared[];
  checksNotCleared?: CheckNotCleared[];
  impayes: Impaye[];
}

export interface FundPosition {
  reportDate: string;
  totalFundAvailable: number;
  collectionsNotDeposited: number;
  grandTotal: number;
  depositForDay?: number;
  paymentForDay?: number;
  details?: FundPositionDetail[];
  holdCollections?: FundPositionHold[];
}

export interface FundPositionDetail {
  bankName: string;
  balance: number;
  fundApplied: number;
  netBalance: number;
  nonValidatedDeposit: number;
  grandBalance: number;
}

export interface FundPositionHold {
  holdDate: string;
  chequeNumber: string;
  clientBank: string;
  clientName: string;
  factureReference: string;
  amount: number;
  depositDate?: string;
  daysRemaining?: number;
}

export interface ClientReconciliation {
  reportDate: string;
  clientCode: string;
  clientName?: string;
  impayesAmount: number;
}

export interface CollectionReport {
  id?: string;
  reportDate: string;
  clientCode: string;
  collectionAmount: number;
  bankName?: string;
  status?: 'pending' | 'processed' | 'failed';
  commission?: number;
  dateOfValidity?: string;
  nj?: number;
  taux?: number;
  interet?: number;
  tob?: number;
  fraisEscompte?: number;
  bankCommission?: number;
  dNAmount?: number;
  income?: number;
  dateOfImpay?: string;
  reglementImpaye?: string;
  creditedDate?: string;
  remarques?: string;
  factureNo?: string;
  noChqBd?: string;
  bankNameDisplay?: string;
  depoRef?: string;
  processingStatus?: string;
  matchedBankDepositId?: string;
  matchConfidence?: number;
  matchMethod?: string;
  sgOrFaNo?: string;
  processedAt?: string;
  excelSourceRow?: number;
  excelFilename?: string;
  excelProcessedAt?: string;
}

export interface ProcessingResults {
  bankReports: BankReport[];
  fundPosition: FundPosition | null;
  collections: CollectionReport[];
  clientReconciliations: ClientReconciliation[];
  totalProcessed: number;
  errors: string[];
  warnings: string[];
  duplicatesPrevented?: number;
  sourceFile?: string;
}

export interface Alert {
  type: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description: string;
  action: string;
  trigger: string;
  value?: number;
  threshold?: number;
  createdAt: string;
}

export interface ExtractionResult {
  success: boolean;
  data?: any;
  errors?: string[];
}

export interface DuplicateReport {
  totalCollections: number;
  totalDuplicates: number;
  uniqueCollections: number;
  duplicateGroups: DuplicateGroup[];
}

export interface DuplicateGroup {
  count: number;
  collections: CollectionReport[];
}

export interface DuplicateRemovalResult {
  success: boolean;
  data?: {
    deletedCount: number;
  };
  error?: string;
}
