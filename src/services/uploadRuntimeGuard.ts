/**
 * Garde CLIENT du flux global d'import (/upload) : production en lecture seule.
 *
 * Cette garde est une barrière d'interface, JAMAIS une barrière de sécurité :
 * la sécurité réelle reste Auth + rôles + RLS + grants côté serveur (audit
 * production séparé). Elle réutilise la politique canonique cible × capacité
 * de Daily v2 (src/features/daily-v2/dailyV2RuntimeTarget.ts) — production :
 * read uniquement — sans créer de seconde logique d'environnement.
 *
 * Toute mutation du flux d'import global (traitement de fichiers, promotion
 * Collection) exige la capacité canonique « deposit » sur la cible courante :
 *   - staging autorisé : mutations permises, comportement inchangé ;
 *   - production : refus ;
 *   - cible inconnue, URL invalide, contradiction URL/projet, environnement
 *     illisible : refus fail-closed de toute mutation.
 */
import {
  currentDailyV2RuntimeTargetVerdict,
  validateDailyV2RuntimeTarget,
  type DailyV2RuntimeTargetInput,
  type DailyV2RuntimeTargetVerdict,
} from '@/features/daily-v2/dailyV2RuntimeTarget';

export const UPLOAD_READ_ONLY_TARGET_MESSAGE =
  "Production en lecture seule : l'import, le traitement et la promotion de fichiers sont désactivés sur cette cible.";

/** Pure et testable : la mutation d'import exige la capacité « deposit ». */
export function validateUploadMutationTarget(
  input: DailyV2RuntimeTargetInput,
): DailyV2RuntimeTargetVerdict {
  return validateDailyV2RuntimeTarget(input, 'deposit');
}

/**
 * Verdict sur la cible courante. Hors runtime Vite (import.meta.env absent),
 * la lecture de l'environnement lève : le refus reste fail-closed.
 */
export function currentUploadMutationVerdict(): DailyV2RuntimeTargetVerdict {
  try {
    return currentDailyV2RuntimeTargetVerdict('deposit');
  } catch {
    return { allowed: false, reason: UPLOAD_READ_ONLY_TARGET_MESSAGE };
  }
}

/** Garde d'interface : true uniquement si la cible courante autorise la mutation. */
export function isUploadMutationAllowed(): boolean {
  return currentUploadMutationVerdict().allowed;
}

/**
 * Signature minimale d'une garde de mutation injectable. Même pattern que le
 * moteur de sync injectable de la promotion : les tests synthétiques injectent
 * une garde explicite, le défaut reste la garde canonique fail-closed.
 */
export type UploadMutationGate = () => { allowed: boolean };
