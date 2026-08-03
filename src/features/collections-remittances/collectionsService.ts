import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import {
  currentCollectionsRuntimeTargetVerdict,
  type CollectionsCapability as CollectionsRuntimeCapability,
} from './collectionsRuntimeTarget';
import type {
  CollectionAccountRow,
  CollectionAssignmentRow,
  CollectionBusinessNature,
  CollectionCapability,
  CollectionCommandResult,
  CollectionDailyLineRow,
  CollectionEvidenceStatusRow,
  CollectionMatchProposalRow,
  CollectionMethod,
  CollectionInstrumentRow,
  CollectionOutboundChequeRow,
  CollectionProrogationRow,
  CollectionReceiptRow,
  CollectionsDatabase,
} from './collectionsTypes';

const collectionsDb = supabase as unknown as SupabaseClient<CollectionsDatabase>;
const commandResultSchema = z.object({ correlation_id: z.string().uuid() }).passthrough();
const MAX_PAGE_SIZE = 100;

export class CollectionsServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CollectionsServiceError';
  }
}

export interface CollectionsAccessContext {
  roles: Array<'admin' | 'auditor' | 'manager' | 'user'>;
  capabilities: CollectionCapability[];
}

export interface CollectionReceiptInput {
  clientReference?: string;
  clientName: string;
  method: CollectionMethod;
  businessNature: CollectionBusinessNature;
  amount: number;
  currency: string;
  bankSubmissionDate: string;
  counterpartyBank?: string;
  depositAccountRegistryId?: string;
  declaredBankCreditDate?: string;
  chequeNumber?: string;
  effectReference?: string;
  maturityDate?: string;
}

function assertLocalTarget(capability: CollectionsRuntimeCapability): void {
  const verdict = currentCollectionsRuntimeTargetVerdict(capability);
  if (verdict.allowed === false) {
    throw new CollectionsServiceError(verdict.reason, 'LOCAL_TARGET_REQUIRED');
  }
}

async function assertSession(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user.id) {
    throw new CollectionsServiceError('Une session authentifiée est requise.', 'AUTH_REQUIRED');
  }
  return data.session.user.id;
}

function safeError(error: unknown, fallback: string): CollectionsServiceError {
  if (error instanceof CollectionsServiceError) return error;
  return new CollectionsServiceError(fallback, 'REMOTE_OPERATION_FAILED');
}

function parseCommand(data: Json | null): CollectionCommandResult {
  const parsed = commandResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new CollectionsServiceError('Réponse serveur Collections invalide.', 'INVALID_RESPONSE');
  }
  return parsed.data as CollectionCommandResult;
}

export function createCollectionIdempotencyKey(prefix: string): string {
  const normalized = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'collection';
  return `${normalized}-${crypto.randomUUID()}`;
}

export function buildCollectionReceiptPayload(input: CollectionReceiptInput): Json {
  const currency = input.currency.trim().toUpperCase();
  if (!input.clientName.trim() || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new CollectionsServiceError('Client et montant positif sont obligatoires.', 'FORM_INVALID');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.bankSubmissionDate) || !/^[A-Z]{3}$/.test(currency)) {
    throw new CollectionsServiceError('Date de remise ou devise invalide.', 'FORM_INVALID');
  }
  if (input.businessNature === 'PROROGATION' && input.method !== 'EFFECT') {
    throw new CollectionsServiceError('Une prorogation doit être saisie comme effet.', 'FORM_INVALID');
  }

  const payload: Record<string, Json | undefined> = {
    source_type: 'MANUAL',
    client_reference: input.clientReference?.trim() || undefined,
    client_name_snapshot: input.clientName.trim(),
    method: input.method,
    business_nature: input.businessNature,
    amount: input.amount,
    currency,
    bank_submission_date: input.bankSubmissionDate,
    counterparty_bank_snapshot: input.counterpartyBank?.trim() || undefined,
    deposit_account_registry_id: input.depositAccountRegistryId || undefined,
    declared_bank_credit_date: input.declaredBankCreditDate || undefined,
  };

  if (input.method === 'CHEQUE') {
    if (!input.chequeNumber?.trim()) {
      throw new CollectionsServiceError('Le numéro de chèque est obligatoire.', 'FORM_INVALID');
    }
    payload.instrument = {
      instrument_type: 'CHEQUE',
      cheque_number: input.chequeNumber.trim(),
      drawee_bank_snapshot: input.counterpartyBank?.trim() || null,
      received_at: input.bankSubmissionDate,
    };
  } else if (input.method === 'EFFECT') {
    if (!input.maturityDate) {
      throw new CollectionsServiceError('La date d’échéance de l’effet est obligatoire.', 'FORM_INVALID');
    }
    payload.instrument = {
      instrument_type: 'EFFECT',
      effect_reference: input.effectReference?.trim() || null,
      maturity_date: input.maturityDate,
      drawee_bank_snapshot: input.counterpartyBank?.trim() || null,
      received_at: input.bankSubmissionDate,
    };
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Json;
}

export async function getCollectionsAccessContext(): Promise<CollectionsAccessContext> {
  assertLocalTarget('read');
  const actorId = await assertSession();
  const [rolesResult, assignmentsResult] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', actorId),
    collectionsDb
      .from('collection_domain_assignments')
      .select('capability,valid_from,valid_until')
      .eq('actor_id', actorId),
  ]);
  if (rolesResult.error || assignmentsResult.error) {
    throw safeError(null, 'Lecture des habilitations Collections impossible.');
  }
  const roles = Array.from(new Set((rolesResult.data ?? []).map((row) => row.role)))
    .filter((role): role is CollectionsAccessContext['roles'][number] =>
      ['admin', 'auditor', 'manager', 'user'].includes(role),
    );
  const now = Date.now();
  const assigned = (assignmentsResult.data ?? [])
    .filter((row) => new Date(row.valid_from).getTime() <= now)
    .filter((row) => row.valid_until === null || new Date(row.valid_until).getTime() > now)
    .map((row) => row.capability);
  const all: CollectionCapability[] = [
    'ENTRY', 'PROPOSE_MATCH', 'CONFIRM_MATCH', 'APPROVE_PROROGATION',
    'ISSUE_FUNDING_CHEQUE', 'CONFIRM_DELIVERY', 'CORRECT_EVENT', 'AUDIT', 'MANAGE_CONFIG',
  ];
  return { roles, capabilities: roles.includes('admin') ? all : Array.from(new Set(assigned)) };
}

export async function listCollectionReceipts(limit = 50): Promise<CollectionReceiptRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('collection_receipts').select('*')
    .order('created_at', { ascending: false }).limit(Math.min(limit, MAX_PAGE_SIZE));
  if (error) throw safeError(error, 'Lecture des remises impossible.');
  return data ?? [];
}

export async function listCollectionProrogations(limit = 50): Promise<CollectionProrogationRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('collection_prorogations').select('*')
    .order('created_at', { ascending: false }).limit(Math.min(limit, MAX_PAGE_SIZE));
  if (error) throw safeError(error, 'Lecture des prorogations impossible.');
  return data ?? [];
}

export async function listCollectionInstruments(limit = 100): Promise<CollectionInstrumentRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('collection_instruments').select('*')
    .order('created_at', { ascending: false }).limit(Math.min(limit, MAX_PAGE_SIZE));
  if (error) throw safeError(error, 'Lecture des titres impossible.');
  return data ?? [];
}

export async function listCollectionOutboundCheques(limit = 50): Promise<CollectionOutboundChequeRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('collection_outbound_cheques').select('*')
    .order('issue_date', { ascending: false }).limit(Math.min(limit, MAX_PAGE_SIZE));
  if (error) throw safeError(error, 'Lecture des chèques sortants impossible.');
  return data ?? [];
}

export async function listCollectionMatchProposals(limit = 50): Promise<CollectionMatchProposalRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('collection_match_proposals').select('*')
    .order('proposed_at', { ascending: false }).limit(Math.min(limit, MAX_PAGE_SIZE));
  if (error) throw safeError(error, 'Lecture des propositions de rapprochement impossible.');
  return data ?? [];
}

export async function listCollectionEvidenceAlerts(limit = 50): Promise<CollectionEvidenceStatusRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('collection_bank_line_evidence_status_v').select('*')
    .neq('control_state', 'CURRENT').order('confirmed_at', { ascending: false })
    .limit(Math.min(limit, MAX_PAGE_SIZE));
  if (error) throw safeError(error, 'Lecture des preuves à reprendre impossible.');
  return data ?? [];
}

export async function listCollectionAccounts(): Promise<CollectionAccountRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('daily_statement_account_registry')
    .select('id,bank,currency,safe_alias,status').eq('status', 'active')
    .order('bank', { ascending: true });
  if (error) throw safeError(error, 'Lecture des comptes de dépôt impossible.');
  return data ?? [];
}

export async function listActiveCollectionDailyLines(limit = 100): Promise<CollectionDailyLineRow[]> {
  assertLocalTarget('read');
  await assertSession();
  const { data, error } = await collectionsDb.from('daily_statement_lines_canonical')
    .select('id,canonical_unit_id,is_active,accounting_date,value_date,description_sanitized,debit_amount,credit_amount,signed_amount,direction,currency')
    .eq('is_active', true).order('accounting_date', { ascending: false })
    .limit(Math.min(limit, MAX_PAGE_SIZE));
  if (error) throw safeError(error, 'Lecture des preuves Daily v2 impossible.');
  return data ?? [];
}

async function runCommand<Name extends keyof CollectionsDatabase['public']['Functions']>(
  name: Name,
  args: CollectionsDatabase['public']['Functions'][Name]['Args'],
  fallback: string,
): Promise<CollectionCommandResult> {
  assertLocalTarget('mutate');
  await assertSession();
  const { data, error } = await collectionsDb.rpc(name, args);
  if (error) throw safeError(error, fallback);
  return parseCommand(data as Json | null);
}

export function createCollectionReceipt(input: CollectionReceiptInput, idempotencyKey: string) {
  return runCommand('create_collection_receipt_v1', {
    p_payload: buildCollectionReceiptPayload(input), p_idempotency_key: idempotencyKey,
  }, 'Création de la remise refusée.');
}

export function allocateCollectionInvoice(input: { receiptId: string; invoiceReference: string; invoiceAmount?: number; allocatedAmount: number; expectedVersion: number; idempotencyKey: string }) {
  return runCommand('allocate_collection_invoice_v1', {
    p_receipt_id: input.receiptId, p_invoice_reference: input.invoiceReference.trim(),
    p_invoice_amount_snapshot: input.invoiceAmount ?? null, p_allocated_amount: input.allocatedAmount,
    p_expected_version: input.expectedVersion, p_idempotency_key: input.idempotencyKey,
  }, 'Affectation de facture refusée.');
}

export function createCollectionProrogation(input: { clientReference: string; targetNominal: number; currency: string; fundingDeadline?: string; idempotencyKey: string }) {
  return runCommand('create_collection_prorogation_v1', {
    p_client_reference: input.clientReference.trim(), p_target_nominal: input.targetNominal,
    p_currency: input.currency.trim().toUpperCase(), p_funding_deadline: input.fundingDeadline || null,
    p_idempotency_key: input.idempotencyKey,
  }, 'Création de la prorogation refusée.');
}

export function attachCollectionProrogationSource(input: { prorogationId: string; sourceType: string; sourceReference: string; amount: number; expectedVersion: number; idempotencyKey: string }) {
  return runCommand('attach_collection_prorogation_source_v1', {
    p_prorogation_id: input.prorogationId, p_source_reference_type: input.sourceType,
    p_source_reference: input.sourceReference.trim(), p_allocated_amount: input.amount,
    p_expected_version: input.expectedVersion, p_idempotency_key: input.idempotencyKey,
  }, 'Rattachement de la créance source refusé.');
}

export function attachCollectionReplacementEffect(input: { prorogationId: string; instrumentId: string; amount: number; expectedVersion: number; idempotencyKey: string }) {
  return runCommand('attach_collection_replacement_effect_v1', {
    p_prorogation_id: input.prorogationId, p_instrument_id: input.instrumentId,
    p_allocated_nominal: input.amount, p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  }, 'Rattachement de l’effet de remplacement refusé.');
}

export function prepareCollectionFundingCheque(input: { prorogationId: string; accountRegistryId: string; beneficiary: string; chequeNumber: string; amount: number; issueDate: string; expectedVersion: number; idempotencyKey: string }) {
  return runCommand('prepare_collection_funding_cheque_v1', {
    p_prorogation_id: input.prorogationId, p_account_registry_id: input.accountRegistryId,
    p_beneficiary_snapshot: input.beneficiary.trim(), p_cheque_number: input.chequeNumber.trim(),
    p_amount: input.amount, p_issue_date: input.issueDate, p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  }, 'Préparation du chèque de financement refusée.');
}

export function approveCollectionFundingCheque(input: { outboundChequeId: string; expectedVersion: number; reason: string; idempotencyKey: string }) {
  return runCommand('approve_collection_funding_cheque_v1', {
    p_outbound_cheque_id: input.outboundChequeId, p_expected_version: input.expectedVersion,
    p_reason: input.reason.trim(), p_idempotency_key: input.idempotencyKey,
  }, 'Approbation du chèque refusée.');
}

export function confirmCollectionFundingDelivery(input: { outboundChequeId: string; deliveryDate: string; evidenceReference: string; expectedVersion: number; exceptionReason?: string; idempotencyKey: string }) {
  return runCommand('confirm_collection_funding_delivery_v1', {
    p_outbound_cheque_id: input.outboundChequeId, p_delivery_date: input.deliveryDate,
    p_delivery_evidence_ref: input.evidenceReference.trim(), p_expected_version: input.expectedVersion,
    p_exception_reason: input.exceptionReason?.trim() || null, p_idempotency_key: input.idempotencyKey,
  }, 'Confirmation de remise du chèque refusée.');
}

export function proposeCollectionMatch(input: { aggregateType: string; aggregateId: string; dailyLineId: string; eventType: string; amount: number; score: number; reasonCodes: string[]; idempotencyKey: string }) {
  return runCommand('propose_collection_match_v1', {
    p_aggregate_type: input.aggregateType, p_aggregate_id: input.aggregateId,
    p_daily_line_id: input.dailyLineId, p_event_type: input.eventType, p_amount: input.amount,
    p_score: input.score, p_reason_codes: input.reasonCodes,
    p_algorithm_version: 'manual-ui-0z1b-v1', p_tolerance_snapshot: { amount_tolerance: 0 },
    p_idempotency_key: input.idempotencyKey,
  }, 'Proposition de rapprochement refusée.');
}

export function confirmCollectionMatch(input: { proposalId: string; reason: string; idempotencyKey: string }) {
  return runCommand('confirm_collection_match_v1', {
    p_proposal_id: input.proposalId, p_reason: input.reason.trim(),
    p_idempotency_key: input.idempotencyKey,
  }, 'Confirmation du rapprochement refusée.');
}
