import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { PayablesError, toPayablesError } from './payablesErrors';
import { currentPayablesRuntimeVerdict, isRuntimeRefused } from './payablesRuntimeTarget';
import type { AccountPositionRow, InvoiceOverviewRow } from './operationalPositionModel';
import type { WorkQueueRow } from './payablesWorkQueueModel';
import type {
  AccountRow,
  BankFollowupLineRow,
  CapabilityGrantRow,
  ChequeContentRow,
  ChequeFormRow,
  DeliveryRow,
  ExceptionRow,
  ExitRow,
  IssuanceRow,
  ParameterVersionRow,
  PayablesAccess,
  PaymentRow,
  PersonLinkRow,
  PersonRow,
  PrintEventRow,
  PrintIntentResult,
  PrintOutcome,
  SignatureRow,
  SupplierRow,
  TakeoverBatchRow,
} from './payablesChequesTypes';

// Les tables du domaine ne figurent pas dans les types générés : client non typé
// localement, sans modification de src/integrations/supabase/types.ts.
const db = supabase as unknown as SupabaseClient;

type Json = Record<string, unknown>;

/** Toute opération vérifie la cible d'exécution puis la session avant le réseau. */
async function assertReady(): Promise<void> {
  const verdict = currentPayablesRuntimeVerdict();
  if (isRuntimeRefused(verdict)) throw new PayablesError('PAYABLES_TARGET_REJECTED', verdict.reason);
  const { data, error } = await db.auth.getSession();
  if (error || !data.session) throw new PayablesError('PAYABLES_AUTH_REQUIRED', 'Une session authentifiée est requise.');
}

async function rpc<T>(name: string, args: Json = {}): Promise<T> {
  await assertReady();
  const { data, error } = await db.rpc(name, args);
  if (error) throw toPayablesError(error);
  return data as T;
}

// Lectures de listes : pages de 1 000 lignes (plafond PostgREST) avec compte
// exact, jusqu'à la totalité. Toute incohérence (compte absent ou modifié
// pendant la lecture, page vide prématurée, volume au-delà de la borne) est une
// lecture incomplète explicite : jamais une liste tronquée en silence, donc
// jamais un total calculé sur une liste partielle.
export const READ_PAGE_SIZE = 1000;
export const READ_MAX_ROWS = 50_000;

type PageResult = { data: unknown[] | null; error: unknown; count: number | null };

function incomplete(): PayablesError {
  return toPayablesError('PAYABLES_READ_INCOMPLETE');
}

async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  await assertReady();
  const rows: T[] = [];
  let expected: number | null = null;
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const { data, error, count } = await fetchPage(from, from + READ_PAGE_SIZE - 1);
    if (error) throw toPayablesError(error, 'Lecture impossible.');
    if (typeof count !== 'number' || (expected !== null && count !== expected)) throw incomplete();
    expected = count;
    if (expected > READ_MAX_ROWS) throw incomplete();
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (rows.length >= expected) break;
    if (page.length === 0) throw incomplete();
  }
  if (rows.length !== expected) throw incomplete();
  return rows;
}

function readTable<T>(table: string, columns: string, orderBy: string, ascending = true): Promise<T[]> {
  // Ordre total (clé + identifiant) : les pages successives ne se chevauchent pas.
  return readAllPages<T>((from, to) => db.from(table).select(columns, { count: 'exact' })
    .order(orderBy, { ascending }).order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<PageResult>);
}

function rpcList<T>(name: string, args: Json = {}): Promise<T[]> {
  // Les fonctions de lecture ordonnent totalement leurs lignes côté serveur.
  return readAllPages<T>((from, to) => db.rpc(name, args, { count: 'exact' }).range(from, to) as unknown as PromiseLike<PageResult>);
}

export function newCommandKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}

// --- Lectures --------------------------------------------------------------

export const readMyAccess = () => rpc<PayablesAccess>('payables_my_access_v1');
export const readInvoiceOverview = () => rpcList<InvoiceOverviewRow>('payables_invoice_overview_v1');
/** Comptes du registre sans aucune donnée bancaire (droit de lecture du domaine). */
export const readAccounts = () => rpcList<AccountRow>('payables_accounts_v1');
/** Données bancaires : exige la capacité BANK_READ côté serveur. */
export const readAccountPositions = (asOf: string | null) =>
  rpcList<AccountPositionRow>('payables_account_positions_v1', { p_as_of: asOf });
export const readWorkQueue = () => rpcList<WorkQueueRow>('payables_work_queue_v1');
export const readBankFollowupLines = (accountId: string, from: string, to: string) =>
  rpcList<BankFollowupLineRow>('payables_bank_followup_lines_v1', { p_bank_account_id: accountId, p_from: from, p_to: to });

export const listSuppliers = () =>
  readTable<SupplierRow>('payables_suppliers', 'id,canonical_name,status,merged_into_id', 'canonical_name');
export const listPayments = () =>
  readTable<PaymentRow>('payables_payments',
    'id,invoice_id,mode,bank_account_id,category_code,amount,currency,is_partial,beneficiary,status,replaces_payment_id,created_by,created_at,row_version',
    'created_at', false);
export const listForms = () =>
  readTable<ChequeFormRow>('payables_cheque_forms',
    'id,bank_account_id,cheque_number,payment_id,provenance,state,presigned,unused_reason,created_at,updated_at,row_version',
    'updated_at', false);
export const listIssuances = () =>
  readTable<IssuanceRow>('payables_issuances', 'id,form_id,revision_no,path,issue_date,amount,recorded_at', 'recorded_at', false);
export const listDeliveries = () =>
  readTable<DeliveryRow>('payables_deliveries', 'id,form_id,delivered_on', 'delivered_on', false);
export const listContents = () =>
  readTable<ChequeContentRow>('payables_cheque_contents', 'id,form_id,version_no,fields,content_hash,profile_version_id',
    'version_no', false);
export const listPrintEvents = () =>
  readTable<PrintEventRow>('payables_print_events', 'id,form_id,content_id,kind,status,requested_at', 'requested_at', false);
export const listSignatures = () =>
  readTable<SignatureRow>('payables_signatures', 'id,form_id,content_id,person_id,signed_on', 'signed_on', false);
export const listExits = () =>
  readTable<ExitRow>('payables_exits', 'id,form_id,kind,status,requested_by,requested_at,reason,details,row_version',
    'requested_at', false);
export const listExceptions = () =>
  readTable<ExceptionRow>('payables_exceptions',
    'id,kind,status,invoice_id,payment_id,form_id,bank_account_id,blocks_invoice,blocks_account,opened_by,opened_at,reason,row_version',
    'opened_at', false);
export const listPersons = () =>
  readTable<PersonRow>('payables_persons', 'id,display_name,status,proposed_by', 'display_name');
export const listPersonLinks = () =>
  readTable<PersonLinkRow>('payables_person_links', 'id,person_id,user_id,action,status,proposed_by', 'proposed_at', false);
export const listParameters = () =>
  readTable<ParameterVersionRow>('payables_parameter_versions',
    'id,kind,subject_key,version_no,valid_from,payload,status,proposed_by', 'proposed_at', false);
export const listCapabilityGrants = () =>
  readTable<CapabilityGrantRow>('payables_capability_grants', 'id,user_id,capability,action,status,proposed_by',
    'proposed_at', false);
export const listTakeoverBatches = () =>
  readTable<TakeoverBatchRow>('payables_takeover_batches',
    'id,bank_account_id,cutoff_date,source_label,control_count,control_total,status,completeness_attested,prepared_by,row_version',
    'prepared_at', false);

// --- Fournisseurs, factures, paiements -----------------------------------------

export const createSupplier = (key: string, name: string, reason: string) =>
  rpc<Json>('payables_create_supplier_v1', { p_command_key: key, p_name: name, p_reason: reason });
export const proposeSupplierMerge = (key: string, absorbedId: string, keptId: string, reason: string) =>
  rpc<Json>('payables_propose_supplier_merge_v1', { p_command_key: key, p_absorbed_id: absorbedId, p_kept_id: keptId, p_reason: reason });
export const decideSupplierMerge = (key: string, mergeId: string, approve: boolean, reason: string) =>
  rpc<Json>('payables_decide_supplier_merge_v1', { p_command_key: key, p_merge_id: mergeId, p_approve: approve, p_reason: reason });
export const createInvoice = (key: string, input: {
  supplierId: string; reference: string; amount: number; invoiceDate: string | null; dueDate: string | null; evidenceRef: string;
}) => rpc<Json>('payables_create_invoice_v1', {
  p_command_key: key, p_supplier_id: input.supplierId, p_reference: input.reference, p_amount: input.amount,
  p_currency: 'XOF', p_invoice_date: input.invoiceDate, p_due_date: input.dueDate, p_evidence_ref: input.evidenceRef,
});
export const createChequeRequest = (key: string, input: {
  invoiceId: string; accountId: string; category: string; amount: number | null; partial: boolean; beneficiary: string; reason: string;
}) => rpc<Json>('payables_create_cheque_request_v1', {
  p_command_key: key, p_invoice_id: input.invoiceId, p_bank_account_id: input.accountId, p_category_code: input.category,
  p_amount: input.partial ? input.amount : null, p_partial: input.partial, p_beneficiary: input.beneficiary, p_reason: input.reason,
});
export const abandonPayment = (key: string, paymentId: string, version: number, reason: string) =>
  rpc<Json>('payables_abandon_payment_v1', { p_command_key: key, p_payment_id: paymentId, p_expected_version: version, p_reason: reason });
export const declareTransfer = (key: string, input: {
  invoiceId: string; accountId: string; category: string; amount: number; bankReference: string;
  status: 'EXECUTED' | 'COMMITTED'; executedOn: string | null; evidenceRef: string; reason: string;
}) => rpc<Json>('payables_declare_transfer_v1', {
  p_command_key: key, p_invoice_id: input.invoiceId, p_bank_account_id: input.accountId, p_category_code: input.category,
  p_amount: input.amount, p_bank_reference: input.bankReference, p_declared_status: input.status,
  p_executed_on: input.status === 'EXECUTED' ? input.executedOn : null, p_evidence_ref: input.evidenceRef, p_reason: input.reason,
});

// --- Formules, impression, émission ---------------------------------------------

export const assignChequeForm = (key: string, paymentId: string, version: number, chequeNumber: string,
  profileCode: string, printedDate: string) =>
  rpc<Json>('payables_assign_cheque_form_v1', {
    p_command_key: key, p_payment_id: paymentId, p_expected_version: version, p_cheque_number: chequeNumber,
    p_profile_code: profileCode, p_printed_date: printedDate,
  });
export const reviseChequeContent = (key: string, formId: string, version: number, printedDate: string, reason: string) =>
  rpc<Json>('payables_revise_cheque_content_v1', {
    p_command_key: key, p_form_id: formId, p_expected_version: version, p_printed_date: printedDate, p_reason: reason,
  });
/** Intention enregistrée AVANT l'impression physique ; le serveur renvoie le contenu à imprimer. */
export const recordPrintIntent = (key: string, formId: string, version: number, contentId: string, reason: string) =>
  rpc<PrintIntentResult>('payables_record_print_intent_v1', {
    p_command_key: key, p_form_id: formId, p_expected_version: version, p_content_id: contentId, p_reason: reason,
  });
/** Résultat déclaré explicitement par le comptable ; jamais déduit du navigateur. */
export const recordPrintOutcome = (key: string, printEventId: string, outcome: PrintOutcome, reason: string | null) =>
  rpc<Json>('payables_record_print_outcome_v1', {
    p_command_key: key, p_print_event_id: printEventId, p_outcome: outcome, p_reason: reason,
  });
export const recordUnusedForm = (key: string, formId: string, version: number, reason: string) =>
  rpc<Json>('payables_record_unused_form_v1', { p_command_key: key, p_form_id: formId, p_expected_version: version, p_reason: reason });
export const recordSignature = (key: string, formId: string, contentId: string, personId: string, signedOn: string) =>
  rpc<Json>('payables_record_signature_v1', {
    p_command_key: key, p_form_id: formId, p_content_id: contentId, p_person_id: personId, p_signed_on: signedOn, p_reason: null,
  });
export const confirmIssuance = (key: string, formId: string, version: number, issueDate: string, presignedForm: boolean) =>
  rpc<Json>('payables_confirm_issuance_v1', {
    p_command_key: key, p_form_id: formId, p_expected_version: version, p_issue_date: issueDate, p_presigned_form: presignedForm,
  });
export const declareIssuanceException = (key: string, input: {
  accountId: string; chequeNumber: string; amount: number | null; issueDate: string; paymentId: string | null;
  reasonCode: string; evidenceRef: string; reason: string;
}) => rpc<Json>('payables_declare_issuance_exception_v1', {
  p_command_key: key, p_bank_account_id: input.accountId, p_cheque_number: input.chequeNumber, p_amount: input.amount,
  p_issue_date: input.issueDate, p_payment_id: input.paymentId, p_reason_code: input.reasonCode,
  p_evidence_ref: input.evidenceRef, p_reason: input.reason,
});
export const recordDelivery = (key: string, formId: string, deliveredOn: string, note: string | null) =>
  rpc<Json>('payables_record_delivery_v1', { p_command_key: key, p_form_id: formId, p_delivered_on: deliveredOn, p_note: note });
export const requestExit = (key: string, formId: string, version: number, kind: string, details: Json, evidenceRef: string,
  reason: string) =>
  rpc<Json>('payables_request_exit_v1', {
    p_command_key: key, p_form_id: formId, p_expected_version: version, p_kind: kind, p_details: details,
    p_evidence_ref: evidenceRef, p_reason: reason,
  });
export const validateExit = (key: string, exitId: string, version: number, approve: boolean, reason: string) =>
  rpc<Json>('payables_validate_exit_v1', { p_command_key: key, p_exit_id: exitId, p_expected_version: version, p_approve: approve, p_reason: reason });

// --- Reprise, exceptions, verrous -----------------------------------------------

export const prepareTakeover = (key: string, input: {
  accountId: string; cutoffDate: string; sourceLabel: string; controlCount: number; controlTotal: number;
  items: Array<{ cheque_number: string; beneficiary: string; amount: number; issue_date: string }>; reason: string;
}) => rpc<Json>('payables_prepare_takeover_v1', {
  p_command_key: key, p_bank_account_id: input.accountId, p_cutoff_date: input.cutoffDate, p_source_label: input.sourceLabel,
  p_control_count: input.controlCount, p_control_total: input.controlTotal, p_items: input.items, p_reason: input.reason,
});
export const decideTakeover = (key: string, batchId: string, version: number, approve: boolean, attest: boolean, reason: string) =>
  rpc<Json>('payables_decide_takeover_v1', {
    p_command_key: key, p_batch_id: batchId, p_expected_version: version, p_approve: approve, p_attest_complete: attest, p_reason: reason,
  });
export const resolveException = (key: string, exceptionId: string, version: number, code: string, details: Json,
  evidenceRef: string, reason: string) =>
  rpc<Json>('payables_resolve_exception_v1', {
    p_command_key: key, p_exception_id: exceptionId, p_expected_version: version, p_resolution_code: code,
    p_details: details, p_evidence_ref: evidenceRef, p_reason: reason,
  });
export const acquireLock = (objectType: 'PAYMENT' | 'FORM' | 'INVOICE' | 'EXCEPTION', objectId: string) =>
  rpc<Json>('payables_acquire_lock_v1', { p_object_type: objectType, p_object_id: objectId });

// --- Suivi bancaire --------------------------------------------------------------

export const proposeBankMatches = (key: string, accountId: string, cutoff: string) =>
  rpc<Json>('payables_propose_bank_matches_v1', { p_command_key: key, p_bank_account_id: accountId, p_cutoff: cutoff });
export const decideBankMatch = (key: string, proposalId: string, version: number, decision: 'CONFIRM' | 'REJECT', reason: string | null) =>
  rpc<Json>('payables_decide_bank_match_v1', {
    p_command_key: key, p_proposal_id: proposalId, p_expected_version: version, p_decision: decision, p_reason: reason,
  });
export const scanMatchEvidence = (key: string) => rpc<Json>('payables_scan_match_evidence_v1', { p_command_key: key });

// --- Gouvernance et paramètres ---------------------------------------------------

export const proposeCapability = (key: string, userId: string, capability: string, action: 'GRANT' | 'REVOKE', reason: string) =>
  rpc<Json>('payables_propose_capability_v1', { p_command_key: key, p_user_id: userId, p_capability: capability, p_action: action, p_reason: reason });
export const decideCapability = (key: string, proposalId: string, approve: boolean, reason: string) =>
  rpc<Json>('payables_decide_capability_v1', { p_command_key: key, p_proposal_id: proposalId, p_approve: approve, p_reason: reason });
export const proposePerson = (key: string, displayName: string, reason: string) =>
  rpc<Json>('payables_propose_person_v1', { p_command_key: key, p_display_name: displayName, p_reason: reason });
export const decidePerson = (key: string, personId: string, approve: boolean, reason: string) =>
  rpc<Json>('payables_decide_person_v1', { p_command_key: key, p_person_id: personId, p_approve: approve, p_reason: reason });
export const proposePersonLink = (key: string, personId: string, userId: string, action: 'LINK' | 'UNLINK', reason: string) =>
  rpc<Json>('payables_propose_person_link_v1', { p_command_key: key, p_person_id: personId, p_user_id: userId, p_action: action, p_reason: reason });
export const decidePersonLink = (key: string, linkId: string, approve: boolean, reason: string) =>
  rpc<Json>('payables_decide_person_link_v1', { p_command_key: key, p_link_id: linkId, p_approve: approve, p_reason: reason });
export const proposeParameter = (key: string, input: {
  kind: string; subjectKey: string; validFrom: string; payload: Json; evidenceRef: string | null; reason: string;
}) => rpc<Json>('payables_propose_parameter_v1', {
  p_command_key: key, p_kind: input.kind, p_subject_key: input.subjectKey, p_valid_from: input.validFrom,
  p_payload: input.payload, p_evidence_ref: input.evidenceRef, p_reason: input.reason,
});
export const decideParameter = (key: string, versionId: string, approve: boolean, reason: string) =>
  rpc<Json>('payables_decide_parameter_v1', { p_command_key: key, p_version_id: versionId, p_approve: approve, p_reason: reason });
