// Cible d'exécution du module Factures, engagements et chèques. La production
// est refusée par défaut ; seul un drapeau de build dédié y ouvre le mode
// « administration seule », sur le projet de production exact. Le staging exige
// l'origine exacte et un drapeau explicite ; le local exige son propre drapeau.
// Le serveur garde de toute façon son interrupteur fermé par défaut et vérifie
// seul l'autorité de l'administrateur.

export interface PayablesRuntimeInput {
  localEnabled?: string;
  stagingEnabled?: string;
  productionAdminOnly?: string;
  supabaseUrl?: string;
  projectId?: string;
}

/** `full` : module complet (local, staging). `admin-only` : panneau d'administration seul (production). */
export type PayablesRuntimeMode = 'full' | 'admin-only';

export type PayablesRuntimeVerdict =
  | { allowed: true; environment: 'local' | 'staging'; mode: 'full' }
  | { allowed: true; environment: 'production'; mode: 'admin-only' }
  | { allowed: false; reason: string };

// Type guard explicite (projet non strict, docs/BASELINES.md §3).
export function isRuntimeRefused(verdict: PayablesRuntimeVerdict): verdict is Extract<PayablesRuntimeVerdict, { allowed: false }> {
  return verdict.allowed === false;
}

export const PAYABLES_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv';
export const PAYABLES_PRODUCTION_PROJECT_REF = 'leakcdbbawzysfqyqsnr';

const STAGING_ORIGIN = `https://${PAYABLES_STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION_ORIGIN = `https://${PAYABLES_PRODUCTION_PROJECT_REF}.supabase.co`;
const PRODUCTION_HOST = `${PAYABLES_PRODUCTION_PROJECT_REF}.supabase.co`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Origine HTTPS nue : ni identifiants, ni port, ni chemin, ni paramètres. */
function isExactOrigin(url: URL, origin: string): boolean {
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === ''
    && url.pathname === '/' && url.search === '' && url.hash === '' && url.origin === origin;
}

export function validatePayablesRuntimeTarget(input: PayablesRuntimeInput): PayablesRuntimeVerdict {
  let url: URL;
  try {
    url = new URL(input.supabaseUrl ?? '');
  } catch {
    return { allowed: false, reason: 'La cible du module chèques est invalide.' };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  const adminOnly = input.productionAdminOnly === 'true';
  if (hostname === PRODUCTION_HOST || input.projectId === PAYABLES_PRODUCTION_PROJECT_REF) {
    if (!adminOnly) return { allowed: false, reason: 'Le module chèques reste interdit en production.' };
    // Production : origine et project ID exacts, aucun autre drapeau d'environnement.
    if (!isExactOrigin(url, PRODUCTION_ORIGIN) || input.projectId !== PAYABLES_PRODUCTION_PROJECT_REF
      || input.localEnabled === 'true' || input.stagingEnabled === 'true') {
      return { allowed: false, reason: 'La cible de production du module chèques est contradictoire.' };
    }
    return { allowed: true, environment: 'production', mode: 'admin-only' };
  }
  if (adminOnly) {
    return { allowed: false, reason: 'Le mode administration seule est réservé au projet de production.' };
  }
  if (LOCAL_HOSTS.has(hostname)) {
    if (input.localEnabled !== 'true') return { allowed: false, reason: 'Le module chèques local n’est pas activé.' };
    if (input.projectId === PAYABLES_STAGING_PROJECT_REF) {
      return { allowed: false, reason: 'La cible locale du module chèques est contradictoire.' };
    }
    return { allowed: true, environment: 'local', mode: 'full' };
  }
  if (!isExactOrigin(url, STAGING_ORIGIN)) {
    return { allowed: false, reason: 'Le module chèques est limité au staging approuvé.' };
  }
  if (input.projectId !== PAYABLES_STAGING_PROJECT_REF) {
    return { allowed: false, reason: 'Le project ID du module chèques ne correspond pas à la cible.' };
  }
  if (input.stagingEnabled !== 'true') {
    return { allowed: false, reason: 'Le module chèques n’est pas activé sur le staging.' };
  }
  return { allowed: true, environment: 'staging', mode: 'full' };
}

export function currentPayablesRuntimeVerdict(): PayablesRuntimeVerdict {
  return validatePayablesRuntimeTarget({
    localEnabled: import.meta.env.VITE_PAYABLES_CHEQUES_LOCAL_ENABLED,
    stagingEnabled: import.meta.env.VITE_PAYABLES_CHEQUES_STAGING_ENABLED,
    productionAdminOnly: import.meta.env.VITE_PAYABLES_CHEQUES_PRODUCTION_ADMIN_ONLY,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
  });
}
