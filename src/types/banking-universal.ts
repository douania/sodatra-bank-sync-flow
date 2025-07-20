
// Types universels pour le système bancaire multi-banques
export type BankType = 'BDK' | 'SGS' | 'BICIS' | 'ATB' | 'ORA' | 'BIS';

export interface RapportBancaire {
  banque: BankType;
  dateRapport: string;
  compte: string;
  
  // Soldes
  soldeOuverture: number;
  soldeCloture: number;
  
  // Éléments en attente
  depotsNonCredites: ElementBancaire[];
  chequesNonDebites: ElementBancaire[];
  autresDebits: ElementBancaire[];
  autresCredits: ElementBancaire[];
  
  // Facilités bancaires
  facilitesBancaires: FaciliteBancaire[];
  
  // Impayés
  impayes: Impaye[];
  
  // Métadonnées
  metadata: {
    formatSource: string;
    versionParser: string;
    dateExtraction: string;
    checksum: string;
    validation?: {
      isValid: boolean;
      discrepancy: number;
      calculatedClosing: number;
    };
  };
}

export interface ElementBancaire {
  id: string;
  reference: string;
  montant: number;
  description: string;
  dateOperation?: string;
  dateValeur?: string;
  type: 'depot' | 'cheque' | 'virement' | 'autre';
  statut: 'en_attente' | 'traite' | 'rejete';
}

export interface FaciliteBancaire {
  type: string;
  montantAutorise: number;
  montantUtilise: number;
  montantDisponible: number;
  tauxInteret?: number;
  dateEcheance?: string;
}

export interface Impaye {
  reference: string;
  montant: number;
  dateEcheance: string;
  dateRetour: string;
  motif: string;
  clientCode: string;
  description: string;
}

export interface ComparaisonRapport {
  rapportPrecedent: RapportBancaire;
  rapportActuel: RapportBancaire;
  evolutions: Evolution[];
  nouveauxElements: ElementBancaire[];
  elementsDisparus: ElementBancaire[];
  alertes: Alerte[];
}

export interface Evolution {
  type: 'cheque_debite' | 'depot_credite' | 'nouvel_impaye' | 'facilite_modifiee';
  element: ElementBancaire | Impaye | FaciliteBancaire;
  ancienneValeur?: any;
  nouvelleValeur?: any;
  description: string;
  impact: 'positif' | 'negatif' | 'neutre';
}

export interface Alerte {
  type: 'critique' | 'attention' | 'info';
  message: string;
  details: string;
  action?: string;
  banque: BankType;
  dateDetection: string;
}

export interface ConfigurationRapport {
  type: 'executif' | 'detaille' | 'risques' | 'tendances';
  format: 'pdf' | 'excel' | 'word';
  periode: {
    debut: string;
    fin: string;
  };
  banques: BankType[];
  sections: string[];
  destinataires: string[];
  frequence?: 'quotidien' | 'hebdomadaire' | 'mensuel';
  automatique: boolean;
}

export interface RapportConsolide {
  dateGeneration: string;
  periode: {
    debut: string;
    fin: string;
  };
  banques: RapportBancaire[];
  totaux: {
    liquiditeDisponible: number;
    facilitesUtilisees: number;
    montantRisque: number;
    depotsEnAttente: number;
  };
  alertesGlobales: Alerte[];
  recommandations: string[];
  tendances: {
    liquidite: number[];
    facilites: number[];
    dates: string[];
  };
}

// Types pour la persistence Supabase
export interface UniversalBankReportDB {
  id: string;
  bank_name: BankType;
  report_date: string;
  raw_data: any;
  processed_data: RapportBancaire;
  checksum: string;
  parser_version: string;
  created_at: string;
  user_id?: string;
}

export interface BankEvolutionDB {
  id: string;
  bank_name: BankType;
  report_date: string;
  evolution_type: string;
  reference?: string;
  amount?: number;
  description?: string;
  previous_status?: string;
  current_status?: string;
  created_at: string;
}

export interface BankAuditLogDB {
  id: string;
  user_id?: string;
  action: string;
  bank_name?: BankType;
  report_date?: string;
  details?: any;
  ip_address?: string;
  created_at: string;
}
