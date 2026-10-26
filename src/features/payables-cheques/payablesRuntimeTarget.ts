// Cible d'exécution du module Factures, engagements et chèques. La production
// est refusée dans le code ; le staging exige l'origine exacte et un drapeau
// explicite ; le local exige son propre drapeau. Le serveur garde de toute
// façon son interrupteur fermé par défaut.

export interface PayablesRuntimeInput {
  localEnabled?: string;
  stagingEnabled?: string;
  supabaseUrl?: string;
  projectId?: string;
}

export type PayablesRuntimeVerdict =
  | { allowed: true; environment: 'local' | 'staging' }
  | { allowed: false; reason: string };

// Type guard explicite (projet non strict, docs/BASELINES.md §3).
export function isRuntimeRefused(verdict: PayablesRuntimeVerdict): verdict is Extract<PayablesRuntimeVerdict, { allowed: false }> {
  return verdict.allowed === false;
}

export const PAYABLES_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv';
export const PAYABLES_PRODUCTION_PROJECT_REF = 'leakcdbbawzysfqyqsnr';

const STAGING_ORIGIN = `https://${PAYABLES_STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION_HOST = `${PAYABLES_PRODUCTION_PROJECT_REF}.supabase.co`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function validatePayablesRuntimeTarget(input: PayablesRuntimeInput): PayablesRuntimeVerdict {
  let url: URL;
  try {
    url = new URL(input.supabaseUrl ?? '');
  } catch {
    return { allowed: false, reason: 'La cible du module chèques est invalide.' };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (hostname === PRODUCTION_HOST || input.projectId === PAYABLES_PRODUCTION_PROJECT_REF) {
    return { allowed: false, reason: 'Le module chèques reste interdit en production.' };
  }
  if (LOCAL_HOSTS.has(hostname)) {
    if (input.localEnabled !== 'true') return { allowed: false, reason: 'Le module chèques local n’est pas activé.' };
    if (input.projectId === PAYABLES_STAGING_PROJECT_REF) {
      return { allowed: false, reason: 'La cible locale du module chèques est contradictoire.' };
    }
    return { allowed: true, environment: 'local' };
  }
  const exact = url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === ''
    && url.pathname === '/' && url.search === '' && url.hash === '';
  if (!exact || url.origin !== STAGING_ORIGIN) {
    return { allowed: false, reason: 'Le module chèques est limité au staging approuvé.' };
  }
  if (input.projectId !== PAYABLES_STAGING_PROJECT_REF) {
    return { allowed: false, reason: 'Le project ID du module chèques ne correspond pas à la cible.' };
  }
  if (input.stagingEnabled !== 'true') {
    return { allowed: false, reason: 'Le module chèques n’est pas activé sur le staging.' };
  }
  return { allowed: true, environment: 'staging' };
}

export function currentPayablesRuntimeVerdict(): PayablesRuntimeVerdict {
  return validatePayablesRuntimeTarget({
    localEnabled: import.meta.env.VITE_PAYABLES_CHEQUES_LOCAL_ENABLED,
    stagingEnabled: import.meta.env.VITE_PAYABLES_CHEQUES_STAGING_ENABLED,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
  });
}
