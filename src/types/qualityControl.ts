
export interface QualityError {
  id: string;
  type: 'SAISIE_ERROR' | 'OMISSION_ERROR' | 'INCOHÉRENCE_ERROR';
  collection_excel?: any;
  bank_transaction?: BankTransaction;
  error_description: string;
  suggested_correction?: any;
  confidence: number;
  reasoning: string[];
  status: 'PENDING' | 'VALIDATED' | 'REJECTED';
  created_at: string;
}

export interface SaisieError extends QualityError {
  type: 'SAISIE_ERROR';
  subtype: 'MONTANT_INCORRECT' | 'DATE_INCORRECTE' | 'BANQUE_INCORRECTE' | 'CLIENT_INCORRECT';
}

export interface OmissionError extends QualityError {
  type: 'OMISSION_ERROR';
  subtype: 'COLLECTION_MANQUANTE' | 'DATE_VALIDITY_MANQUANTE' | 'COMMISSION_MANQUANTE';
  missing_in_excel: boolean;
  suggested_addition: any;
}

export interface IncohérenceError extends QualityError {
  type: 'INCOHÉRENCE_ERROR';
  subtype: 'DATE_VALIDITY_INCORRECTE' | 'BANQUE_INCORRECTE' | 'STATUT_INCORRECT';
  bank_evidence: BankTransaction[];
  inconsistency_description: string;
}

export interface BankTransaction {
  id?: string;
  date: string;
  description: string;
  amount: number;
  bank: string;
  reference?: string;
  client_code?: string;
  type: 'CREDIT' | 'DEBIT';
}

export interface QualityReport {
  id: string;
  analysis_date: string;
  summary: {
    total_collections_analyzed: number;
    errors_detected: number;
    error_rate: number;
    confidence_score: number;
  };
  errors_by_type: {
    saisie_errors: number;
    omissions: number;
    incohérences: number;
  };
  errors: QualityError[];
  pending_validations: QualityError[];
  validated_corrections: QualityError[];
  rejected_suggestions: QualityError[];
}

export interface BankMatchResult {
  transaction: BankTransaction;
  confidence: number;
  reasoning: string[];
}

export interface ExcelMatchResult {
  collection: any;
  confidence: number;
  reasoning: string[];
}

export interface SuggestedCollection {
  collection: any;
  confidence: number;
  reasoning: string[];
}
