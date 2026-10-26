export const PAYABLES_CAPABILITIES = [
  'READ', 'AUDIT', 'INVOICE_MANAGE', 'SUPPLIER_MANAGE', 'SUPPLIER_MERGE_VALIDATE', 'CHEQUE_PREPARE_PRINT',
  'CHEQUE_CONFIRM_ISSUE', 'TRANSFER_DECLARE', 'EXIT_REQUEST', 'EXIT_VALIDATE', 'BANK_FOLLOWUP', 'EXCEPTION_INSTRUCT',
  'PARAM_PROPOSE', 'PARAM_VALIDATE',
] as const;
export type PayablesCapability = (typeof PAYABLES_CAPABILITIES)[number];

export interface PayablesAccess {
  user_id: string;
  capabilities: PayablesCapability[];
  person_id: string | null;
  business_writes_enabled: boolean;
  export_enabled: boolean;
}

export interface SupplierRow {
  id: string;
  canonical_name: string;
  status: 'ACTIVE' | 'MERGED';
  merged_into_id: string | null;
}

export interface PaymentRow {
  id: string;
  invoice_id: string;
  mode: 'CHEQUE' | 'TRANSFER';
  bank_account_id: string;
  category_code: string;
  amount: number;
  currency: string;
  is_partial: boolean;
  beneficiary: string | null;
  status: 'OPEN' | 'ISSUED' | 'ABANDONED' | 'CANCELLED' | 'REPLACED' | 'DECLARED';
  replaces_payment_id: string | null;
  created_by: string;
  created_at: string;
  row_version: number;
}

export type FormState =
  | 'ASSIGNED' | 'PRINT_PENDING' | 'PRINTED' | 'PRINT_UNCERTAIN' | 'UNUSED' | 'LOST' | 'PRESIGNED_HELD'
  | 'ISSUED' | 'CLEARED' | 'CANCELLED' | 'REPLACED';

export interface ChequeFormRow {
  id: string;
  bank_account_id: string;
  cheque_number: string;
  payment_id: string | null;
  provenance: 'NATIVE' | 'TAKEOVER' | 'EXCEPTION' | 'PRESIGNED_INVENTORY';
  state: FormState;
  presigned: boolean;
  unused_reason: string | null;
  created_at: string;
  updated_at: string;
  row_version: number;
}

export interface ChequeContentRow {
  id: string;
  form_id: string;
  version_no: number;
  fields: Record<string, unknown>;
  content_hash: string;
  profile_version_id: string;
}

export interface PrintEventRow {
  id: string;
  form_id: string;
  content_id: string;
  kind: 'INITIAL' | 'REPRINT';
  status: 'PENDING' | 'PRINTED' | 'NOT_PRINTED' | 'SPOILED' | 'UNCERTAIN';
  requested_at: string;
}

export interface SignatureRow {
  id: string;
  form_id: string;
  content_id: string;
  person_id: string;
  signed_on: string;
}

export interface ExitRow {
  id: string;
  form_id: string;
  kind: 'CANCELLATION' | 'REPLACEMENT' | 'CORRECTION' | 'BANK_MATCH';
  status: 'REQUESTED' | 'VALIDATED' | 'REJECTED' | 'REVOKED';
  requested_by: string;
  requested_at: string;
  reason: string;
  details: Record<string, unknown>;
  row_version: number;
}

export interface ExceptionRow {
  id: string;
  kind: string;
  status: 'OPEN' | 'RESOLVED';
  invoice_id: string | null;
  payment_id: string | null;
  form_id: string | null;
  bank_account_id: string | null;
  blocks_invoice: boolean;
  blocks_account: boolean;
  opened_by: string;
  opened_at: string;
  reason: string;
  row_version: number;
}

export interface PersonRow {
  id: string;
  display_name: string;
  status: 'PROPOSED' | 'ACTIVE' | 'REJECTED';
  proposed_by: string;
}

export interface ParameterVersionRow {
  id: string;
  kind: 'SIGNATORY' | 'SIGNATURE_RULE' | 'CATEGORY' | 'PRINT_PROFILE';
  subject_key: string;
  version_no: number;
  valid_from: string;
  payload: Record<string, unknown>;
  status: 'PROPOSED' | 'VALIDATED' | 'REJECTED';
  proposed_by: string;
}

export interface CapabilityGrantRow {
  id: string;
  user_id: string;
  capability: PayablesCapability;
  action: 'GRANT' | 'REVOKE';
  status: 'PROPOSED' | 'VALIDATED' | 'REJECTED';
  proposed_by: string | null;
}

export interface PersonLinkRow {
  id: string;
  person_id: string;
  user_id: string;
  action: 'LINK' | 'UNLINK';
  status: 'PROPOSED' | 'VALIDATED' | 'REJECTED';
  proposed_by: string;
}

export interface TakeoverBatchRow {
  id: string;
  bank_account_id: string;
  cutoff_date: string;
  source_label: string;
  control_count: number;
  control_total: number;
  status: 'PREPARED' | 'INTEGRATED' | 'REJECTED' | 'COLLISION';
  completeness_attested: boolean;
  prepared_by: string;
  row_version: number;
}

export interface BankFollowupLineRow {
  line_id: string;
  accounting_date: string;
  value_date: string | null;
  debit_amount: number;
  currency: string;
  is_active: boolean;
  grammar_version: string | null;
  family: string | null;
  outcome: string | null;
  reference_text: string | null;
  proposal_id: string | null;
  proposal_status: string | null;
  proposal_version: number | null;
  form_id: string | null;
}

export interface PrintIntentResult {
  print_event_id: string;
  kind: 'INITIAL' | 'REPRINT';
  form_version: number;
  fields: Record<string, unknown>;
  layout: Record<string, unknown>;
  profile_version_id: string;
}

export type PrintOutcome = 'PRINTED' | 'NOT_PRINTED' | 'SPOILED' | 'UNCERTAIN';

export const EXCEPTION_RESOLUTIONS: Record<string, string[]> = {
  FORM_PRINT_UNCERTAIN: ['FOUND_UNUSED', 'FOUND_PRINTED', 'FORM_LOST'],
  INVOICE_COLLISION: ['AUTHORIZE_DISTINCT', 'REJECT_DUPLICATE'],
  TRANSFER_UNALLOCATED: ['ALLOCATE_REMAINING', 'DOCUMENTED_NO_ALLOCATION'],
  ISSUANCE_OVERRUN: ['ALLOCATE_REMAINING', 'DOCUMENTED_NO_ALLOCATION'],
  ISSUED_OUTSIDE_CIRCUIT: ['REGULARIZED', 'AMOUNT_ESTABLISHED'],
  CANCELLED_CHEQUE_PRESENTED: ['INSTRUCTED_DOCUMENTED'],
  MATCH_EVIDENCE_INACTIVE: ['MATCH_REVOKED', 'REBOUND_VERIFIED'],
  MERGE_COLLISION: ['MERGE_ABANDONED'],
  TAKEOVER_COLLISION: ['BATCH_ABANDONED'],
  PRESIGNED_FORM_RISK: ['DESTROYED_DOCUMENTED', 'FORM_LOST'],
  FORM_LOST: ['INSTRUCTED_DOCUMENTED'],
  UNISSUED_FORM_PRESENTED: ['INSTRUCTED_DOCUMENTED'],
};

export const ISSUANCE_EXCEPTION_REASONS = [
  'SIGNATORY_IS_PREPARER', 'SIGNATURE_MISSING', 'SIGNATORY_NOT_ADMISSIBLE', 'CONJOINT_INCOMPLETE',
  'PRESIGNED_OUTSIDE_PROTOCOL', 'OTHER_OUTSIDE_CIRCUIT',
] as const;
