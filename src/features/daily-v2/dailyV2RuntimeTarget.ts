/**
 * Garde CLIENT Daily v2 : cible × capacité.
 *
 * Cette garde est une barrière d'interface, JAMAIS une barrière de sécurité :
 * la sécurité réelle reste Auth + rôles + RLS + ACL EXECUTE + gates RPC côté
 * serveur. Elle empêche seulement une application déployée sur une cible
 * donnée de proposer une opération qui n'y est pas autorisée par la politique.
 *
 * Politique statique d'éligibilité :
 *   - staging    : read, deposit, promote, admin ;
 *   - production : read, deposit et promote pour le pilote contrôlé ;
 *                  l'administration du registre et le backfill restent exclus ;
 *   - toute autre cible, URL invalide/non Supabase, ou contradiction entre
 *     l'URL et VITE_SUPABASE_PROJECT_ID : refus fail-closed de TOUTE capacité.
 *
 * Cette table n'ouvre jamais une mutation à elle seule. Les capacités de
 * mutation restent fermées tant que le verrou PostgreSQL privé ne renvoie pas
 * explicitement `true`, puis chaque RPC applique encore Auth, rôles, grants et
 * invariants métier. Aucune capacité n'a de valeur par défaut : chaque
 * appelant la déclare.
 */
export const DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv';
export const DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF = 'leakcdbbawzysfqyqsnr';

export type DailyV2Capability = 'read' | 'deposit' | 'promote' | 'admin';

export type DailyV2AuthorizedProjectRef =
  | typeof DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF
  | typeof DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF;

export const DAILY_V2_CAPABILITIES: readonly DailyV2Capability[] = [
  'read',
  'deposit',
  'promote',
  'admin',
];

const DAILY_V2_CAPABILITY_POLICY: Readonly<
  Record<DailyV2AuthorizedProjectRef, readonly DailyV2Capability[]>
> = {
  [DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF]: ['read', 'deposit', 'promote', 'admin'],
  [DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF]: ['read', 'deposit', 'promote'],
};

export function isDailyV2ProductionPilotProject(
  projectRef: string | null | undefined,
): projectRef is typeof DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF {
  return projectRef === DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF;
}

export interface DailyV2RuntimeTargetInput {
  supabaseUrl?: string;
  projectId?: string;
}

export type DailyV2RuntimeTargetVerdict =
  | { allowed: true; projectRef: DailyV2AuthorizedProjectRef }
  | { allowed: false; reason: string };

function isAuthorizedProjectRef(value: string): value is DailyV2AuthorizedProjectRef {
  return (
    value === DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF ||
    value === DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF
  );
}

export function validateDailyV2RuntimeTarget(
  input: DailyV2RuntimeTargetInput,
  capability: DailyV2Capability,
): DailyV2RuntimeTargetVerdict {
  const supabaseUrl = input.supabaseUrl?.trim() ?? '';
  const projectId = input.projectId?.trim() ?? '';

  if (!DAILY_V2_CAPABILITIES.includes(capability)) {
    return { allowed: false, reason: 'Daily v2 requires an explicit known capability.' };
  }
  if (supabaseUrl === '') {
    return { allowed: false, reason: 'VITE_SUPABASE_URL is required for Daily v2.' };
  }

  let projectRefFromUrl: string;
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase();
    if (!hostname.endsWith('.supabase.co')) {
      return { allowed: false, reason: 'Daily v2 requires a standard Supabase project URL.' };
    }
    projectRefFromUrl = hostname.slice(0, -'.supabase.co'.length);
  } catch {
    return { allowed: false, reason: 'VITE_SUPABASE_URL is invalid.' };
  }

  if (!isAuthorizedProjectRef(projectRefFromUrl)) {
    return { allowed: false, reason: 'Daily v2 target is not an authorized project.' };
  }
  if (projectId !== '' && projectId !== projectRefFromUrl) {
    return { allowed: false, reason: 'VITE_SUPABASE_PROJECT_ID contradicts the target project URL.' };
  }
  if (!DAILY_V2_CAPABILITY_POLICY[projectRefFromUrl].includes(capability)) {
    return {
      allowed: false,
      reason: `Daily v2 capability "${capability}" is not authorized on this target.`,
    };
  }

  return { allowed: true, projectRef: projectRefFromUrl };
}

export function currentDailyV2RuntimeTargetVerdict(
  capability: DailyV2Capability,
): DailyV2RuntimeTargetVerdict {
  return validateDailyV2RuntimeTarget(
    {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
    },
    capability,
  );
}

/** Capacités effectivement autorisées sur la cible courante (UI seulement). */
export function currentDailyV2Capabilities(): Record<DailyV2Capability, boolean> {
  return {
    read: currentDailyV2RuntimeTargetVerdict('read').allowed,
    deposit: currentDailyV2RuntimeTargetVerdict('deposit').allowed,
    promote: currentDailyV2RuntimeTargetVerdict('promote').allowed,
    admin: currentDailyV2RuntimeTargetVerdict('admin').allowed,
  };
}

/**
 * Combine la politique statique de cible avec le verrou PostgreSQL.
 *
 * Seule la valeur booléenne explicite `true` ouvre les capacités de mutation.
 * Une réponse absente, invalide ou en erreur reste donc fail-closed, tandis que
 * la capacité de lecture conserve sa politique statique.
 */
export function applyDailyV2RuntimeMutationLock(
  targetCapabilities: Record<DailyV2Capability, boolean>,
  mutationsEnabled: boolean | null | undefined,
): Record<DailyV2Capability, boolean> {
  const serverAllowsMutations = mutationsEnabled === true;
  return {
    read: targetCapabilities.read,
    deposit: targetCapabilities.deposit && serverAllowsMutations,
    promote: targetCapabilities.promote && serverAllowsMutations,
    admin: targetCapabilities.admin && serverAllowsMutations,
  };
}

export interface DailyV2ImportPermissions {
  canPrepareLocally: boolean;
  canPersist: boolean;
}

/**
 * Distingue la préparation purement locale de la persistance serveur.
 *
 * La préparation reste réservée aux rôles de dépôt et aux cibles dont la
 * politique statique autorise le flux (staging et pilote production autorisé).
 * Le verrou serveur ne peut ouvrir que la persistance : lorsqu'il est fermé ou
 * indisponible, le parsing local reste disponible mais aucun appel RPC ne l'est.
 */
export function resolveDailyV2ImportPermissions(
  hasDepositRole: boolean,
  targetCapabilities: Record<DailyV2Capability, boolean>,
  effectiveCapabilities: Record<DailyV2Capability, boolean>,
): DailyV2ImportPermissions {
  const canPrepareLocally = hasDepositRole && targetCapabilities.deposit;
  return {
    canPrepareLocally,
    canPersist: canPrepareLocally && effectiveCapabilities.deposit,
  };
}
