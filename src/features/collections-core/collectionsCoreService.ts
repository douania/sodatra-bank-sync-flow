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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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
    capability_scope: z.record(z.string(), z.unknown()).nullable().optional(),
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
    capabilityScope: row.capability_scope ?? null,
  }));
}

async function readPilotAssignments(userIds: string[]): Promise<CollectionsCorePilotAssignment[]> {
  const { data, error } = await coreSupabase
    .from('collection_domain_assignments')
    .select('id,user_id,capability,is_active,granted_by,reason,created_at,revoked_at,revoked_by,capability_scope')
    .in('user_id', userIds)
    .order('created_at');
  if (error) throw safeError(error, 'Lecture des habilitations du pilote impossible.');
  return mapAssignmentRows(data);
}

async function readCampaignAssignments(manifest: CollectionsCorePilotManifest) {
  const { data, error } = await coreSupabase
    .from('collection_domain_assignments')
    .select('id,user_id,capability,is_active,granted_by,reason,created_at,revoked_at,revoked_by,capability_scope')
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
  scope?: Record<string, unknown> | null;
}) {
  const { data, error } = await coreSupabase.rpc('grant_collection_capability_v2', {
    p_command_key: input.commandKey,
    p_user_id: input.userId,
    p_capability: input.capability,
    p_active: input.active,
    p_reason: input.reason,
    p_scope: input.active ? (input.scope ?? null) : null,
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
    const specs = collectionsCorePilotCapabilitySpecs(manifest);
    const allowedOperatorCapabilities = new Set<string>(specs.filter((row) => row.actor === 'A').map((row) => row.capability));
    const allowedControllerCapabilities = new Set<string>(specs.filter((row) => row.actor === 'B').map((row) => row.capability));
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
      const activeAssignment = beforeBusinessMutation.find(
        (row) => row.userId === spec.userId && row.capability === spec.capability && row.isActive,
      );
      if (activeAssignment && canonicalJson(activeAssignment.capabilityScope) !== canonicalJson(spec.scope)) {
        throw new CollectionsCoreServiceError('Le scope actif ne correspond pas à l’allowlist scellée du pilote.');
      }
      if (!activeAssignment) {
        await mutatePilotCapability({
          commandKey: collectionsCorePilotGrantCommandKey(manifest, spec),
          userId: spec.userId,
          capability: spec.capability,
          active: true,
          reason: collectionsCorePilotGrantReason(manifest, spec),
          scope: spec.scope,
        });
      }
    }
    const prepared = await inspectCollectionsCorePilotAdministration();
    if (
      JSON.stringify(prepared.operatorActiveCapabilities) !== JSON.stringify(
        [...allowedOperatorCapabilities].sort(),
      ) ||
      JSON.stringify(prepared.controllerActiveCapabilities) !== JSON.stringify(
        [...allowedControllerCapabilities].sort(),
      ) ||
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
    const phaseB = Boolean(ready.manifest!.dataset.phaseB);
    return {
      ENTRY: !phaseB && actor === 'A',
      VALIDATE_REMITTANCE: !phaseB && actor === 'B',
      PROPOSE_MATCH: phaseB && actor === 'A',
      CONFIRM_MATCH: phaseB && actor === 'B',
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
      const helper = capability === 'PROPOSE_MATCH' || capability === 'CONFIRM_MATCH'
        ? 'collection_current_actor_has_phase_b_capability'
        : 'collection_current_actor_has_capability';
      const { data, error } = await coreSupabase.rpc(helper, {
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
  action: CollectionsCorePilotAction = 'validation',
): Promise<RemittanceWorkItem[]> {
  const ready = await assertReady(action);
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
  if (ready.environment !== 'staging') return mapped;
  const phaseB = ready.manifest!.dataset.phaseB;
  if (phaseB) return mapped.filter((row) => row.itemId === phaseB.remittanceItemId);
  return mapped.filter(
    (row) =>
      row.remittanceCreatedBy === ready.manifest!.operatorUserId &&
      row.clientName === ready.manifest!.dataset.entry.clientName &&
      row.amount === ready.manifest!.dataset.entry.amount &&
      row.currency === ready.manifest!.dataset.entry.currency &&
      row.depositAccountId === ready.manifest!.dataset.entry.depositAccountId &&
      row.depositDate === ready.manifest!.dataset.entry.depositDate,
  );
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

export async function listCollectionMatchCandidates(input: {
  itemId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<CreditLine[]> {
  const ready = await assertReady('phase_b_propose');
  if (ready.environment === 'staging') {
    const expected = ready.manifest!.dataset.phaseB!;
    if (input.itemId !== expected.remittanceItemId || input.dateFrom !== expected.dateFrom || input.dateTo !== expected.dateTo) {
      throw new CollectionsCoreServiceError('La recherche ne correspond pas à l’allowlist Phase B scellée.', 'PILOT_PHASE_B_SCOPE_REJECTED');
    }
  }
  const { data, error } = await coreSupabase.rpc('list_collection_match_candidates_v1', {
    p_remittance_item_id: input.itemId,
    p_date_from: input.dateFrom,
    p_date_to: input.dateTo,
    p_limit: 50,
  });
  if (error) throw safeError(error, 'Lecture des crédits bancaires impossible.');
  const rows = z
    .array(
      z.object({
        daily_line_id: z.string().uuid(),
        canonical_unit_id: z.string().uuid(),
        daily_line_hash: z.string().regex(/^[0-9a-f]{64}$/),
        account_registry_id: z.string().uuid(),
        accounting_date: z.string(),
        value_date: z.string().nullable(),
        description_sanitized: z.string(),
        credit_amount: z.coerce.number(),
        unallocated_credit_amount: z.coerce.number(),
        currency: z.string(),
        source_attempt_id: z.string().uuid(),
        source_raw_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
        reference_signal: z.string(),
        reason_codes: z.array(z.string()),
      }),
    )
    .parse(data ?? []);
  if (ready.environment === 'staging') {
    const expected = ready.manifest!.dataset.phaseB!;
    const row = rows[0];
    if (rows.length !== 1 || row.daily_line_id !== expected.dailyLineId || row.canonical_unit_id !== expected.canonicalUnitId ||
        row.daily_line_hash !== expected.dailyLineHash || row.account_registry_id !== expected.accountRegistryId ||
        row.accounting_date !== expected.accountingDate || row.credit_amount !== expected.creditAmount ||
        row.currency !== expected.currency || row.source_attempt_id !== expected.sourceAttemptId ||
        row.source_raw_text_hash !== expected.sourceRawTextHash) {
      throw new CollectionsCoreServiceError('Le snapshot bancaire retourné diverge du manifeste Phase B.', 'PILOT_PHASE_B_SNAPSHOT_REJECTED');
    }
  }
  return rows.map((row) => ({
      id: row.daily_line_id,
      canonicalUnitId: row.canonical_unit_id,
      dailyLineHash: row.daily_line_hash,
      accountingDate: row.accounting_date,
      valueDate: row.value_date,
      description: row.description_sanitized,
      amount: row.credit_amount,
      unallocatedAmount: row.unallocated_credit_amount,
      currency: row.currency,
      accountId: row.account_registry_id,
      sourceAttemptId: row.source_attempt_id,
      sourceRawTextHash: row.source_raw_text_hash,
      referenceSignal: row.reference_signal,
      reasonCodes: row.reason_codes,
    }));
}

export async function proposeCollectionMatch(input: {
  itemId: string;
  creditLine: CreditLine;
  creditConsumedAmount: number;
  settledGrossAmount: number;
  evidenceBasis: EvidenceBasis;
  reason: string;
}): Promise<void> {
  const ready = await assertReady('phase_b_propose');
  if (ready.environment === 'staging') {
    const expected = ready.manifest!.dataset.phaseB!;
    if (input.itemId !== expected.remittanceItemId || input.creditLine.id !== expected.dailyLineId ||
        input.evidenceBasis !== expected.evidenceBasis || input.creditConsumedAmount !== expected.creditAmount ||
        input.settledGrossAmount !== expected.settledGrossAmount || input.reason !== expected.proposalReason) {
      throw new CollectionsCoreServiceError('La proposition diverge du manifeste Phase B.', 'PILOT_PHASE_B_COMMAND_REJECTED');
    }
  }
  const payload = buildMatchPayload(input);
  const { error } = await coreSupabase.rpc('propose_collection_match_v2', {
    p_command_key: ready.environment === 'staging' ? ready.manifest!.dataset.phaseB!.proposalCommandKey : commandKey('match-proposal'),
    p_action: 'CREATE',
    p_proposal_id: null,
    p_payload: payload,
  });
  if (error) throw safeError(error, 'Proposition de rapprochement refusée.');
}

export async function listPendingMatchProposals(): Promise<MatchProposal[]> {
  await assertReady('phase_b_review');
  const { data, error } = await coreSupabase.rpc('list_collection_match_reviews_v1', { p_limit: 50 });
  if (error) throw safeError(error, 'Lecture des rapprochements en attente impossible.');
  return z
    .array(
      z.object({
        proposal_id: z.string().uuid(),
        created_at: z.string(),
        proposed_by: z.string().uuid(),
        remittance_item_id: z.string().uuid(),
        client_name: z.string(),
        deposit_account_id: z.string().uuid(),
        account_safe_alias: z.string(),
        nominal_amount: z.coerce.number(),
        credit_amount: z.coerce.number(),
        observed_fee_amount: z.coerce.number(),
        evidence_basis: z.string(),
        proposal_reason: z.string(),
        accounting_date: z.string(),
        description_sanitized: z.string(),
        reference_signal: z.string(),
        reason_codes: z.array(z.string()),
        evidence_available: z.boolean(),
      }),
    )
    .parse(data ?? [])
    .map((row) => ({
      id: row.proposal_id,
      createdAt: row.created_at,
      proposedBy: row.proposed_by,
      remittanceItemId: row.remittance_item_id,
      clientName: row.client_name,
      depositAccountId: row.deposit_account_id,
      accountAlias: row.account_safe_alias,
      nominalAmount: row.nominal_amount,
      creditAmount: row.credit_amount,
      feeAmount: row.observed_fee_amount,
      evidenceBasis: row.evidence_basis,
      reason: row.proposal_reason,
      accountingDate: row.accounting_date,
      description: row.description_sanitized,
      referenceSignal: row.reference_signal,
      reasonCodes: row.reason_codes,
      evidenceAvailable: row.evidence_available,
    }));
}

export async function decideCollectionMatch(
  proposalId: string,
  decision: 'CONFIRM' | 'REJECT',
  reason: string,
): Promise<void> {
  const ready = await assertReady('phase_b_review');
  if (ready.environment === 'staging' && reason !== ready.manifest!.dataset.phaseB!.confirmationReason) {
    throw new CollectionsCoreServiceError('La décision diverge du manifeste Phase B.', 'PILOT_PHASE_B_COMMAND_REJECTED');
  }
  const { error } = await coreSupabase.rpc('confirm_collection_match_v2', {
    p_command_key: ready.environment === 'staging' ? ready.manifest!.dataset.phaseB!.confirmationCommandKey : commandKey('match-decision'),
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
