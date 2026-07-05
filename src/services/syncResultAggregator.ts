import type {
  PartialSyncResultData,
  SyncCollectionError,
  SyncResultData,
} from '@/types/processing';

// Erreur top-level de BatchProcessingService : aucun rattachement à une
// collection, message conservé tel quel (jamais de données bancaires dedans).
function toAuditedBatchError(message: string): SyncCollectionError {
  const safeMessage =
    typeof message === 'string' && message.trim().length > 0
      ? message.trim()
      : 'Erreur batch inconnue';

  return {
    collection: {},
    error: safeMessage
  };
}

/**
 * Agrégation pure des résultats de synchronisation par batch.
 * Aucun accès DB/Supabase : uniquement des sommes en mémoire.
 * Les résultats absents ou incomplets sont traités comme des zéros.
 */
export function aggregateBatchSyncResults(
  batchResults: ReadonlyArray<PartialSyncResultData | null | undefined>,
  batchLevelErrors: ReadonlyArray<string> = []
): SyncResultData {
  const aggregated: SyncResultData = {
    new_collections: 0,
    idempotent_updates: 0,
    enriched_collections: 0,
    incomplete_not_enriched: 0,
    ignored_collections: 0,
    errors: [],
    summary: {
      total_processed: 0,
      enrichments: {
        date_of_validity_added: 0,
        bank_commissions_added: 0,
        references_updated: 0,
        statuses_updated: 0
      }
    }
  };

  for (const result of batchResults ?? []) {
    if (!result) {
      continue;
    }

    aggregated.new_collections += result.new_collections || 0;
    aggregated.idempotent_updates += result.idempotent_updates || 0;
    aggregated.enriched_collections += result.enriched_collections || 0;
    aggregated.incomplete_not_enriched += result.incomplete_not_enriched || 0;
    aggregated.ignored_collections += result.ignored_collections || 0;

    if (Array.isArray(result.errors)) {
      for (const collectionError of result.errors) {
        if (!collectionError) {
          continue;
        }
        aggregated.errors.push({
          collection: {
            clientCode: collectionError.collection?.clientCode
          },
          error:
            typeof collectionError.error === 'string'
              ? collectionError.error
              : 'Erreur collection inconnue'
        });
      }
    }

    const enrichments = result.summary?.enrichments;
    if (enrichments) {
      aggregated.summary.enrichments.date_of_validity_added += enrichments.date_of_validity_added || 0;
      aggregated.summary.enrichments.bank_commissions_added += enrichments.bank_commissions_added || 0;
      aggregated.summary.enrichments.references_updated += enrichments.references_updated || 0;
      aggregated.summary.enrichments.statuses_updated += enrichments.statuses_updated || 0;
    }
  }

  for (const batchError of batchLevelErrors ?? []) {
    aggregated.errors.push(toAuditedBatchError(batchError));
  }

  aggregated.summary.total_processed =
    aggregated.new_collections +
    aggregated.idempotent_updates +
    aggregated.enriched_collections +
    aggregated.incomplete_not_enriched +
    aggregated.ignored_collections;

  return aggregated;
}

/**
 * Compte les erreurs bloquantes pour le taux UI sans double comptage.
 * fileProcessingService recopie déjà chaque erreur sync dans results.errors :
 * les erreurs sync ne sont donc recomptées que si, par défaut de propagation,
 * elles n'y figurent pas (cas défensif). Aucune erreur n'est masquée.
 */
export function computeBlockingErrorCount(
  globalErrorCount: number,
  excelErrorCount: number,
  syncErrorCount: number
): number {
  const safeGlobal = Math.max(0, globalErrorCount || 0);
  const safeExcel = Math.max(0, excelErrorCount || 0);
  const safeSync = Math.max(0, syncErrorCount || 0);

  const syncErrorsNotInGlobal = Math.max(0, safeSync - safeGlobal);

  return safeGlobal + safeExcel + syncErrorsNotInGlobal;
}
