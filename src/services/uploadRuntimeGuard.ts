/**
 * Garde CLIENT du flux global d'import (/upload) : production en lecture seule.
 *
 * Cette garde est une barrière d'interface, JAMAIS une barrière de sécurité :
 * la sécurité réelle reste Auth + rôles + RLS + grants côté serveur (audit
 * production séparé). Elle réutilise la résolution canonique des deux cibles
 * de Daily v2 (src/features/daily-v2/dailyV2RuntimeTarget.ts), mais conserve
 * sa propre politique : seul le staging peut muter. L'ouverture bornée du
 * pilote Daily v2 ne doit jamais ouvrir implicitement `/upload`.
 *
 * Capacités du flux d'import global, alignées sur la table canonique :
 *   - « deposit » : sélection et traitement de fichiers (processFiles) ;
 *   - « promote » : promotion Collection (promoteValidatedCollections).
 * Aucune capacité n'a de valeur par défaut : chaque appelant la déclare.
 *
 * Verdicts :
 *   - staging autorisé : mutations permises, comportement inchangé ;
 *   - production : refus ;
 *   - cible inconnue, URL invalide, contradiction URL/projet, environnement
 *     illisible : refus fail-closed de toute mutation.
 */
import {
  DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
  currentDailyV2RuntimeTargetVerdict,
  validateDailyV2RuntimeTarget,
  type DailyV2RuntimeTargetInput,
  type DailyV2RuntimeTargetVerdict,
} from '@/features/daily-v2/dailyV2RuntimeTarget';

export const UPLOAD_READ_ONLY_TARGET_MESSAGE =
  "Production en lecture seule : l'import, le traitement et la promotion de fichiers sont désactivés sur cette cible.";

/** Sous-ensemble mutation de la politique canonique — jamais « read »/« admin ». */
export type UploadMutationCapability = 'deposit' | 'promote';

/** Pure et testable : chaque mutation d'import déclare sa capacité exacte. */
export function validateUploadMutationTarget(
  input: DailyV2RuntimeTargetInput,
  capability: UploadMutationCapability,
): DailyV2RuntimeTargetVerdict {
  if (capability !== 'deposit' && capability !== 'promote') {
    return { allowed: false, reason: UPLOAD_READ_ONLY_TARGET_MESSAGE };
  }

  const targetVerdict = validateDailyV2RuntimeTarget(input, 'read');
  if (!targetVerdict.allowed) return targetVerdict;
  if (targetVerdict.projectRef !== DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF) {
    return { allowed: false, reason: UPLOAD_READ_ONLY_TARGET_MESSAGE };
  }
  return targetVerdict;
}

/**
 * Verdict sur la cible courante. Hors runtime Vite (import.meta.env absent),
 * la lecture de l'environnement lève : le refus reste fail-closed.
 */
export function currentUploadMutationVerdict(
  capability: UploadMutationCapability,
): DailyV2RuntimeTargetVerdict {
  try {
    if (capability !== 'deposit' && capability !== 'promote') {
      return { allowed: false, reason: UPLOAD_READ_ONLY_TARGET_MESSAGE };
    }
    const targetVerdict = currentDailyV2RuntimeTargetVerdict('read');
    if (!targetVerdict.allowed) return targetVerdict;
    if (targetVerdict.projectRef !== DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF) {
      return { allowed: false, reason: UPLOAD_READ_ONLY_TARGET_MESSAGE };
    }
    return targetVerdict;
  } catch {
    return { allowed: false, reason: UPLOAD_READ_ONLY_TARGET_MESSAGE };
  }
}

/** Garde d'interface : true uniquement si la cible courante autorise la capacité. */
export function isUploadMutationAllowed(capability: UploadMutationCapability): boolean {
  return currentUploadMutationVerdict(capability).allowed;
}

/**
 * Signature minimale d'une garde de mutation injectable. Même pattern que le
 * moteur de sync injectable de la promotion : les tests synthétiques injectent
 * une garde explicite, le défaut reste la garde canonique fail-closed.
 */
export type UploadMutationGate = () => { allowed: boolean };

/**
 * PACK 0 — isolation des surfaces d'écriture Collection legacy.
 *
 * Les composants historiques de `/reconciliation` (synchronisation Excel
 * directe et marquage manuel effet/chèque) écrivaient dans `collection_report`
 * sans passer par le contrat atomique de `/upload`. Décision CTO D-COL-1 /
 * Pack 0 : ces actions sont neutralisées **sur toutes les cibles**, y compris
 * staging, sans dépendre de la cible ni du verrou serveur. Cette garde est une
 * barrière d'interface : elle ne révoque aucun accès serveur (Auth, rôles,
 * RLS, grants), qui restent à fermer côté serveur avant l'activation du
 * nouveau contrat Collections.
 */
export type LegacyCollectionMutationAction = 'legacy_sync' | 'legacy_mark_processed';

export const LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE =
  "Écritures Collection legacy isolées (Pack 0) : la synchronisation directe et le marquage manuel sont désactivés sur toutes les cibles. Seule la consultation reste disponible ; le chemin d'écriture autorisé est la promotion atomique de /upload.";

export interface LegacyCollectionMutationVerdict {
  allowed: false;
  action: LegacyCollectionMutationAction;
  reason: string;
}

/**
 * Pure et testable : quelle que soit la cible (staging, production, inconnue)
 * et quelle que soit l'action, le verdict est un refus. La cible est acceptée
 * en paramètre uniquement pour rendre l'invariance vérifiable.
 */
export function validateLegacyCollectionMutationTarget(
  _input: DailyV2RuntimeTargetInput,
  action: LegacyCollectionMutationAction,
): LegacyCollectionMutationVerdict {
  return {
    allowed: false,
    action: action === 'legacy_mark_processed' ? 'legacy_mark_processed' : 'legacy_sync',
    reason: LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE,
  };
}

/** Verdict sur la cible courante : refus fail-closed, jamais de levée. */
export function currentLegacyCollectionMutationVerdict(
  action: LegacyCollectionMutationAction,
): LegacyCollectionMutationVerdict {
  return validateLegacyCollectionMutationTarget({}, action);
}

/**
 * Garde d'appel : lève avant tout accès service. Utilisée par les handlers
 * legacy neutralisés afin qu'un déclenchement résiduel (bouton, raccourci,
 * appel programmatique) reste sans effet.
 */
export function assertLegacyCollectionMutationAllowed(
  action: LegacyCollectionMutationAction,
): never {
  throw new Error(currentLegacyCollectionMutationVerdict(action).reason);
}

export type LegacyCollectionMutationOutcome<T> =
  | { outcome: 'refused'; action: LegacyCollectionMutationAction; reason: string }
  | { outcome: 'executed'; action: LegacyCollectionMutationAction; result: T };

/**
 * Seul point d'exécution subsistant pour une mutation Collection legacy
 * (synchronisation Excel directe, marquage manuel effet/chèque). Le verdict
 * est évalué AVANT tout appel au service injecté ; comme il refuse sur toutes
 * les cibles, `run` n'est jamais invoqué. Les composants `/reconciliation`
 * n'exposent plus aucun déclencheur ; cette fonction fige le contrat pour les
 * tests et pour tout appel programmatique résiduel.
 */
export async function executeLegacyCollectionMutation<T>(
  action: LegacyCollectionMutationAction,
  run: () => Promise<T>,
): Promise<LegacyCollectionMutationOutcome<T>> {
  const verdict = currentLegacyCollectionMutationVerdict(action);
  if (!verdict.allowed) {
    return { outcome: 'refused', action: verdict.action, reason: verdict.reason };
  }
  return { outcome: 'executed', action, result: await run() };
}
