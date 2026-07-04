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
  ignored_collections: number;
  errors: SyncCollectionError[];
  summary: SyncResultSummary;
}

export interface PartialSyncResultData {
  new_collections?: number;
  idempotent_updates?: number;
  enriched_collections?: number;
  ignored_collections?: number;
  errors?: SyncCollectionError[];
  summary?: {
    total_processed?: number;
    enrichments?: Partial<SyncEnrichmentCounters>;
  };
}

export interface ProcessingResult {
  success: boolean;
  data?: {
    bankReports: BankReport[];
    fundPosition?: FundPosition;
    clientReconciliation?: ClientReconciliation[];
    collectionReports?: CollectionReport[];
    syncResult?: SyncResultData;
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