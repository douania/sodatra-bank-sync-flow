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

export interface CollectionSyncEngine {
  analyze(collections: CollectionReport[]): Promise<CollectionComparison[]>;
  sync(comparisons: CollectionComparison[]): Promise<PartialSyncResultData>;
}

// Aligné sur la taille de lot du flux legacy (BatchProcessingService).
const PROMOTION_BATCH_SIZE = 50;

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

  for (let i = 0; i < validated.length; i += PROMOTION_BATCH_SIZE) {
    const batch = validated.slice(i, i + PROMOTION_BATCH_SIZE);
    const batchNumber = Math.floor(i / PROMOTION_BATCH_SIZE) + 1;

    try {
      const comparisons = await syncEngine.analyze(batch);
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
