import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { currentCollectionsCoreRuntimeVerdict } from './collectionsCoreRuntimeTarget';
import {
  assertExactCollectionsCorePilotEntry,
  assertExactCollectionsCorePilotValidation,
  collectionsCorePilotActor,
  collectionsCorePilotBootstrapCommandKey,
  collectionsCorePilotBootstrapReason,
  collectionsCorePilotCapabilitySpecs,
  collectionsCorePilotGrantCommandKey,
  collectionsCorePilotGrantReason,
  collectionsCorePilotRevokeReason,
  isCollectionsCorePilotActionAllowed,
  isCollectionsCorePilotCampaignAssignment,
  resolveCollectionsCorePilotGate,
  type CollectionsCorePilotAction,
  type CollectionsCorePilotAssignment,
  type CollectionsCorePilotManifest,
} from './collectionsCorePilotAccess';
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

interface ReadyContext {
  environment: 'local' | 'staging';
  userId: string;
  manifest?: CollectionsCorePilotManifest;
}

async function assertReady(action: CollectionsCorePilotAction): Promise<ReadyContext> {
  const gate = await resolveCollectionsCorePilotGate(currentCollectionsCoreRuntimeVerdict());
  if (gate.status !== 'allowed') {
    throw new CollectionsCoreServiceError(
      gate.status === 'blocked' ? gate.reason : 'Vérification du pilote en cours.',
      'TARGET_REJECTED',
    );
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new CollectionsCoreServiceError('Une session authentifiée est requise.', 'AUTH_REQUIRED');
  }
  if (gate.environment === 'local') {
    return { environment: 'local', userId: data.session.user.id };
  }
  if (!isCollectionsCorePilotActionAllowed(gate.pilotManifest, data.session.user.id, action)) {
    throw new CollectionsCoreServiceError(
      'Cette action est interdite à cet acteur du pilote.',
      'PILOT_ACTION_REJECTED',
    );
  }
  return {
    environment: 'staging',
    userId: data.session.user.id,
    manifest: gate.pilotManifest,
  };
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

const assignmentRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    capability: z.string(),
    is_active: z.boolean(),
    granted_by: z.string().uuid(),
    reason: z.string(),
    created_at: z.string(),
    revoked_at: z.string().nullable(),
    revoked_by: z.string().uuid().nullable(),
  }),
);

function mapAssignmentRows(data: unknown): CollectionsCorePilotAssignment[] {
  return assignmentRowsSchema.parse(data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    capability: row.capability,
    isActive: row.is_active,
    grantedBy: row.granted_by,
    reason: row.reason,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  }));
}

async function readPilotAssignments(userIds: string[]): Promise<CollectionsCorePilotAssignment[]> {
  const { data, error } = await coreSupabase
    .from('collection_domain_assignments')
    .select('id,user_id,capability,is_active,granted_by,reason,created_at,revoked_at,revoked_by')
    .in('user_id', userIds)
    .order('created_at');
  if (error) throw safeError(error, 'Lecture des habilitations du pilote impossible.');
  return mapAssignmentRows(data);
}

async function readCampaignAssignments(manifest: CollectionsCorePilotManifest) {
  const { data, error } = await coreSupabase
    .from('collection_domain_assignments')
    .select('id,user_id,capability,is_active,granted_by,reason,created_at,revoked_at,revoked_by')
    .like('reason', `${manifest.campaignId}:%`)
    .order('created_at');
  if (error) throw safeError(error, 'Lecture du registre de campagne impossible.');
  return mapAssignmentRows(data);
}

async function actorHasRole(userId: string, role: 'admin' | 'manager' | 'auditor' | 'user') {
  const { data, error } = await coreSupabase.rpc('has_role', { _user_id: userId, _role: role });
  if (error) throw safeError(error, 'Vérification des rôles du pilote impossible.');
  return data === true;
}

async function verifyPilotRoleMatrix(manifest: CollectionsCorePilotManifest) {
  const [gAdmin, aManager, aAdmin, aAuditor, bUser, bAdmin, bManager, bAuditor] = await Promise.all([
    actorHasRole(manifest.grantorUserId, 'admin'),
    actorHasRole(manifest.operatorUserId, 'manager'),
    actorHasRole(manifest.operatorUserId, 'admin'),
    actorHasRole(manifest.operatorUserId, 'auditor'),
    actorHasRole(manifest.controllerUserId, 'user'),
    actorHasRole(manifest.controllerUserId, 'admin'),
    actorHasRole(manifest.controllerUserId, 'manager'),
    actorHasRole(manifest.controllerUserId, 'auditor'),
  ]);
  if (!gAdmin || !aManager || aAdmin || aAuditor || !bUser || bAdmin || bManager || bAuditor) {
    throw new CollectionsCoreServiceError(
      'La matrice de rôles G/A/B ne respecte pas le moindre privilège du pilote.',
      'PILOT_ROLE_MATRIX_REJECTED',
    );
  }
}

async function mutatePilotCapability(input: {
  commandKey: string;
  userId: string;
  capability: string;
  active: boolean;
  reason: string;
}) {
  const { data, error } = await coreSupabase.rpc('grant_collection_capability_v1', {
    p_command_key: input.commandKey,
    p_user_id: input.userId,
    p_capability: input.capability,
    p_active: input.active,
    p_reason: input.reason,
  });
  if (error) throw safeError(error, 'Mutation auditée des habilitations du pilote refusée.');
  return z.object({ assignment_id: z.string().uuid() }).parse(data).assignment_id;
}

function activeCapabilities(assignments: CollectionsCorePilotAssignment[], userId: string) {
  return assignments
    .filter((row) => row.userId === userId && row.isActive)
    .map((row) => row.capability)
    .sort();
}

export interface CollectionsCorePilotAdministrationState {
  campaignAssignments: CollectionsCorePilotAssignment[];
  operatorActiveCapabilities: string[];
  controllerActiveCapabilities: string[];
  grantorManageAccessActive: boolean;
}

export async function inspectCollectionsCorePilotAdministration(): Promise<CollectionsCorePilotAdministrationState> {
  const ready = await assertReady('administration');
  const manifest = ready.manifest;
  if (!manifest) throw new CollectionsCoreServiceError('Le panneau pilote est réservé au staging.');
  const assignments = await readPilotAssignments([
    manifest.grantorUserId,
    manifest.operatorUserId,
    manifest.controllerUserId,
  ]);
  const campaignAssignments = await readCampaignAssignments(manifest);
  return {
    campaignAssignments,
    operatorActiveCapabilities: activeCapabilities(assignments, manifest.operatorUserId),
    controllerActiveCapabilities: activeCapabilities(assignments, manifest.controllerUserId),
    grantorManageAccessActive: assignments.some(
      (row) => row.userId === manifest.grantorUserId && row.capability === 'MANAGE_ACCESS' && row.isActive,
    ),
  };
}

export async function prepareCollectionsCoreStagingPilot(): Promise<CollectionsCorePilotAdministrationState> {
  const ready = await assertReady('administration');
  const manifest = ready.manifest!;
  await verifyPilotRoleMatrix(manifest);

  const gHistory = await readPilotAssignments([manifest.grantorUserId]);
  const currentMarker = gHistory.filter(
    (row) =>
      row.capability === 'MANAGE_ACCESS' &&
      row.reason === collectionsCorePilotBootstrapReason(manifest),
  );
  if (currentMarker.some((row) => !row.isActive)) {
    throw new CollectionsCoreServiceError('Cette campagne a déjà été fermée et ne peut pas être réutilisée.');
  }
  const existingCampaignRows = gHistory.filter((row) =>
    isCollectionsCorePilotCampaignAssignment(row, manifest),
  );
  if (currentMarker.length === 0 && existingCampaignRows.length > 0) {
    throw new CollectionsCoreServiceError('Cet identifiant de campagne existe déjà sans marqueur de reprise valide.');
  }
  const activeManage = gHistory.filter((row) => row.capability === 'MANAGE_ACCESS' && row.isActive);
  if (activeManage.some((row) => row.reason !== collectionsCorePilotBootstrapReason(manifest))) {
    throw new CollectionsCoreServiceError('Un MANAGE_ACCESS préexistant interdit le bootstrap automatique.');
  }
  if (activeManage.length > 1) {
    throw new CollectionsCoreServiceError('Plusieurs marqueurs MANAGE_ACCESS actifs rendent la campagne ambiguë.');
  }
  if (activeManage.length === 0) {
    await mutatePilotCapability({
      commandKey: collectionsCorePilotBootstrapCommandKey(manifest),
      userId: manifest.grantorUserId,
      capability: 'MANAGE_ACCESS',
      active: true,
      reason: collectionsCorePilotBootstrapReason(manifest),
    });
  }

  try {
    const beforeBusinessMutation = await readPilotAssignments([
      manifest.grantorUserId,
      manifest.operatorUserId,
      manifest.controllerUserId,
    ]);
    const campaignHistory = await readCampaignAssignments(manifest);
    const unexpectedCampaignRows = campaignHistory.filter(
      (row) =>
        isCollectionsCorePilotCampaignAssignment(row, manifest) &&
        !(
          row.grantedBy === manifest.grantorUserId &&
          ((row.userId === manifest.grantorUserId &&
            row.capability === 'MANAGE_ACCESS' &&
            row.reason === collectionsCorePilotBootstrapReason(manifest)) ||
            collectionsCorePilotCapabilitySpecs(manifest).some(
              (spec) =>
                spec.userId === row.userId &&
                spec.capability === row.capability &&
                row.reason === collectionsCorePilotGrantReason(manifest, spec),
            ))
        ),
    );
    if (unexpectedCampaignRows.length) {
      throw new CollectionsCoreServiceError('La campagne contient une habilitation inattendue.');
    }
    const allowedOperatorCapabilities = new Set(['ENTRY']);
    const allowedControllerCapabilities = new Set(['VALIDATE_REMITTANCE', 'AUDIT']);
    if (
      activeCapabilities(beforeBusinessMutation, manifest.operatorUserId).some(
        (capability) => !allowedOperatorCapabilities.has(capability),
      ) ||
      activeCapabilities(beforeBusinessMutation, manifest.controllerUserId).some(
        (capability) => !allowedControllerCapabilities.has(capability),
      )
    ) {
      throw new CollectionsCoreServiceError('A ou B possède une capacité Core hors matrice du pilote.');
    }

    for (const spec of collectionsCorePilotCapabilitySpecs(manifest)) {
      const alreadyActive = beforeBusinessMutation.some(
        (row) => row.userId === spec.userId && row.capability === spec.capability && row.isActive,
      );
      if (!alreadyActive) {
        await mutatePilotCapability({
          commandKey: collectionsCorePilotGrantCommandKey(manifest, spec),
          userId: spec.userId,
          capability: spec.capability,
          active: true,
          reason: collectionsCorePilotGrantReason(manifest, spec),
        });
      }
    }
    const prepared = await inspectCollectionsCorePilotAdministration();
    if (
      JSON.stringify(prepared.operatorActiveCapabilities) !== JSON.stringify(['ENTRY']) ||
      JSON.stringify(prepared.controllerActiveCapabilities) !==
        JSON.stringify(['AUDIT', 'VALIDATE_REMITTANCE']) ||
      !prepared.grantorManageAccessActive
    ) {
      throw new CollectionsCoreServiceError('La matrice de capacités exacte du pilote n’a pas été obtenue.');
    }
    return prepared;
  } catch (error) {
    await closeCollectionsCoreStagingPilot().catch(() => undefined);
    throw error;
  }
}

export async function closeCollectionsCoreStagingPilot(): Promise<CollectionsCorePilotAdministrationState> {
  const ready = await assertReady('administration');
  const manifest = ready.manifest!;
  const before = await readPilotAssignments([
    manifest.grantorUserId,
    manifest.operatorUserId,
    manifest.controllerUserId,
  ]);

  const campaignHistory = await readCampaignAssignments(manifest);
  for (const campaignRow of campaignHistory.filter(
    (row) =>
      row.isActive &&
      !(row.userId === manifest.grantorUserId && row.capability === 'MANAGE_ACCESS'),
  )) {
    if (campaignRow.grantedBy !== manifest.grantorUserId) {
      throw new CollectionsCoreServiceError('Une ligne de campagne n’a pas été créée par G ; fermeture automatique refusée.');
    }
      await mutatePilotCapability({
        commandKey: `${manifest.campaignId}:REVOKE:${campaignRow.id}`,
        userId: campaignRow.userId,
        capability: campaignRow.capability,
        active: false,
        reason: `${manifest.campaignId}:REVOKE:CAMPAIGN:${campaignRow.capability}`,
      });
  }

  const businessPostControl = await readPilotAssignments([
    manifest.operatorUserId,
    manifest.controllerUserId,
  ]);
  const campaignPostControl = await readCampaignAssignments(manifest);
  const activeCampaignBusinessRows = campaignPostControl.filter(
    (row) =>
      row.isActive &&
      !(row.userId === manifest.grantorUserId && row.capability === 'MANAGE_ACCESS'),
  );
  if (activeCampaignBusinessRows.length) {
    throw new CollectionsCoreServiceError('Le post-contrôle A/B a échoué ; G conserve MANAGE_ACCESS.');
  }
  for (const userId of [manifest.operatorUserId, manifest.controllerUserId]) {
    const expectedBaseline = before
      .filter(
        (row) =>
          row.userId === userId &&
          row.isActive &&
          !isCollectionsCorePilotCampaignAssignment(row, manifest),
      )
      .map((row) => row.capability)
      .sort();
    const observed = activeCapabilities(businessPostControl, userId);
    if (JSON.stringify(expectedBaseline) !== JSON.stringify(observed)) {
      throw new CollectionsCoreServiceError('La baseline A/B n’est pas restaurée ; G conserve MANAGE_ACCESS.');
    }
  }

  const gMarker = before.find(
    (row) =>
      row.userId === manifest.grantorUserId &&
      row.capability === 'MANAGE_ACCESS' &&
      row.isActive &&
      row.reason === collectionsCorePilotBootstrapReason(manifest),
  );
  if (gMarker) {
    await mutatePilotCapability({
      commandKey: `${manifest.campaignId}:REVOKE:G:MANAGE_ACCESS`,
      userId: manifest.grantorUserId,
      capability: 'MANAGE_ACCESS',
      active: false,
      reason: collectionsCorePilotRevokeReason(manifest, 'G', 'MANAGE_ACCESS'),
    });
  }

  const ownPostControl = await readPilotAssignments([manifest.grantorUserId]);
  if (ownPostControl.some((row) => row.capability === 'MANAGE_ACCESS' && row.isActive)) {
    throw new CollectionsCoreServiceError('La révocation finale de MANAGE_ACCESS n’est pas prouvée.');
  }
  const expectedGrantorBaseline = before
    .filter(
      (row) =>
        row.userId === manifest.grantorUserId &&
        row.isActive &&
        !isCollectionsCorePilotCampaignAssignment(row, manifest),
    )
    .map((row) => row.capability)
    .sort();
  if (JSON.stringify(expectedGrantorBaseline) !== JSON.stringify(activeCapabilities(ownPostControl, manifest.grantorUserId))) {
    throw new CollectionsCoreServiceError('La baseline G0 n’est pas restaurée après fermeture.');
  }
  return {
    campaignAssignments: [...businessPostControl, ...ownPostControl].filter((row) =>
      isCollectionsCorePilotCampaignAssignment(row, manifest),
    ),
    operatorActiveCapabilities: activeCapabilities(businessPostControl, manifest.operatorUserId),
    controllerActiveCapabilities: activeCapabilities(businessPostControl, manifest.controllerUserId),
    grantorManageAccessActive: false,
  };
}

export async function getCollectionCapabilities(): Promise<Record<CollectionCapability, boolean>> {
  const ready = await assertReady('capabilities');
  if (ready.environment === 'staging') {
    const actor = collectionsCorePilotActor(ready.manifest!, ready.userId);
    return {
      ENTRY: actor === 'A',
      VALIDATE_REMITTANCE: actor === 'B',
      PROPOSE_MATCH: false,
      CONFIRM_MATCH: false,
      AUDIT: actor === 'B',
    };
  }
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
  await assertReady('entry');
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
  const ready = await assertReady('entry');
  const { input, workflowKey } = command;
  if (ready.environment === 'staging') {
    assertExactCollectionsCorePilotEntry(ready.manifest!, input, workflowKey);
    const activeAccounts = await listCollectionAccounts();
    const depositAccount = activeAccounts.find(
      (account) => account.id === ready.manifest!.dataset.entry.depositAccountId,
    );
    if (!depositAccount || depositAccount.currency !== ready.manifest!.dataset.entry.currency) {
      throw new CollectionsCoreServiceError(
        'Le compte de dépôt synthétique est absent, inactif ou dans une autre devise.',
        'PILOT_DEPOSIT_ACCOUNT_REJECTED',
      );
    }
  }
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
  const ready = await assertReady('validation');
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
  const mapped = rows.map((row) => ({
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
  return ready.environment === 'staging'
    ? mapped.filter(
        (row) =>
          row.remittanceCreatedBy === ready.manifest!.operatorUserId &&
          row.clientName === ready.manifest!.dataset.entry.clientName &&
          row.amount === ready.manifest!.dataset.entry.amount &&
          row.currency === ready.manifest!.dataset.entry.currency &&
          row.depositAccountId === ready.manifest!.dataset.entry.depositAccountId &&
          row.depositDate === ready.manifest!.dataset.entry.depositDate,
      )
    : mapped;
}

export async function validateCollectionRemittance(remittanceId: string, reason: string): Promise<void> {
  const ready = await assertReady('validation');
  const validationCommandKey = ready.environment === 'staging'
    ? ready.manifest!.dataset.validationCommandKey
    : commandKey('validate');
  if (ready.environment === 'staging') {
    assertExactCollectionsCorePilotValidation(ready.manifest!, reason, validationCommandKey);
    const exactDrafts = await listRemittanceWorkItems(['DRAFT']);
    if (!exactDrafts.some((row) => row.remittanceId === remittanceId)) {
      throw new CollectionsCoreServiceError(
        'La remise ciblée ne correspond pas au brouillon exact de la campagne.',
        'PILOT_REMITTANCE_REJECTED',
      );
    }
  }
  const { error } = await coreSupabase.rpc('validate_collection_remittance_v1', {
    p_command_key: validationCommandKey,
    p_remittance_id: remittanceId,
    p_reason: reason.trim(),
  });
  if (error) throw safeError(error, 'Validation de la remise refusée.');
}

export async function listActiveCreditLines(): Promise<CreditLine[]> {
  await assertReady('phase_b');
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
  await assertReady('phase_b');
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
  await assertReady('phase_b');
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
  await assertReady('phase_b');
  const { error } = await coreSupabase.rpc('confirm_collection_match_v1', {
    p_command_key: commandKey('match-decision'),
    p_proposal_id: proposalId,
    p_decision: decision,
    p_reason: reason.trim(),
  });
  if (error) throw safeError(error, 'Décision de rapprochement refusée.');
}

export async function exportCollectionRegister(): Promise<RegisterRow[]> {
  const ready = await assertReady('audit');
  const { data, error } = await coreSupabase.rpc('export_collection_register_v1');
  if (error) throw safeError(error, 'Lecture du registre Collections impossible.');
  const rows = z
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
  return ready.environment === 'staging'
    ? rows.filter(
        (row) =>
          row.clientName === ready.manifest!.dataset.entry.clientName &&
          row.expectedAmount === ready.manifest!.dataset.entry.amount &&
          row.currency === ready.manifest!.dataset.entry.currency,
      )
    : rows;
}
