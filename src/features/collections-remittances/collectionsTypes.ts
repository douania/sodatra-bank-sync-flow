import type { Json } from '@/integrations/supabase/types';

export type CollectionMethod = 'CHEQUE' | 'EFFECT' | 'TRANSFER' | 'CASH';
export type CollectionBusinessNature = 'INVOICE_SETTLEMENT' | 'PROROGATION' | 'OTHER';
export type CollectionCapability =
  | 'ENTRY'
  | 'PROPOSE_MATCH'
  | 'CONFIRM_MATCH'
  | 'APPROVE_PROROGATION'
  | 'ISSUE_FUNDING_CHEQUE'
  | 'CONFIRM_DELIVERY'
  | 'CORRECT_EVENT'
  | 'AUDIT'
  | 'MANAGE_CONFIG';

export interface CollectionReceiptRow {
  id: string;
  source_type: 'EXCEL' | 'MANUAL' | 'API' | 'MIGRATION';
  client_reference: string | null;
  client_name_snapshot: string;
  method: CollectionMethod;
  business_nature: CollectionBusinessNature;
  amount: number;
  currency: string;
  bank_submission_date: string;
  counterparty_bank_snapshot: string | null;
  deposit_account_registry_id: string | null;
  declared_bank_credit_date: string | null;
  routing_state: string;
  settlement_state: string;
  recourse_state: string;
  version: number;
  created_at: string;
}

export interface CollectionInstrumentRow {
  id: string;
  receipt_id: string;
  instrument_type: 'CHEQUE' | 'EFFECT';
  nominal_amount: number;
  currency: string;
  cheque_number: string | null;
  effect_reference: string | null;
  maturity_date: string | null;
  drawee_bank_snapshot: string | null;
  settlement_state: string;
  settled_amount: number;
  version: number;
  created_at: string;
}

export interface CollectionProrogationRow {
  id: string;
  client_reference: string;
  target_nominal: number;
  currency: string;
  earliest_effect_maturity: string | null;
  funding_deadline: string | null;
  status: string;
  version: number;
  created_at: string;
}

export interface CollectionOutboundChequeRow {
  id: string;
  purpose: 'PROROGATION_FUNDING';
  account_registry_id: string;
  beneficiary_snapshot: string;
  cheque_number: string;
  amount: number;
  currency: string;
  issue_date: string;
  delivery_date: string | null;
  status: string;
  debited_amount: number;
  delivery_evidence_ref: string | null;
  version: number;
  created_by: string;
  approved_by: string | null;
}

export interface CollectionMatchProposalRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  daily_line_id: string;
  proposed_event_type: string;
  proposed_amount: number;
  score: number;
  reason_codes: string[];
  algorithm_version: string;
  status: string;
  proposed_at: string;
  proposed_by: string;
}

export interface CollectionEvidenceStatusRow {
  allocation_id: string;
  event_id: string;
  daily_line_id: string;
  daily_line_hash: string;
  daily_line_is_active: boolean;
  evidence_state: string;
  control_state: 'CURRENT' | 'REVIEW_REQUIRED' | 'REBOUND_REQUIRED';
  allocated_amount: number;
  currency: string;
  aggregate_type: string;
  aggregate_id: string;
  confirmed_at: string;
  confirmed_by: string;
}

export interface CollectionAccountRow {
  id: string;
  bank: string;
  currency: string;
  safe_alias: string;
  status: 'active' | 'inactive';
}

export interface CollectionAssignmentRow {
  id: string;
  actor_id: string;
  capability: CollectionCapability;
  scope_type: 'GLOBAL' | 'ACCOUNT';
  scope_id: string | null;
  valid_from: string;
  valid_until: string | null;
}

export interface CollectionDailyLineRow {
  id: string;
  canonical_unit_id: string;
  is_active: boolean;
  accounting_date: string;
  value_date: string | null;
  description_sanitized: string;
  debit_amount: number | null;
  credit_amount: number | null;
  signed_amount: number;
  direction: 'debit' | 'credit';
  currency: string;
}

export interface CollectionCommandResult {
  correlation_id: string;
  [key: string]: Json | undefined;
}

type ReadonlyTable<Row extends object> = {
  Row: Row & Record<string, unknown>;
  Insert: Record<string, never>;
  Update: Record<string, never>;
  Relationships: [];
};

export type CollectionsDatabase = {
  public: {
    Tables: {
      collection_receipts: ReadonlyTable<CollectionReceiptRow>;
      collection_instruments: ReadonlyTable<CollectionInstrumentRow>;
      collection_prorogations: ReadonlyTable<CollectionProrogationRow>;
      collection_outbound_cheques: ReadonlyTable<CollectionOutboundChequeRow>;
      collection_match_proposals: ReadonlyTable<CollectionMatchProposalRow>;
      collection_domain_assignments: ReadonlyTable<CollectionAssignmentRow>;
      daily_statement_account_registry: ReadonlyTable<CollectionAccountRow>;
      daily_statement_lines_canonical: ReadonlyTable<CollectionDailyLineRow>;
    };
    Views: {
      collection_bank_line_evidence_status_v: ReadonlyTable<CollectionEvidenceStatusRow>;
    };
    Functions: {
      create_collection_receipt_v1: { Args: { p_payload: Json; p_idempotency_key: string }; Returns: Json };
      allocate_collection_invoice_v1: { Args: { p_receipt_id: string; p_invoice_reference: string; p_invoice_amount_snapshot: number | null; p_allocated_amount: number; p_expected_version: number; p_idempotency_key: string }; Returns: Json };
      create_collection_prorogation_v1: { Args: { p_client_reference: string; p_target_nominal: number; p_currency: string; p_funding_deadline: string | null; p_idempotency_key: string }; Returns: Json };
      attach_collection_prorogation_source_v1: { Args: { p_prorogation_id: string; p_source_reference_type: string; p_source_reference: string; p_allocated_amount: number; p_expected_version: number; p_idempotency_key: string }; Returns: Json };
      attach_collection_replacement_effect_v1: { Args: { p_prorogation_id: string; p_instrument_id: string; p_allocated_nominal: number; p_expected_version: number; p_idempotency_key: string }; Returns: Json };
      prepare_collection_funding_cheque_v1: { Args: { p_prorogation_id: string; p_account_registry_id: string; p_beneficiary_snapshot: string; p_cheque_number: string; p_amount: number; p_issue_date: string; p_expected_version: number; p_idempotency_key: string }; Returns: Json };
      approve_collection_funding_cheque_v1: { Args: { p_outbound_cheque_id: string; p_expected_version: number; p_reason: string; p_idempotency_key: string }; Returns: Json };
      confirm_collection_funding_delivery_v1: { Args: { p_outbound_cheque_id: string; p_delivery_date: string; p_delivery_evidence_ref: string; p_expected_version: number; p_exception_reason: string | null; p_idempotency_key: string }; Returns: Json };
      propose_collection_match_v1: { Args: { p_aggregate_type: string; p_aggregate_id: string; p_daily_line_id: string; p_event_type: string; p_amount: number; p_score: number; p_reason_codes: string[]; p_algorithm_version: string; p_tolerance_snapshot: Json; p_idempotency_key: string }; Returns: Json };
      confirm_collection_match_v1: { Args: { p_proposal_id: string; p_reason: string; p_idempotency_key: string }; Returns: Json };
      rebind_collection_superseded_evidence_v1: { Args: { p_allocation_id: string; p_new_daily_line_id: string; p_reason: string; p_idempotency_key: string }; Returns: Json };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
