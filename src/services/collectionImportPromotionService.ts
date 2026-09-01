import {
  COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE,
  currentCollectionImportTargetVerdict,
} from './collectionImportRuntimeTarget';
import type { CollectionReport } from '@/types/banking';
import type {
  CollectionImportReview,
  CollectionPromotionResult,
  SyncResultData,
} from '@/types/processing';
import type { CollectionComparison } from './intelligentSyncService';

// ⭐ PACK-C — Service de promotion contrôlée des lignes validées.
//
// Règles :
//  - Promotion UNIQUEMENT après action utilisateur explicite (bouton dédié).
//  - Promotion UNIQUEMENT des lignes validées (selected === true).
//  - Idempotence : RPC atomique sur (excel_filename, excel_source_row), sans
//    traçabilité artificielle ni écriture partielle.
//  - Le moteur atomique est injectable pour les tests synthétiques ; le moteur
//    par défaut est chargé dynamiquement car le client Supabase est Vite-only.
//  - La garde de décalage autoritative s'exécute dans la même transaction SQL
//    que les écritures. Le helper pur ci-dessous reste un diagnostic testable.

export interface CollectionAtomicPromotionEngine {
  promote(collections: CollectionReport[]): Promise<SyncResultData>;
}

export type CollectionPromotionGate = () => { allowed: boolean };

// ---------------------------------------------------------------------------
// ⭐ DAILY-INGESTION-0C — Garde-fou de décalage des lignes Collection.
//
// Un fichier cumulatif réexporté avec une ligne insérée au milieu (ou un tri
// modifié) décale toutes les excel_source_row suivantes : l'idempotence par
// (excel_filename, excel_source_row) écraserait alors en masse des lignes
// existantes par le contenu d'autres lignes. Le même calcul est appliqué de
// façon autoritative par import_collection_report_atomic_v1 avant toute
// écriture ; cette version pure sert à la review et aux tests de contrat.
//
// Champs d'identité stable : reportDate, clientCode, collectionAmount,
// bankName, factureNo, noChqBd. Les champs enrichissables/volatils (status,
// processingStatus, dateOfValidity, creditedDate, commission, bankCommission,
// matchConfidence, matchMethod, processedAt…) sont exclus : un enrichissement
// légitime ne déclenche jamais le blocage. collectionType est lui aussi exclu
// car mapDbToCollectionReport ne le restitue pas côté base : l'inclure
// produirait une divergence systématique artificielle (faux positifs).
// ---------------------------------------------------------------------------

export const COLLECTION_SHIFT_MIN_DIVERGENT_ROWS = 1;

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

  // Une même clé Excel ne peut pas désigner deux identités métier différentes.
  // Toute divergence exige un futur workflow de correction explicite ; l'import
  // ordinaire échoue fermé, même pour 1 ligne sur un grand fichier.
  const blocked = divergentCount >= COLLECTION_SHIFT_MIN_DIVERGENT_ROWS;

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

async function createDefaultCollectionAtomicPromotionEngine(): Promise<CollectionAtomicPromotionEngine> {
  const { promoteCollectionReportAtomically } = await import('./collectionReportAtomicImportService');
  return {
    promote: collections => promoteCollectionReportAtomically(collections),
  };
}

/**
 * Phase B — "Promouvoir les lignes validées".
 * Seul point d'entrée du flux PACK-C qui déclenche des écritures DB, et
 * uniquement pour les lignes validées. Throw si la promotion n'est pas permise.
 *
 * Le moteur par défaut effectue une unique RPC atomique. Validation, garde de
 * décalage, idempotence, audit et écritures s'exécutent dans la même
 * transaction PostgreSQL. Le helper assessCollectionRowShift reste un
 * diagnostic pur, mais la décision de sécurité autoritative vit côté serveur.
 */
export async function promoteValidatedCollections(
  review: CollectionImportReview,
  engine?: CollectionAtomicPromotionEngine,
  collectionPromotionGate: CollectionPromotionGate = () =>
    currentCollectionImportTargetVerdict('promote')
): Promise<CollectionPromotionResult> {
  if (!collectionPromotionGate().allowed) {
    throw new Error(COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE);
  }

  const gate = assertPromotionAllowed(review);
  if (!gate.allowed) {
    throw new Error(gate.reason ?? 'Promotion non autorisée.');
  }

  const validated = getValidatedCollections(review);
  const atomicEngine = engine ?? (await createDefaultCollectionAtomicPromotionEngine());
  const syncResult = await atomicEngine.promote(validated);

  return {
    promoted: true,
    validatedCount: validated.length,
    syncResult,
  };
}
