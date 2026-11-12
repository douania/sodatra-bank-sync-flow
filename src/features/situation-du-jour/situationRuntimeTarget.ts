// Cible d'exécution de l'écran « Situation du jour » (mode local, calcul en
// mémoire, aucune persistance). Deux éléments sont vérifiés CONJOINTEMENT :
// l'origine réelle de la page et la cible Supabase configurée dans le bundle.
// - La page doit être servie sur la boucle locale : tout autre hôte (production,
//   staging hébergé dont l'origine applicative reste à établir, hôte inconnu)
//   est refusé avant le montage de l'écran, quels que soient les drapeaux.
// - La cible de production est TOUJOURS refusée.
// - Sur la boucle locale, la cible peut être un Supabase local (drapeau local)
//   ou le staging approuvé (origine et project ID exacts, drapeau staging).

export interface SituationRuntimeInput {
  /** Origine réelle de la page (`window.location.origin`). */
  pageOrigin?: string;
  localEnabled?: string;
  stagingEnabled?: string;
  supabaseUrl?: string;
  projectId?: string;
}

export type SituationRuntimeVerdict =
  | { allowed: true; environment: 'local' | 'local-with-staging-backend' }
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
export const SITUATION_PAGE_ORIGIN_REFUSED = 'L’écran « Situation du jour » n’est ouvert que sur un poste local.';

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
}

/** Origine HTTPS nue : ni identifiants, ni port, ni chemin, ni paramètres. */
function isExactOrigin(url: URL, origin: string): boolean {
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === ''
    && url.pathname === '/' && url.search === '' && url.hash === '' && url.origin === origin;
}

/** Page servie sur la boucle locale, en http ou https, sans identifiants. */
function isLoopbackPage(pageOrigin: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(pageOrigin ?? '');
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''
    && LOCAL_HOSTS.has(normalizedHost(url));
}

export function validateSituationRuntimeTarget(input: SituationRuntimeInput): SituationRuntimeVerdict {
  // Le project ID de production suffit à refuser, avant toute autre analyse.
  if (input.projectId === SITUATION_PRODUCTION_PROJECT_REF) {
    return { allowed: false, reason: SITUATION_PRODUCTION_REFUSED };
  }
  let url: URL | null = null;
  try {
    url = new URL(input.supabaseUrl ?? '');
  } catch {
    url = null;
  }
  if (url !== null && normalizedHost(url) === PRODUCTION_HOST) {
    return { allowed: false, reason: SITUATION_PRODUCTION_REFUSED };
  }
  // Origine réelle de la page : boucle locale exigée (hôte de production ou inconnu refusé).
  if (!isLoopbackPage(input.pageOrigin)) {
    return { allowed: false, reason: SITUATION_PAGE_ORIGIN_REFUSED };
  }
  if (url === null) {
    return { allowed: false, reason: 'La cible de l’écran « Situation du jour » est invalide.' };
  }
  if (LOCAL_HOSTS.has(normalizedHost(url))) {
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
  return { allowed: true, environment: 'local-with-staging-backend' };
}

export function currentSituationRuntimeVerdict(): SituationRuntimeVerdict {
  return validateSituationRuntimeTarget({
    pageOrigin: typeof window !== 'undefined' && window.location ? window.location.origin : undefined,
    localEnabled: import.meta.env.VITE_SITUATION_DU_JOUR_LOCAL_ENABLED,
    stagingEnabled: import.meta.env.VITE_SITUATION_DU_JOUR_STAGING_ENABLED,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
  });
}
