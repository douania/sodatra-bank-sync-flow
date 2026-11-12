// Cible d'exécution de l'écran « Situation du jour » (mode local, calcul en
// mémoire, aucune persistance). La production est TOUJOURS refusée, avant le
// montage de l'écran et quel que soit le drapeau. Le staging approuvé exige
// l'origine exacte, le project ID exact et un drapeau explicite (fermé par
// défaut) ; le local exige la boucle locale et son propre drapeau.

export interface SituationRuntimeInput {
  localEnabled?: string;
  stagingEnabled?: string;
  supabaseUrl?: string;
  projectId?: string;
}

export type SituationRuntimeVerdict =
  | { allowed: true; environment: 'local' | 'staging' }
  | { allowed: false; reason: string };

// Type guard explicite (projet non strict, docs/BASELINES.md §3).
export function isSituationRuntimeRefused(
  verdict: SituationRuntimeVerdict,
): verdict is Extract<SituationRuntimeVerdict, { allowed: false }> {
  return verdict.allowed === false;
}

export const SITUATION_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv';
export const SITUATION_PRODUCTION_PROJECT_REF = 'leakcdbbawzysfqyqsnr';

const STAGING_ORIGIN = `https://${SITUATION_STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION_HOST = `${SITUATION_PRODUCTION_PROJECT_REF}.supabase.co`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const SITUATION_PRODUCTION_REFUSED = 'L’écran « Situation du jour » n’est pas ouvert en production.';

/** Origine HTTPS nue : ni identifiants, ni port, ni chemin, ni paramètres. */
function isExactOrigin(url: URL, origin: string): boolean {
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === ''
    && url.pathname === '/' && url.search === '' && url.hash === '' && url.origin === origin;
}

export function validateSituationRuntimeTarget(input: SituationRuntimeInput): SituationRuntimeVerdict {
  // Le project ID de production suffit à refuser, avant toute analyse d'URL.
  if (input.projectId === SITUATION_PRODUCTION_PROJECT_REF) {
    return { allowed: false, reason: SITUATION_PRODUCTION_REFUSED };
  }
  let url: URL;
  try {
    url = new URL(input.supabaseUrl ?? '');
  } catch {
    return { allowed: false, reason: 'La cible de l’écran « Situation du jour » est invalide.' };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (hostname === PRODUCTION_HOST) {
    return { allowed: false, reason: SITUATION_PRODUCTION_REFUSED };
  }
  if (LOCAL_HOSTS.has(hostname)) {
    if (input.localEnabled !== 'true') {
      return { allowed: false, reason: 'L’écran « Situation du jour » local n’est pas activé.' };
    }
    if (input.projectId === SITUATION_STAGING_PROJECT_REF) {
      return { allowed: false, reason: 'La cible locale de l’écran « Situation du jour » est contradictoire.' };
    }
    return { allowed: true, environment: 'local' };
  }
  if (!isExactOrigin(url, STAGING_ORIGIN)) {
    return { allowed: false, reason: 'L’écran « Situation du jour » est limité au staging approuvé.' };
  }
  if (input.projectId !== SITUATION_STAGING_PROJECT_REF) {
    return { allowed: false, reason: 'Le project ID de l’écran « Situation du jour » ne correspond pas à la cible.' };
  }
  if (input.stagingEnabled !== 'true') {
    return { allowed: false, reason: 'L’écran « Situation du jour » n’est pas activé sur le staging.' };
  }
  return { allowed: true, environment: 'staging' };
}

export function currentSituationRuntimeVerdict(): SituationRuntimeVerdict {
  return validateSituationRuntimeTarget({
    localEnabled: import.meta.env.VITE_SITUATION_DU_JOUR_LOCAL_ENABLED,
    stagingEnabled: import.meta.env.VITE_SITUATION_DU_JOUR_STAGING_ENABLED,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
  });
}
