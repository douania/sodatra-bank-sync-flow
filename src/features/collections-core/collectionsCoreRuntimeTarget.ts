export interface CollectionsCoreRuntimeInput {
  localEnabled?: string;
  stagingPilotEnabled?: string;
  supabaseUrl?: string;
  projectId?: string;
  campaignId?: string;
  grantorUserId?: string;
  operatorUserId?: string;
  controllerUserId?: string;
  datasetBase64?: string;
  datasetSha256?: string;
}

export interface CollectionsCorePilotRawManifest {
  campaignId?: string;
  grantorUserId?: string;
  operatorUserId?: string;
  controllerUserId?: string;
  datasetBase64?: string;
  datasetSha256?: string;
}

export type CollectionsCoreRuntimeVerdict =
  | { allowed: true; environment: 'local' }
  | {
      allowed: true;
      environment: 'staging';
      pilotRaw: CollectionsCorePilotRawManifest;
    }
  | { allowed: false; reason: string };

export const COLLECTIONS_CORE_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv';
export const COLLECTIONS_CORE_PRODUCTION_PROJECT_REF = 'leakcdbbawzysfqyqsnr';

const STAGING_ORIGIN = `https://${COLLECTIONS_CORE_STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION_HOST = `${COLLECTIONS_CORE_PRODUCTION_PROJECT_REF}.supabase.co`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function isExactRemoteUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

export function validateCollectionsCoreRuntimeTarget(
  input: CollectionsCoreRuntimeInput,
): CollectionsCoreRuntimeVerdict {
  let url: URL;
  try {
    url = new URL(input.supabaseUrl ?? '');
  } catch {
    return { allowed: false, reason: 'La cible Collections Core est invalide.' };
  }

  const hostname = normalizedHostname(url);
  if (LOCAL_HOSTS.has(hostname)) {
    if (input.localEnabled !== 'true') {
      return { allowed: false, reason: 'Le module Collections Core local n’est pas activé.' };
    }
    if (
      input.projectId === COLLECTIONS_CORE_STAGING_PROJECT_REF ||
      input.projectId === COLLECTIONS_CORE_PRODUCTION_PROJECT_REF
    ) {
      return { allowed: false, reason: 'La cible locale Collections Core est contradictoire.' };
    }
    return { allowed: true, environment: 'local' };
  }

  if (
    hostname === PRODUCTION_HOST ||
    input.projectId === COLLECTIONS_CORE_PRODUCTION_PROJECT_REF
  ) {
    return { allowed: false, reason: 'Collections Core reste interdit en production.' };
  }

  if (!isExactRemoteUrl(url)) {
    return { allowed: false, reason: 'L’origine distante Collections Core n’est pas autorisée.' };
  }

  if (input.supabaseUrl !== STAGING_ORIGIN && input.supabaseUrl !== `${STAGING_ORIGIN}/`) {
    return { allowed: false, reason: 'L’origine staging Collections Core doit être exacte.' };
  }

  if (url.origin !== STAGING_ORIGIN) {
    return { allowed: false, reason: 'Collections Core est limité au staging approuvé.' };
  }

  if (input.projectId !== COLLECTIONS_CORE_STAGING_PROJECT_REF) {
    return { allowed: false, reason: 'Le project ID Collections Core ne correspond pas à la cible.' };
  }

  if (input.stagingPilotEnabled !== 'true') {
    return { allowed: false, reason: 'Le pilote Collections Core staging n’est pas activé.' };
  }

  return {
    allowed: true,
    environment: 'staging',
    pilotRaw: {
      campaignId: input.campaignId,
      grantorUserId: input.grantorUserId,
      operatorUserId: input.operatorUserId,
      controllerUserId: input.controllerUserId,
      datasetBase64: input.datasetBase64,
      datasetSha256: input.datasetSha256,
    },
  };
}

export function currentCollectionsCoreRuntimeVerdict(): CollectionsCoreRuntimeVerdict {
  return validateCollectionsCoreRuntimeTarget({
    localEnabled: import.meta.env.VITE_COLLECTIONS_CORE_LOCAL_ENABLED,
    stagingPilotEnabled: import.meta.env.VITE_COLLECTIONS_CORE_STAGING_PILOT_ENABLED,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
    campaignId: import.meta.env.VITE_COLLECTIONS_CORE_STAGING_PILOT_CAMPAIGN_ID,
    grantorUserId: import.meta.env.VITE_COLLECTIONS_CORE_STAGING_PILOT_GRANTOR_ID,
    operatorUserId: import.meta.env.VITE_COLLECTIONS_CORE_STAGING_PILOT_OPERATOR_ID,
    controllerUserId: import.meta.env.VITE_COLLECTIONS_CORE_STAGING_PILOT_CONTROLLER_ID,
    datasetBase64: import.meta.env.VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_BASE64,
    datasetSha256: import.meta.env.VITE_COLLECTIONS_CORE_STAGING_PILOT_DATASET_SHA256,
  });
}
