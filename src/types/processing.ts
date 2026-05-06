import { BankReport, FundPosition, ClientReconciliation, CollectionReport } from '@/types/banking';

export interface ProcessingResult {
  success: boolean;
  data?: {
    bankReports: BankReport[];
    fundPosition?: FundPosition;
    clientReconciliation?: ClientReconciliation[];
    collectionReports?: CollectionReport[];
    syncResult?: any;
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