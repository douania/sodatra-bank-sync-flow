
// Types pour le système bancaire SODATRA selon le guide d'implémentation
export interface BankReport {
  id?: string;
  bank: string;
  date: string;
  openingBalance: number;
  closingBalance: number;
  depositsNotCleared: DepositNotCleared[];
  checksNotCleared?: CheckNotCleared[];
  bankFacilities: BankFacility[];
  impayes: Impaye[];
}

export interface DepositNotCleared {
  id?: string;
  dateDepot: string;
  dateValeur?: string;
  typeReglement: string;
  clientCode?: string;
  reference?: string;
  montant: number;
}

export interface CheckNotCleared {
  id?: string;
  dateEmission: string;
  numeroCheque: string;
  montant: number;
  beneficiaire?: string;
}

export interface BankFacility {
  id?: string;
  facilityType: string;
  limitAmount: number;
  usedAmount: number;
  availableAmount: number;
}

export interface Impaye {
  id?: string;
  dateEcheance: string;
  dateRetour?: string;
  clientCode: string;
  description?: string;
  montant: number;
}

export interface FundPosition {
  id?: string;
  reportDate: string;
  totalFundAvailable: number;
  collectionsNotDeposited: number;
  grandTotal: number;
}

export interface ClientReconciliation {
  id?: string;
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
  status: 'pending' | 'processed' | 'failed';
  dateOfValidity?: string; // Nouvelle propriété pour la date de crédit en banque
}

// Types pour les données de test réelles du guide
export interface BankBalances {
  [bankName: string]: {
    opening: number;
    closing: number;
  };
}

export interface TotalFacilities {
  total_limits: number;
  total_used: number;
  utilization_rate: number;
  available: number;
}

export interface ClientImpayes {
  [clientCode: string]: number;
}

// Types pour les alertes critiques
export interface Alert {
  id?: string;
  type: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description: string;
  action: string;
  trigger: string;
  value?: number;
  threshold?: number;
  createdAt?: string;
}

// Types pour l'extraction
export interface ExtractionResult {
  success: boolean;
  data?: BankReport;
  errors?: string[];
  warnings?: string[];
}
