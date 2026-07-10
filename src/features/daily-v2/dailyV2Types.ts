import type { Json } from '@/integrations/supabase/types';

export type DailyV2AppRole = 'admin' | 'auditor' | 'manager' | 'user';
export type DailyV2RequestedMode = 'daily' | 'backfill';
export type DailyV2ParserValidationStatus = 'valid' | 'needs_review';
export type DailyV2AggregatesStatus = 'derived' | 'unavailable';
export type DailyV2RequestedUnitStatus = 'staged' | 'provisional';
export type DailyV2StagingStatus =
  | 'staged'
  | 'provisional'
  | 'duplicate'
  | 'conflict'
  | 'needs_review'
  | 'promoted'
  | 'promotion_failed'
  | 'superseded';
export type DailyV2CanonicalStatus = 'ingested' | 'superseded';

export interface DailyV2ExportAttemptRow {
  id: string;
  created_at: string;
  created_by: string | null;
  requested_mode: DailyV2RequestedMode;
  source_format: string;
  bank: string;
  currency: string;
  account_fingerprint: string;
  account_number_masked: string | null;
  source_file_name_redacted: string | null;
  raw_text_hash: string;
  export_period_start: string;
  export_period_end: string;
  statement_date: string | null;
  export_reference_date: string | null;
  parser_validation_status: DailyV2ParserValidationStatus;
  errors_count: number;
  warnings_count: number;
  runtime_version: string | null;
  parser_version: string | null;
  ingestion_ready: boolean;
  bridge_guard_passed: boolean;
  period_days: number;
  backfill_grant_reference: string | null;
  units_total: number;
}

export interface DailyV2StagingUnitRow {
  id: string;
  attempt_id: string;
  day_unit_id: string;
  bank: string;
  account_fingerprint: string;
  currency: string;
  accounting_date: string;
  day_content_hash: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: DailyV2AggregatesStatus;
  validation_status: DailyV2ParserValidationStatus;
  status: DailyV2StagingStatus;
  created_at: string;
  created_by: string | null;
}

export interface DailyV2StagingLineRow {
  id: string;
  staging_unit_id: string;
  attempt_id: string;
  day_unit_id: string;
  daily_line_hash: string;
  daily_occurrence_ordinal: number;
  source_line_index: number;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
  created_at: string;
}

export interface DailyV2CanonicalUnitRow {
  id: string;
  promoted_from_staging_unit_id: string;
  day_unit_id: string;
  bank: string;
  account_fingerprint: string;
  currency: string;
  accounting_date: string;
  active_day_content_hash: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: DailyV2AggregatesStatus;
  validation_status: DailyV2ParserValidationStatus;
  status: DailyV2CanonicalStatus;
  ingested_at: string;
  ingested_by: string | null;
  superseded_by: string | null;
  superseded_at: string | null;
}

export interface DailyV2CanonicalLineRow {
  id: string;
  canonical_unit_id: string;
  day_unit_id: string;
  daily_line_hash: string;
  daily_occurrence_ordinal: number;
  source_line_index: number;
  is_active: boolean;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
  created_at: string;
}

export interface DailyV2AuditEventRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  attempt_id: string | null;
  staging_unit_id: string | null;
  canonical_unit_id: string | null;
  day_unit_id: string | null;
  raw_text_hash: string | null;
  event_type: string;
  previous_status: string | null;
  new_status: string | null;
  safe_message: string | null;
  safe_details: Json | null;
}

export interface DailyV2RpcAttempt {
  requested_mode: DailyV2RequestedMode;
  source_format: string;
  bank: string;
  currency: string;
  account_fingerprint: string;
  account_number_masked: string | null;
  source_file_name_redacted: string | null;
  raw_text_hash: string;
  export_period_start: string;
  export_period_end: string;
  statement_date: string | null;
  export_reference_date: string | null;
  parser_validation_status: DailyV2ParserValidationStatus;
  errors_count: number;
  warnings_count: number;
  runtime_version: string | null;
  parser_version: string | null;
}

export interface DailyV2RpcUnit {
  day_unit_id: string;
  accounting_date: string;
  day_content_hash: string;
  line_count: number;
  day_total_debits: number;
  day_total_credits: number;
  opening_balance_derived: number | null;
  closing_balance_derived: number | null;
  aggregates_status: DailyV2AggregatesStatus;
  validation_status: DailyV2ParserValidationStatus;
  requested_unit_status: DailyV2RequestedUnitStatus;
}

export interface DailyV2RpcLine {
  day_unit_id: string;
  daily_line_hash: string;
  daily_occurrence_ordinal: number;
  source_line_index: number;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  running_balance: number | null;
  direction: 'debit' | 'credit';
  currency: string;
}

export interface DailyV2RpcGuardContext {
  ingestion_ready: boolean;
  period_days: number;
  bridge_guard_passed: boolean;
  backfill_grant_reference: string | null;
}

export interface DailyV2PreIngestPayload {
  p_attempt: DailyV2RpcAttempt;
  p_units: DailyV2RpcUnit[];
  p_lines: DailyV2RpcLine[];
  p_guard_context: DailyV2RpcGuardContext;
}

export interface DailyV2PreIngestUnitResult {
  day_unit_id: string;
  unit_status: DailyV2StagingStatus;
  staging_unit_id: string;
  active_canonical_unit_id: string | null;
}

export interface DailyV2PreIngestResponse {
  attempt_id: string;
  requested_mode: DailyV2RequestedMode;
  units: DailyV2PreIngestUnitResult[];
}

export interface DailyV2PromoteResponse {
  outcome: 'duplicate' | 'conflict' | 'needs_review' | 'promoted';
  active_canonical_unit_id?: string;
  canonical_unit_id?: string;
}

export interface DailyV2SupersedeResponse {
  outcome: 'duplicate' | 'superseded';
  active_canonical_unit_id?: string;
  old_canonical_unit_id?: string;
  new_canonical_unit_id?: string;
}

export interface DailyV2Page<T> {
  rows: T[];
  count: number;
  page: number;
  pageSize: number;
}

export type DailyV2Database = {
  public: {
    Tables: {
      daily_statement_export_attempts: DailyV2TableDefinition<DailyV2ExportAttemptRow>;
      daily_statement_units_staging: DailyV2TableDefinition<DailyV2StagingUnitRow>;
      daily_statement_lines_staging: DailyV2TableDefinition<DailyV2StagingLineRow>;
      daily_statement_units_canonical: DailyV2TableDefinition<DailyV2CanonicalUnitRow>;
      daily_statement_lines_canonical: DailyV2TableDefinition<DailyV2CanonicalLineRow>;
      daily_statement_import_events: DailyV2TableDefinition<DailyV2AuditEventRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      pre_ingest_daily_statement_units: {
        Args: {
          p_attempt: DailyV2RpcAttempt;
          p_units: DailyV2RpcUnit[];
          p_lines: DailyV2RpcLine[];
          p_guard_context: DailyV2RpcGuardContext;
        };
        Returns: Json;
      };
      promote_daily_statement_unit: {
        Args: { p_staging_unit_id: string; p_approval_reason?: string | null };
        Returns: Json;
      };
      supersede_daily_statement_unit: {
        Args: {
          p_old_canonical_unit_id: string;
          p_new_staging_unit_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type DailyV2TableDefinition<Row extends object> = {
  Row: Row & Record<string, unknown>;
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};
