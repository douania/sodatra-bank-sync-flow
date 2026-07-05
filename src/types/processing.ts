import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';

export interface SyncCollectionRef {
  clientCode?: string;
}

export interface SyncCollectionError {
  collection: SyncCollectionRef;
  error: string;
}

export interface SyncEnrichmentCounters {
  date_of_validity_added: number;
  bank_commissions_added: number;
  references_updated: number;
  statuses_updated: number;
}

export interface SyncResultSummary {
  total_processed: number;
  enrichments: SyncEnrichmentCounters;
}

export interface SyncResultData {
  new_collections: number;
  idempotent_updates: number;
  enriched_collections: number;
  // Collections EXISTS_INCOMPLETE analysées mais sans aucun champ réellement
  // appliqué en base : comptées à part pour ne pas gonfler enriched_collections.
  incomplete_not_enriched: number;
  ignored_collections: number;
  errors: SyncCollectionError[];
  summary: SyncResultSummary;
}

export interface PartialSyncResultData {
  new_collections?: number;
  idempotent_updates?: number;
  enriched_collections?: number;
  incomplete_not_enriched?: number;
  ignored_collections?: number;
  errors?: SyncCollectionError[];
  summary?: {
    total_processed?: number;
    enrichments?: Partial<SyncEnrichmentCounters>;
  };
}

// Diagnostics d'import Excel : messages déjà nettoyés par excelProcessingService,
// aucune ligne brute ni donnée bancaire stockée ici.
export interface ExcelImportIssue {
  file: string;
  message: string;
}

export interface ExcelImportDiagnostics {
  files_processed: number;
  collections_extracted: number;
  excel_errors: ExcelImportIssue[];
  excel_warnings: ExcelImportIssue[];
}

// ⭐ PACK-C — Staging/review en mémoire pour l'import Collection Report Excel.
// Contrat : AUCUNE écriture DB tant que la promotion n'a pas été explicitement
// demandée par l'utilisateur. La clé d'idempotence reste (excel_filename, excel_source_row).
export type CollectionProposedStatus = 'NEW' | 'EXISTS_COMPLETE' | 'EXISTS_INCOMPLETE';

export interface CollectionReviewRow {
  // Identifiant de review : `${excelFilename}::${excelSourceRow}` — aligné sur
  // la clé d'idempotence existante, jamais générée artificiellement.
  rowId: string;
  collection: CollectionReport;
  selected: boolean;
  proposedStatus?: CollectionProposedStatus;
}

export interface CollectionImportReviewCounters {
  files_processed: number;
  accepted_rows: number;
  rejected_rows: number;
  file_level_rejections: number;
  warnings: number;
}

export interface CollectionImportReview {
  reviewReady: boolean;
  files: string[];
  acceptedRows: CollectionReviewRow[];
  // Rejets ligne à ligne (date invalide, clientCode vide, traçabilité manquante…).
  rejectedRows: ExcelImportIssue[];
  // Rejets globaux d'un fichier (headers obligatoires absents, feuille invalide…).
  fileLevelErrors: ExcelImportIssue[];
  warnings: ExcelImportIssue[];
  counters: CollectionImportReviewCounters;
  preparedAt: string;
}

export interface CollectionPromotionResult {
  promoted: boolean;
  validatedCount: number;
  syncResult: SyncResultData;
}

export interface ProcessingResult {
  success: boolean;
  data?: {
    bankReports: BankReport[];
    fundPosition?: FundPosition;
    clientReconciliation?: ClientReconciliation[];
    collectionReports?: CollectionReport[];
    syncResult?: SyncResultData;
    excelImportDiagnostics?: ExcelImportDiagnostics;
  };
  errors?: string[];
  debugInfo?: any;
}

export interface FileDetectionResult {
  file: File;
  detectedType: string;
  confidence: 'high' | 'medium' | 'low';
  bankType?: string;
}