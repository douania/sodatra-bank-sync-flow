// Cible d'exécution de la vue « Soldes à date » (trésorerie V1, Lot 1). La
// production est TOUJOURS refusée, y compris lorsque le mode « administration
// seule » du module chèques est actif : aucun drapeau ne l'ouvre ici. Le
// staging exige l'origine exacte, le project ID exact et un drapeau explicite ;
// le local exige son propre drapeau. Le serveur vérifie de toute façon seul
// l'habilitation BANK_READ.

export interface TreasuryRuntimeInput {
  localEnabled?: string;
  stagingEnabled?: string;
  supabaseUrl?: string;
  projectId?: string;
}

export type TreasuryRuntimeVerdict =
  | { allowed: true; environment: 'local' | 'staging' }
  | { allowed: false; reason: string };

// Type guard explicite (projet non strict, docs/BASELINES.md §3).
export function isTreasuryRuntimeRefused(
  verdict: TreasuryRuntimeVerdict,
): verdict is Extract<TreasuryRuntimeVerdict, { allowed: false }> {
  return verdict.allowed === false;
}

export const TREASURY_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv';
export const TREASURY_PRODUCTION_PROJECT_REF = 'leakcdbbawzysfqyqsnr';

const STAGING_ORIGIN = `https://${TREASURY_STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION_HOST = `${TREASURY_PRODUCTION_PROJECT_REF}.supabase.co`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const TREASURY_PRODUCTION_REFUSED = 'La vue « Soldes à date » n’est pas ouverte en production.';

/** Origine HTTPS nue : ni identifiants, ni port, ni chemin, ni paramètres. */
function isExactOrigin(url: URL, origin: string): boolean {
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === ''
    && url.pathname === '/' && url.search === '' && url.hash === '' && url.origin === origin;
}

export function validateTreasuryRuntimeTarget(input: TreasuryRuntimeInput): TreasuryRuntimeVerdict {
  // Le project ID de production suffit à refuser, avant toute analyse d'URL.
  if (input.projectId === TREASURY_PRODUCTION_PROJECT_REF) {
    return { allowed: false, reason: TREASURY_PRODUCTION_REFUSED };
  }
  let url: URL;
  try {
    url = new URL(input.supabaseUrl ?? '');
  } catch {
    return { allowed: false, reason: 'La cible de la vue « Soldes à date » est invalide.' };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (hostname === PRODUCTION_HOST) {
    return { allowed: false, reason: TREASURY_PRODUCTION_REFUSED };
  }
  if (LOCAL_HOSTS.has(hostname)) {
    if (input.localEnabled !== 'true') {
      return { allowed: false, reason: 'La vue « Soldes à date » locale n’est pas activée.' };
    }
    if (input.projectId === TREASURY_STAGING_PROJECT_REF) {
      return { allowed: false, reason: 'La cible locale de la vue « Soldes à date » est contradictoire.' };
    }
    return { allowed: true, environment: 'local' };
  }
  if (!isExactOrigin(url, STAGING_ORIGIN)) {
    return { allowed: false, reason: 'La vue « Soldes à date » est limitée au staging approuvé.' };
  }
  if (input.projectId !== TREASURY_STAGING_PROJECT_REF) {
    return { allowed: false, reason: 'Le project ID de la vue « Soldes à date » ne correspond pas à la cible.' };
  }
  if (input.stagingEnabled !== 'true') {
    return { allowed: false, reason: 'La vue « Soldes à date » n’est pas activée sur le staging.' };
  }
  return { allowed: true, environment: 'staging' };
}

export function currentTreasuryRuntimeVerdict(): TreasuryRuntimeVerdict {
  return validateTreasuryRuntimeTarget({
    localEnabled: import.meta.env.VITE_TREASURY_LOCAL_ENABLED,
    stagingEnabled: import.meta.env.VITE_TREASURY_STAGING_ENABLED,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
  });
}
