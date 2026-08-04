import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { currentCollectionsCoreRuntimeVerdict } from './collectionsCoreRuntimeTarget';
import { buildCollectionEntryPayload, buildMatchPayload } from './collectionsCorePayloads';
import type {
  CollectionAccount,
  CollectionCapability,
  CollectionEntryInput,
  CreditLine,
  EvidenceBasis,
  MatchProposal,
  RegisterRow,
  RemittanceWorkItem,
} from './collectionsCoreTypes';

const coreSupabase = supabase as unknown as SupabaseClient;

export class CollectionsCoreServiceError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'CollectionsCoreServiceError';
  }
}

const entryResultSchema = z.object({
  receipt_id: z.string().uuid(),
  remittance_id: z.string().uuid(),
  item_id: z.string().uuid(),
  invoice_allocation_id: z.string().uuid().nullable(),
});

async function assertReady(): Promise<void> {
  const verdict = currentCollectionsCoreRuntimeVerdict();
  if ('reason' in verdict) throw new CollectionsCoreServiceError(verdict.reason, 'TARGET_REJECTED');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new CollectionsCoreServiceError('Une session authentifiée est requise.', 'AUTH_REQUIRED');
  }
}

function safeError(error: { message?: string; code?: string }, fallback: string) {
  const domainCode = (error.message ?? '').match(/COLLECTION_[A-Z0-9_]+/)?.[0];
  return new CollectionsCoreServiceError(
    domainCode ? `${fallback} (${domainCode})` : fallback,
    domainCode ?? error.code,
  );
}

function commandKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export async function getCollectionCapabilities(): Promise<Record<CollectionCapability, boolean>> {
  await assertReady();
  const capabilities: CollectionCapability[] = [
    'ENTRY',
    'VALIDATE_REMITTANCE',
    'PROPOSE_MATCH',
    'CONFIRM_MATCH',
    'AUDIT',
  ];
  const values = await Promise.all(
    capabilities.map(async (capability) => {
      const { data, error } = await coreSupabase.rpc('collection_current_actor_has_capability', {
        p_capability: capability,
      });
      if (error) throw safeError(error, 'Vérification des habilitations impossible.');
      return [capability, data === true] as const;
    }),
  );
  return Object.fromEntries(values) as Record<CollectionCapability, boolean>;
}

export async function listCollectionAccounts(): Promise<CollectionAccount[]> {
  await assertReady();
  const { data, error } = await coreSupabase
    .from('daily_statement_account_registry')
    .select('id,bank,currency,safe_alias')
    .eq('status', 'active')
    .order('bank');
  if (error) throw safeError(error, 'Lecture des banques de dépôt impossible.');
  return z
    .array(
      z.object({
        id: z.string().uuid(),
        bank: z.string(),
        currency: z.string(),
        safe_alias: z.string(),
      }),
    )
    .parse(data ?? [])
    .map((row) => ({ id: row.id, bank: row.bank, currency: row.currency, safeAlias: row.safe_alias }));
}

export async function createCollectionEntry(command: {
  input: CollectionEntryInput;
  workflowKey: string;
}): Promise<{ remittanceId: string }> {
  await assertReady();
  const { input, workflowKey } = command;
  const payload = await buildCollectionEntryPayload(input);
  if (!workflowKey.trim()) {
    throw new CollectionsCoreServiceError('Clé de saisie manquante.', 'COMMAND_KEY_REQUIRED');
  }
  const { data, error } = await coreSupabase.rpc('create_collection_entry_v1', {
    p_command_key: workflowKey,
    p_receipt: payload.receipt,
    p_remittance: payload.remittance,
    p_item: payload.item,
    p_invoice: input.invoiceReference.trim()
      ? {
          invoice_reference: input.invoiceReference.trim(),
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          validation_evidence: 'Saisie manuelle confirmée',
        }
      : null,
  });
  if (error) throw safeError(error, 'Enregistrement atomique de la remise refusé.');
  const created = entryResultSchema.parse(data);
  return { remittanceId: created.remittance_id };
}

export async function listRemittanceWorkItems(
  statuses: string[],
): Promise<RemittanceWorkItem[]> {
  await assertReady();
  const { data, error } = await coreSupabase
    .from('collection_bank_remittance_items')
    .select(
      'id,status,item_amount,currency,remittance_id,receipt_id,instrument_id,' +
        'collection_bank_remittances!inner(created_by,deposit_date,deposit_account_id,slip_reference,status),' +
        'collection_receipts!inner(client_name,receipt_method,client_bank),' +
        'collection_instruments(instrument_reference)',
    )
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw safeError(error, 'Lecture des remises impossible.');

  const rows = z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.string(),
        item_amount: z.coerce.number(),
        currency: z.string(),
        remittance_id: z.string().uuid(),
        receipt_id: z.string().uuid(),
        collection_bank_remittances: z.object({
          created_by: z.string().uuid(),
          deposit_date: z.string(),
          deposit_account_id: z.string().uuid(),
          slip_reference: z.string().nullable(),
          status: z.string(),
        }),
        collection_receipts: z.object({
          client_name: z.string(),
          receipt_method: z.enum(['CHECK', 'EFFECT', 'TRANSFER', 'CASH']),
          client_bank: z.string().nullable(),
        }),
        collection_instruments: z.object({ instrument_reference: z.string().nullable() }).nullable(),
      }),
    )
    .parse(data ?? []);
  return rows.map((row) => ({
    remittanceId: row.remittance_id,
    remittanceCreatedBy: row.collection_bank_remittances.created_by,
    depositDate: row.collection_bank_remittances.deposit_date,
    depositAccountId: row.collection_bank_remittances.deposit_account_id,
    amount: row.item_amount,
    currency: row.currency,
    slipReference: row.collection_bank_remittances.slip_reference,
    remittanceStatus: row.collection_bank_remittances.status,
    itemId: row.id,
    itemStatus: row.status,
    receiptId: row.receipt_id,
    clientName: row.collection_receipts.client_name,
    method: row.collection_receipts.receipt_method,
    clientBank: row.collection_receipts.client_bank,
    instrumentReference: row.collection_instruments?.instrument_reference ?? null,
  }));
}

export async function validateCollectionRemittance(remittanceId: string, reason: string): Promise<void> {
  await assertReady();
  const { error } = await coreSupabase.rpc('validate_collection_remittance_v1', {
    p_command_key: commandKey('validate'),
    p_remittance_id: remittanceId,
    p_reason: reason.trim(),
  });
  if (error) throw safeError(error, 'Validation de la remise refusée.');
}

export async function listActiveCreditLines(): Promise<CreditLine[]> {
  await assertReady();
  const { data, error } = await coreSupabase
    .from('daily_statement_lines_canonical')
    .select(
      'id,accounting_date,description_sanitized,signed_amount,currency,' +
        'daily_statement_units_canonical!inner(account_registry_id,status)',
    )
    .eq('is_active', true)
    .eq('direction', 'credit')
    .eq('daily_statement_units_canonical.status', 'ingested')
    .order('accounting_date', { ascending: false })
    .limit(300);
  if (error) throw safeError(error, 'Lecture des crédits bancaires impossible.');
  return z
    .array(
      z.object({
        id: z.string().uuid(),
        accounting_date: z.string(),
        description_sanitized: z.string(),
        signed_amount: z.coerce.number(),
        currency: z.string(),
        daily_statement_units_canonical: z.object({
          account_registry_id: z.string().uuid(),
          status: z.string(),
        }),
      }),
    )
    .parse(data ?? [])
    .map((row) => ({
      id: row.id,
      accountingDate: row.accounting_date,
      description: row.description_sanitized,
      amount: Math.abs(row.signed_amount),
      currency: row.currency,
      accountId: row.daily_statement_units_canonical.account_registry_id,
    }));
}

export async function proposeCollectionMatch(input: {
  itemId: string;
  creditLineId: string;
  creditConsumedAmount: number;
  settledGrossAmount: number;
  evidenceBasis: EvidenceBasis;
  reason: string;
}): Promise<void> {
  await assertReady();
  const payload = buildMatchPayload(input);
  const { error } = await coreSupabase.rpc('propose_collection_match_v1', {
    p_command_key: commandKey('match-proposal'),
    p_action: 'CREATE',
    p_proposal_id: null,
    p_payload: payload,
  });
  if (error) throw safeError(error, 'Proposition de rapprochement refusée.');
}

export async function listPendingMatchProposals(): Promise<MatchProposal[]> {
  await assertReady();
  const { data, error } = await coreSupabase
    .from('collection_match_proposals')
    .select(
      'id,created_at,proposed_by,credit_daily_line_id,proposed_credit_consumed_amount,' +
        'proposed_fee_consumed_amount,evidence_basis,reason',
    )
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false });
  if (error) throw safeError(error, 'Lecture des rapprochements en attente impossible.');
  return z
    .array(
      z.object({
        id: z.string().uuid(),
        created_at: z.string(),
        proposed_by: z.string().uuid(),
        credit_daily_line_id: z.string().uuid(),
        proposed_credit_consumed_amount: z.coerce.number(),
        proposed_fee_consumed_amount: z.coerce.number(),
        evidence_basis: z.string(),
        reason: z.string(),
      }),
    )
    .parse(data ?? [])
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      proposedBy: row.proposed_by,
      creditDailyLineId: row.credit_daily_line_id,
      creditAmount: row.proposed_credit_consumed_amount,
      feeAmount: row.proposed_fee_consumed_amount,
      evidenceBasis: row.evidence_basis,
      reason: row.reason,
    }));
}

export async function decideCollectionMatch(
  proposalId: string,
  decision: 'CONFIRM' | 'REJECT',
  reason: string,
): Promise<void> {
  await assertReady();
  const { error } = await coreSupabase.rpc('confirm_collection_match_v1', {
    p_command_key: commandKey('match-decision'),
    p_proposal_id: proposalId,
    p_decision: decision,
    p_reason: reason.trim(),
  });
  if (error) throw safeError(error, 'Décision de rapprochement refusée.');
}

export async function exportCollectionRegister(): Promise<RegisterRow[]> {
  await assertReady();
  const { data, error } = await coreSupabase.rpc('export_collection_register_v1');
  if (error) throw safeError(error, 'Lecture du registre Collections impossible.');
  return z
    .array(
      z.object({
        remittance_item_id: z.string().uuid(),
        deposit_date: z.string(),
        client_name: z.string(),
        receipt_method: z.enum(['CHECK', 'EFFECT', 'TRANSFER', 'CASH']),
        instrument_reference: z.string().nullable(),
        expected_amount: z.coerce.number(),
        settled_gross_amount: z.coerce.number(),
        observed_fee_amount: z.coerce.number(),
        net_liquidity_amount: z.coerce.number(),
        currency: z.string(),
        item_status: z.string(),
        proof_class: z.string(),
        declared_credit_date: z.string().nullable(),
        proven_credit_date: z.string().nullable(),
        remaining_amount: z.coerce.number(),
        current_exception_code: z.string().nullable(),
      }),
    )
    .parse(data ?? [])
    .map((row) => ({
      remittanceItemId: row.remittance_item_id,
      depositDate: row.deposit_date,
      clientName: row.client_name,
      receiptMethod: row.receipt_method,
      instrumentReference: row.instrument_reference,
      expectedAmount: row.expected_amount,
      settledGrossAmount: row.settled_gross_amount,
      observedFeeAmount: row.observed_fee_amount,
      netLiquidityAmount: row.net_liquidity_amount,
      currency: row.currency,
      itemStatus: row.item_status,
      proofClass: row.proof_class,
      declaredCreditDate: row.declared_credit_date,
      provenCreditDate: row.proven_credit_date,
      remainingAmount: row.remaining_amount,
      currentExceptionCode: row.current_exception_code,
    }));
}
