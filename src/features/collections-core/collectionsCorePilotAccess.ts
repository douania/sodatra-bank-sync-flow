import { z } from 'zod';
import type {
  CollectionsCorePilotRawManifest,
  CollectionsCoreRuntimeVerdict,
} from './collectionsCoreRuntimeTarget';
import type { CollectionEntryInput } from './collectionsCoreTypes';

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDateSchema = z.union([dateSchema, z.literal('')]);

const entrySchema = z
  .object({
    clientName: z.string().min(1),
    method: z.enum(['CHECK', 'EFFECT', 'TRANSFER', 'CASH']),
    amount: z.number().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    clientBank: z.string(),
    depositAccountId: uuidSchema,
    depositDate: dateSchema,
    declaredCreditDate: optionalDateSchema,
    instrumentReference: z.string(),
    maturityDate: optionalDateSchema,
    invoiceReference: z.string(),
    slipReference: z.string(),
    businessNature: z.enum(['STANDARD', 'PROROGATION']),
    note: z.string(),
  })
  .strict();

const datasetSchema = z
  .object({
    entry: entrySchema,
    entryCommandKey: z.string().min(1),
    validationReason: z.string().min(1),
    validationCommandKey: z.string().min(1),
  })
  .strict();

export interface CollectionsCorePilotDataset {
  entry: CollectionEntryInput;
  entryCommandKey: string;
  validationReason: string;
  validationCommandKey: string;
}

export interface CollectionsCorePilotManifest {
  campaignId: string;
  grantorUserId: string;
  operatorUserId: string;
  controllerUserId: string;
  datasetBase64: string;
  datasetSha256: string;
  dataset: CollectionsCorePilotDataset;
}

export type CollectionsCorePilotGateState =
  | { status: 'checking' }
  | { status: 'blocked'; reason: string }
  | { status: 'allowed'; environment: 'local' }
  | {
      status: 'allowed';
      environment: 'staging';
      pilotManifest: CollectionsCorePilotManifest;
    };

export type CollectionsCorePilotActor = 'G' | 'A' | 'B';
export type CollectionsCorePilotAction =
  | 'route'
  | 'capabilities'
  | 'administration'
  | 'entry'
  | 'validation'
  | 'audit'
  | 'phase_b';

export type CollectionsCorePilotCapability =
  | 'ENTRY'
  | 'VALIDATE_REMITTANCE'
  | 'AUDIT'
  | 'MANAGE_ACCESS';

export interface CollectionsCorePilotAssignment {
  id: string;
  userId: string;
  capability: string;
  isActive: boolean;
  grantedBy: string;
  reason: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface CollectionsCorePilotCapabilitySpec {
  actor: 'A' | 'B';
  userId: string;
  capability: 'ENTRY' | 'VALIDATE_REMITTANCE' | 'AUDIT';
}

const CAMPAIGN_PATTERN =
  /^PILOT-0Z1B-(\d{8})-G([0-9a-f]{32})-N([0-9a-f]{32})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const resolvedGateCache = new Map<string, Promise<CollectionsCorePilotGateState>>();

function normalizeUuid(value: string): string {
  return value.toLowerCase().replace(/-/g, '');
}

function rawManifestSignature(raw: CollectionsCorePilotRawManifest): string {
  return JSON.stringify([
    raw.campaignId,
    raw.grantorUserId,
    raw.operatorUserId,
    raw.controllerUserId,
    raw.datasetBase64,
    raw.datasetSha256,
  ]);
}

export function collectionsCoreRuntimeSignature(verdict: CollectionsCoreRuntimeVerdict): string {
  if ('reason' in verdict) return `blocked:${verdict.reason}`;
  if (verdict.environment === 'local') return 'allowed:local';
  return `allowed:staging:${rawManifestSignature(verdict.pilotRaw)}`;
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new Error('Le dataset Base64 du pilote est invalide.');
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error('Le dataset Base64 du pilote est invalide.');
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let encoded = '';
  for (const byte of bytes) encoded += String.fromCharCode(byte);
  if (btoa(encoded) !== value) {
    throw new Error('Le dataset Base64 du pilote n’est pas canonique.');
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('La vérification cryptographique du pilote est indisponible.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateSyntheticText(value: string, campaignId: string, field: string, required: boolean) {
  if (!value) {
    if (required) throw new Error(`Le champ synthétique ${field} est obligatoire.`);
    return;
  }
  if (!value.startsWith(campaignId)) {
    throw new Error(`Le champ ${field} ne porte pas le préfixe de campagne.`);
  }
}

function validateDataset(dataset: CollectionsCorePilotDataset, campaignId: string) {
  validateSyntheticText(dataset.entry.clientName, campaignId, 'clientName', true);
  validateSyntheticText(dataset.entry.clientBank, campaignId, 'clientBank', false);
  validateSyntheticText(
    dataset.entry.instrumentReference,
    campaignId,
    'instrumentReference',
    dataset.entry.method === 'CHECK',
  );
  validateSyntheticText(dataset.entry.invoiceReference, campaignId, 'invoiceReference', false);
  validateSyntheticText(dataset.entry.slipReference, campaignId, 'slipReference', false);
  validateSyntheticText(dataset.entry.note, campaignId, 'note', false);
  validateSyntheticText(dataset.validationReason, campaignId, 'validationReason', true);

  if (dataset.entry.method === 'EFFECT' && !dataset.entry.maturityDate) {
    throw new Error('Le dataset pilote exige une échéance pour un effet.');
  }
  if (dataset.entry.method === 'TRANSFER' || dataset.entry.method === 'CASH') {
    if (dataset.entry.instrumentReference || dataset.entry.maturityDate) {
      throw new Error('Le dataset pilote contient un instrument incompatible avec son mode.');
    }
  }
  if (dataset.entryCommandKey !== `${campaignId}:ENTRY`) {
    throw new Error('La clé de commande de saisie ne correspond pas à la campagne.');
  }
  if (dataset.validationCommandKey !== `${campaignId}:VALIDATE`) {
    throw new Error('La clé de commande de validation ne correspond pas à la campagne.');
  }
}

async function parsePilotManifest(
  raw: CollectionsCorePilotRawManifest,
): Promise<CollectionsCorePilotManifest> {
  const campaignId = z.string().min(1).parse(raw.campaignId);
  const grantorUserId = uuidSchema.parse(raw.grantorUserId).toLowerCase();
  const operatorUserId = uuidSchema.parse(raw.operatorUserId).toLowerCase();
  const controllerUserId = uuidSchema.parse(raw.controllerUserId).toLowerCase();
  const datasetBase64 = z.string().min(1).parse(raw.datasetBase64);
  const datasetSha256 = z.string().regex(SHA256_PATTERN).parse(raw.datasetSha256).toLowerCase();

  if (new Set([grantorUserId, operatorUserId, controllerUserId]).size !== 3) {
    throw new Error('Les trois acteurs du pilote doivent être distincts.');
  }

  const campaignMatch = CAMPAIGN_PATTERN.exec(campaignId);
  if (!campaignMatch || campaignMatch[2] !== normalizeUuid(grantorUserId)) {
    throw new Error('L’identifiant de campagne ne correspond pas au grantor autorisé.');
  }

  const bytes = decodeCanonicalBase64(datasetBase64);
  const observedHash = await sha256Hex(bytes);
  if (observedHash !== datasetSha256) {
    throw new Error('L’empreinte du dataset pilote ne correspond pas au GO.');
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Le dataset pilote n’est pas un texte UTF-8 valide.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('Le dataset pilote n’est pas un JSON valide.');
  }

  const dataset = datasetSchema.parse(parsed) as CollectionsCorePilotDataset;
  validateDataset(dataset, campaignId);
  return {
    campaignId,
    grantorUserId,
    operatorUserId,
    controllerUserId,
    datasetBase64,
    datasetSha256,
    dataset,
  };
}

export async function evaluateCollectionsCorePilotGate(
  verdict: CollectionsCoreRuntimeVerdict,
): Promise<CollectionsCorePilotGateState> {
  if ('reason' in verdict) return { status: 'blocked', reason: verdict.reason };
  if (verdict.environment === 'local') return { status: 'allowed', environment: 'local' };
  try {
    const pilotManifest = await parsePilotManifest(verdict.pilotRaw);
    return { status: 'allowed', environment: 'staging', pilotManifest };
  } catch (error) {
    return {
      status: 'blocked',
      reason: error instanceof Error ? error.message : 'Le manifeste du pilote est invalide.',
    };
  }
}

export function resolveCollectionsCorePilotGate(
  verdict: CollectionsCoreRuntimeVerdict,
): Promise<CollectionsCorePilotGateState> {
  const signature = collectionsCoreRuntimeSignature(verdict);
  const cached = resolvedGateCache.get(signature);
  if (cached) return cached;
  const pending = evaluateCollectionsCorePilotGate(verdict);
  resolvedGateCache.set(signature, pending);
  return pending;
}

export function resetCollectionsCorePilotGateCacheForTests() {
  resolvedGateCache.clear();
}

export function collectionsCorePilotActor(
  manifest: CollectionsCorePilotManifest,
  userId: string,
): CollectionsCorePilotActor | null {
  const normalized = userId.toLowerCase();
  if (normalized === manifest.grantorUserId) return 'G';
  if (normalized === manifest.operatorUserId) return 'A';
  if (normalized === manifest.controllerUserId) return 'B';
  return null;
}

export function isCollectionsCorePilotActionAllowed(
  manifest: CollectionsCorePilotManifest,
  userId: string,
  action: CollectionsCorePilotAction,
): boolean {
  const actor = collectionsCorePilotActor(manifest, userId);
  if (!actor || action === 'phase_b') return false;
  if (action === 'route' || action === 'capabilities') return true;
  if (action === 'administration') return actor === 'G';
  if (action === 'entry') return actor === 'A';
  return actor === 'B';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function assertExactCollectionsCorePilotEntry(
  manifest: CollectionsCorePilotManifest,
  input: CollectionEntryInput,
  commandKey: string,
) {
  if (
    stableJson(input) !== stableJson(manifest.dataset.entry) ||
    commandKey !== manifest.dataset.entryCommandKey
  ) {
    throw new Error('La saisie ne correspond pas au dataset exact du pilote.');
  }
}

export function assertExactCollectionsCorePilotValidation(
  manifest: CollectionsCorePilotManifest,
  reason: string,
  commandKey: string,
) {
  if (
    reason !== manifest.dataset.validationReason ||
    commandKey !== manifest.dataset.validationCommandKey
  ) {
    throw new Error('La validation ne correspond pas au dataset exact du pilote.');
  }
}

export function collectionsCorePilotBootstrapReason(manifest: CollectionsCorePilotManifest) {
  return `${manifest.campaignId}:BOOTSTRAP_MANAGE_ACCESS`;
}

export function collectionsCorePilotBootstrapCommandKey(manifest: CollectionsCorePilotManifest) {
  return `${manifest.campaignId}:GRANT:G:MANAGE_ACCESS`;
}

export function collectionsCorePilotCapabilitySpecs(
  manifest: CollectionsCorePilotManifest,
): CollectionsCorePilotCapabilitySpec[] {
  return [
    { actor: 'A', userId: manifest.operatorUserId, capability: 'ENTRY' },
    { actor: 'B', userId: manifest.controllerUserId, capability: 'VALIDATE_REMITTANCE' },
    { actor: 'B', userId: manifest.controllerUserId, capability: 'AUDIT' },
  ];
}

export function collectionsCorePilotGrantReason(
  manifest: CollectionsCorePilotManifest,
  spec: CollectionsCorePilotCapabilitySpec,
) {
  return `${manifest.campaignId}:GRANT:${spec.actor}:${spec.capability}`;
}

export function collectionsCorePilotGrantCommandKey(
  manifest: CollectionsCorePilotManifest,
  spec: CollectionsCorePilotCapabilitySpec,
) {
  return collectionsCorePilotGrantReason(manifest, spec);
}

export function collectionsCorePilotRevokeReason(
  manifest: CollectionsCorePilotManifest,
  actor: CollectionsCorePilotActor,
  capability: CollectionsCorePilotCapability,
) {
  return `${manifest.campaignId}:REVOKE:${actor}:${capability}`;
}

export function isCollectionsCorePilotCampaignAssignment(
  assignment: CollectionsCorePilotAssignment,
  manifest: CollectionsCorePilotManifest,
) {
  return assignment.reason.startsWith(`${manifest.campaignId}:`);
}
