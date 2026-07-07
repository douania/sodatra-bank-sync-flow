import { aggregateBatchSyncResults } from './syncResultAggregator';
import type { CollectionReport } from '@/types/banking';
import type {
  CollectionImportReview,
  CollectionPromotionResult,
  PartialSyncResultData,
} from '@/types/processing';
import type { CollectionComparison } from './intelligentSyncService';

// ⭐ PACK-C — Service de promotion contrôlée des lignes validées.
//
// Règles :
//  - Promotion UNIQUEMENT après action utilisateur explicite (bouton dédié).
//  - Promotion UNIQUEMENT des lignes validées (selected === true).
//  - Idempotence : déléguée à la mécanique existante d'intelligentSyncService
//    sur (excel_filename, excel_source_row). Aucune traçabilité artificielle.
//  - Le moteur de sync est injectable : les tests synthétiques n'ont jamais
//    besoin de Supabase live. Le moteur par défaut est chargé dynamiquement
//    (le client Supabase ne supporte pas l'import hors Vite).
//  - ⭐ DAILY-INGESTION-0C : garde-fou de décalage massif AVANT toute écriture
//    (voir assessCollectionRowShift ci-dessous).

export interface CollectionSyncEngine {
  analyze(collections: CollectionReport[]): Promise<CollectionComparison[]>;
  sync(comparisons: CollectionComparison[]): Promise<PartialSyncResultData>;
}

// Aligné sur la taille de lot du flux legacy (BatchProcessingService).
const PROMOTION_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// ⭐ DAILY-INGESTION-0C — Garde-fou de décalage massif des lignes Collection.
//
// Un fichier cumulatif réexporté avec une ligne insérée au milieu (ou un tri
// modifié) décale toutes les excel_source_row suivantes : l'idempotence par
// (excel_filename, excel_source_row) écraserait alors en masse des lignes
// existantes par le contenu d'autres lignes. Avant TOUTE écriture, on compare
// donc un fingerprint d'identité stable entre la ligne Excel entrante et la
// ligne déjà en base pour chaque trace existante ; une divergence massive
// bloque la promotion.
//
// Champs d'identité stable : reportDate, clientCode, collectionAmount,
// bankName, factureNo, noChqBd. Les champs enrichissables/volatils (status,
// processingStatus, dateOfValidity, creditedDate, commission, bankCommission,
// matchConfidence, matchMethod, processedAt…) sont exclus : un enrichissement
// légitime ne déclenche jamais le blocage. collectionType est lui aussi exclu
// car mapDbToCollectionReport ne le restitue pas côté base : l'inclure
// produirait une divergence systématique artificielle (faux positifs).
// ---------------------------------------------------------------------------

export const COLLECTION_SHIFT_MIN_DIVERGENT_ROWS = 5;
export const COLLECTION_SHIFT_MAX_DIVERGENT_RATIO = 0.2;

const STABLE_IDENTITY_FIELDS = [
  'reportDate',
  'clientCode',
  'collectionAmount',
  'bankName',
  'factureNo',
  'noChqBd'
] as const;

export interface CollectionShiftAssessment {
  /** Nombre de comparaisons portant une ligne existante en base. */
  comparedExistingCount: number;
  /** Lignes existantes dont l'identité stable diverge de la ligne entrante. */
  divergentCount: number;
  /** True si la promotion doit être bloquée avant toute écriture. */
  blocked: boolean;
}

export function assessCollectionRowShift(
  comparisons: CollectionComparison[]
): CollectionShiftAssessment {
  let comparedExistingCount = 0;
  let divergentCount = 0;

  for (const comparison of comparisons) {
    const existing = comparison.existingRecord;
    if (!existing) {
      continue;
    }
    comparedExistingCount++;
    if (stableIdentityFingerprint(comparison.excelRow) !== stableIdentityFingerprint(existing)) {
      divergentCount++;
    }
  }

  const blocked =
    divergentCount >= COLLECTION_SHIFT_MIN_DIVERGENT_ROWS ||
    (comparedExistingCount > 0 &&
      divergentCount / comparedExistingCount >= COLLECTION_SHIFT_MAX_DIVERGENT_RATIO);

  return { comparedExistingCount, divergentCount, blocked };
}

function stableIdentityFingerprint(row: unknown): string {
  const source = (row ?? {}) as Record<string, unknown>;
  return JSON.stringify(
    STABLE_IDENTITY_FIELDS.map((field) =>
      normalizeFingerprintValue(source[field], field === 'collectionAmount')
    )
  );
}

// Normalisation volontairement symétrique Excel/DB : absent, null et chaîne
// vide partagent une même forme, les montants passent par Number pour que
// "100000" et 100000 ne divergent pas artificiellement.
function normalizeFingerprintValue(value: unknown, isAmount: boolean): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (isAmount) {
    const amount = Number(value);
    return Number.isFinite(amount) ? String(amount) : String(value).trim();
  }
  const text = String(value).trim();
  return text;
}

export function getValidatedCollections(review: CollectionImportReview): CollectionReport[] {
  return review.acceptedRows
    .filter(row => row.selected)
    .map(row => row.collection);
}

export function assertPromotionAllowed(review: CollectionImportReview | null | undefined): {
  allowed: boolean;
  reason?: string;
} {
  if (!review || !review.reviewReady) {
    return {
      allowed: false,
      reason: 'La review n\'est pas prête : analysez d\'abord les fichiers Collection.',
    };
  }
  if (review.acceptedRows.length === 0) {
    return {
      allowed: false,
      reason: 'Aucune ligne acceptée par le parsing : promotion impossible.',
    };
  }
  if (getValidatedCollections(review).length === 0) {
    return {
      allowed: false,
      reason: 'Aucune ligne validée : sélectionnez au moins une ligne avant de promouvoir.',
    };
  }
  return { allowed: true };
}

async function createDefaultCollectionSyncEngine(): Promise<CollectionSyncEngine> {
  const { intelligentSyncService } = await import('./intelligentSyncService');
  return {
    analyze: collections => intelligentSyncService.analyzeExcelFile(collections),
    sync: comparisons => intelligentSyncService.processIntelligentSync(comparisons),
  };
}

/**
 * Phase B — "Promouvoir les lignes validées".
 * Seul point d'entrée du flux PACK-C qui déclenche des écritures DB, et
 * uniquement pour les lignes validées. Throw si la promotion n'est pas permise.
 *
 * ⭐ DAILY-INGESTION-0C : déroulé en trois phases pour que la garde de
 * décalage massif s'exécute AVANT la première écriture :
 *  1. analyser tous les lots validés (lecture seule) ;
 *  2. évaluer la garde de décalage sur l'ensemble des comparaisons ;
 *  3. seulement ensuite, synchroniser lot par lot.
 */
export async function promoteValidatedCollections(
  review: CollectionImportReview,
  engine?: CollectionSyncEngine
): Promise<CollectionPromotionResult> {
  const gate = assertPromotionAllowed(review);
  if (!gate.allowed) {
    throw new Error(gate.reason ?? 'Promotion non autorisée.');
  }

  const validated = getValidatedCollections(review);
  const syncEngine = engine ?? (await createDefaultCollectionSyncEngine());

  const batchResults: PartialSyncResultData[] = [];
  const batchLevelErrors: string[] = [];

  // Phase 1 : analyse de tous les lots (aucune écriture). Un lot dont
  // l'analyse échoue est écarté avec une erreur visible ; les autres continuent.
  const analyzedBatches: Array<{ batchNumber: number; comparisons: CollectionComparison[] }> = [];
  for (let i = 0; i < validated.length; i += PROMOTION_BATCH_SIZE) {
    const batch = validated.slice(i, i + PROMOTION_BATCH_SIZE);
    const batchNumber = Math.floor(i / PROMOTION_BATCH_SIZE) + 1;

    try {
      const comparisons = await syncEngine.analyze(batch);
      analyzedBatches.push({ batchNumber, comparisons });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      batchLevelErrors.push(`Erreur lot ${batchNumber}: ${message}`);
    }
  }

  // Phase 2 : garde de décalage massif AVANT toute écriture DB.
  const shift = assessCollectionRowShift(analyzedBatches.flatMap((entry) => entry.comparisons));
  if (shift.blocked) {
    throw new Error(
      'Promotion bloquée : possible décalage massif des lignes Collection — ' +
        `${shift.divergentCount} ligne(s) existante(s) sur ${shift.comparedExistingCount} comparée(s) ` +
        "divergent sur les champs d'identité stable (seuils : " +
        `${COLLECTION_SHIFT_MIN_DIVERGENT_ROWS} lignes ou ${COLLECTION_SHIFT_MAX_DIVERGENT_RATIO * 100} %). ` +
        "Aucune écriture DB n'a été effectuée. Vérifiez si le fichier réexporté contient une ligne " +
        'insérée ou un ordre modifié, puis relancez la promotion après contrôle.'
    );
  }

  // Phase 3 : synchronisation lot par lot (écritures DB).
  for (const { batchNumber, comparisons } of analyzedBatches) {
    try {
      const result = await syncEngine.sync(comparisons);
      batchResults.push(result);
    } catch (error) {
      // Erreur visible, jamais masquée : reportée dans syncResult.errors
      // via l'agrégateur (les autres lots continuent).
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      batchLevelErrors.push(`Erreur lot ${batchNumber}: ${message}`);
    }
  }

  const syncResult = aggregateBatchSyncResults(batchResults, batchLevelErrors);

  return {
    promoted: true,
    validatedCount: validated.length,
    syncResult,
  };
}
