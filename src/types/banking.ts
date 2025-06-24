


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
  // Nouveaux champs pour la traçabilité Excel
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

// Types manquants ajoutés
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


