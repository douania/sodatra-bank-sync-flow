
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
  
  // ⭐ NOUVELLES COLONNES AJOUTÉES
  dateOfValidity?: string; // Date de crédit en banque (CRUCIALE pour rapprochement)
  factureNo?: string; // Numéro de facture
  noChqBd?: string; // Numéro chèque/BD
  bankNameDisplay?: string; // Nom affiché de la banque
  depoRef?: string; // Référence de dépôt
  
  // ⭐ CALCULS FINANCIERS
  nj?: number; // Nombre de jours
  taux?: number; // Taux
  interet?: number; // Intérêt
  commission?: number; // Commission
  tob?: number; // TOB
  fraisEscompte?: number; // Frais d'escompte
  bankCommission?: number; // Commission bancaire
  
  // ⭐ RÉFÉRENCES SUPPLÉMENTAIRES
  sgOrFaNo?: string; // Numéro SG ou FA
  dNAmount?: number; // Montant D.N
  income?: number; // Revenus
  
  // ⭐ GESTION DES IMPAYÉS
  dateOfImpay?: string; // Date d'impayé
  reglementImpaye?: string; // Règlement impayé
  remarques?: string; // Remarques
  
  // ⭐ MÉTADONNÉES DE TRAITEMENT
  creditedDate?: string; // Date effective de crédit
  processingStatus?: string; // Statut de traitement
  matchedBankDepositId?: string; // ID du dépôt bancaire rapproché
  matchConfidence?: number; // Score de confiance du rapprochement
  matchMethod?: string; // Méthode de rapprochement
  processedAt?: string; // Date de traitement
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
