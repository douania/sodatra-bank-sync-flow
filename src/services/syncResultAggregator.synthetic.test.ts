import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateBatchSyncResults, computeBlockingErrorCount } from './syncResultAggregator';
import type { PartialSyncResultData } from '@/types/processing';

test('agrégation nominale de deux résultats batch', () => {
  const batch1: PartialSyncResultData = {
    new_collections: 2,
    idempotent_updates: 1,
    enriched_collections: 0,
    ignored_collections: 3
  };
  const batch2: PartialSyncResultData = {
    new_collections: 0,
    idempotent_updates: 2,
    enriched_collections: 1,
    ignored_collections: 1
  };

  const aggregated = aggregateBatchSyncResults([batch1, batch2]);

  assert.equal(aggregated.new_collections, 2);
  assert.equal(aggregated.idempotent_updates, 3);
  assert.equal(aggregated.enriched_collections, 1);
  assert.equal(aggregated.incomplete_not_enriched, 0);
  assert.equal(aggregated.ignored_collections, 4);
  assert.equal(aggregated.summary.total_processed, 10);
  assert.deepEqual(aggregated.errors, []);
});

test('enrichissement réellement appliqué : enriched_collections agrégé séparément des incomplètes', () => {
  // Un batch avec enrichissements réels, un batch avec collections incomplètes
  // analysées mais sans aucun champ appliqué en base.
  const batchEnriched: PartialSyncResultData = {
    enriched_collections: 3,
    incomplete_not_enriched: 0
  };
  const batchIncomplete: PartialSyncResultData = {
    enriched_collections: 0,
    incomplete_not_enriched: 2
  };

  const aggregated = aggregateBatchSyncResults([batchEnriched, batchIncomplete]);

  assert.equal(aggregated.enriched_collections, 3);
  assert.equal(aggregated.incomplete_not_enriched, 2);
  assert.equal(aggregated.summary.total_processed, 5);
});

test('EXISTS_INCOMPLETE sans enrichissement réel : compté à part, jamais dans enriched_collections', () => {
  const batch: PartialSyncResultData = {
    new_collections: 1,
    idempotent_updates: 1,
    enriched_collections: 0,
    incomplete_not_enriched: 4,
    ignored_collections: 2
  };

  const aggregated = aggregateBatchSyncResults([batch]);

  assert.equal(aggregated.enriched_collections, 0);
  assert.equal(aggregated.incomplete_not_enriched, 4);
  // Conservation : les incomplètes non enrichies restent dans total_processed.
  assert.equal(aggregated.summary.total_processed, 8);
});

test('absence du compteur incomplete_not_enriched : traité comme zéro sans crash', () => {
  // Résultats produits par une version antérieure du service (compteur absent).
  const legacyBatch: PartialSyncResultData = {
    new_collections: 2,
    enriched_collections: 1
  };

  const aggregated = aggregateBatchSyncResults([legacyBatch, {}, undefined, null]);

  assert.equal(aggregated.incomplete_not_enriched, 0);
  assert.equal(aggregated.enriched_collections, 1);
  assert.equal(aggregated.summary.total_processed, 3);
});

test('computeBlockingErrorCount : pas de double comptage quand les erreurs sync sont déjà dans results.errors', () => {
  // Flux normal : 3 erreurs sync recopiées dans results.errors (global = 3 + 2 autres).
  assert.equal(computeBlockingErrorCount(5, 2, 3), 7);
  // Toutes les erreurs globales sont les erreurs sync : comptées une seule fois.
  assert.equal(computeBlockingErrorCount(3, 0, 3), 3);
});

test('computeBlockingErrorCount : les erreurs sync non propagées restent comptées (aucun masquage)', () => {
  // Cas défensif : results.errors vide alors que des erreurs sync existent.
  assert.equal(computeBlockingErrorCount(0, 0, 3), 3);
  assert.equal(computeBlockingErrorCount(0, 2, 3), 5);
  // Aucune erreur nulle part.
  assert.equal(computeBlockingErrorCount(0, 0, 0), 0);
  // Entrées négatives ou invalides neutralisées.
  assert.equal(computeBlockingErrorCount(-1, Number.NaN, 2), 2);
});

test('agrégation des compteurs d\'enrichissement', () => {
  const batch1: PartialSyncResultData = {
    summary: {
      enrichments: {
        date_of_validity_added: 1,
        bank_commissions_added: 2,
        references_updated: 3,
        statuses_updated: 4
      }
    }
  };
  const batch2: PartialSyncResultData = {
    summary: {
      enrichments: {
        date_of_validity_added: 10,
        bank_commissions_added: 20,
        references_updated: 30,
        statuses_updated: 40
      }
    }
  };

  const aggregated = aggregateBatchSyncResults([batch1, batch2]);

  assert.equal(aggregated.summary.enrichments.date_of_validity_added, 11);
  assert.equal(aggregated.summary.enrichments.bank_commissions_added, 22);
  assert.equal(aggregated.summary.enrichments.references_updated, 33);
  assert.equal(aggregated.summary.enrichments.statuses_updated, 44);
});

test('résultats undefined, null ou incomplets traités comme zéros sans crash', () => {
  const incomplete: PartialSyncResultData = {
    new_collections: 1,
    summary: {}
  };

  const aggregated = aggregateBatchSyncResults([undefined, null, incomplete, {}]);

  assert.equal(aggregated.new_collections, 1);
  assert.equal(aggregated.idempotent_updates, 0);
  assert.equal(aggregated.enriched_collections, 0);
  assert.equal(aggregated.ignored_collections, 0);
  assert.equal(aggregated.summary.total_processed, 1);
  assert.equal(aggregated.summary.enrichments.date_of_validity_added, 0);
  assert.equal(aggregated.summary.enrichments.bank_commissions_added, 0);
  assert.equal(aggregated.summary.enrichments.references_updated, 0);
  assert.equal(aggregated.summary.enrichments.statuses_updated, 0);
  assert.deepEqual(aggregated.errors, []);
});

test('les erreurs collection des résultats batch sont conservées', () => {
  const batch1: PartialSyncResultData = {
    errors: [
      { collection: { clientCode: 'CLI-001' }, error: 'Duplicate key' }
    ]
  };
  const batch2: PartialSyncResultData = {
    errors: [
      { collection: {}, error: 'Champ manquant' },
      { collection: { clientCode: 'CLI-002' }, error: 'Format invalide' }
    ]
  };

  const aggregated = aggregateBatchSyncResults([batch1, batch2]);

  assert.equal(aggregated.errors.length, 3);
  assert.deepEqual(aggregated.errors[0], {
    collection: { clientCode: 'CLI-001' },
    error: 'Duplicate key'
  });
  assert.equal(aggregated.errors[1].collection.clientCode, undefined);
  assert.equal(aggregated.errors[1].error, 'Champ manquant');
  assert.deepEqual(aggregated.errors[2], {
    collection: { clientCode: 'CLI-002' },
    error: 'Format invalide'
  });
});

test('les erreurs top-level batch sont transformées en erreurs auditées sans référence collection', () => {
  const aggregated = aggregateBatchSyncResults(
    [{ new_collections: 1 }],
    ['Erreur lot 2: timeout réseau', '   ', 'Erreur lot 5: connexion perdue']
  );

  assert.equal(aggregated.errors.length, 3);

  for (const auditedError of aggregated.errors) {
    assert.deepEqual(auditedError.collection, {});
    assert.equal(typeof auditedError.error, 'string');
    assert.ok(auditedError.error.length > 0);
  }

  assert.equal(aggregated.errors[0].error, 'Erreur lot 2: timeout réseau');
  assert.equal(aggregated.errors[1].error, 'Erreur batch inconnue');
  assert.equal(aggregated.errors[2].error, 'Erreur lot 5: connexion perdue');

  // Les erreurs top-level n'altèrent pas les compteurs.
  assert.equal(aggregated.new_collections, 1);
  assert.equal(aggregated.summary.total_processed, 1);
});

test('total_processed correspond toujours à la somme des cinq compteurs principaux', () => {
  const batches: PartialSyncResultData[] = [
    { new_collections: 5, idempotent_updates: 7, enriched_collections: 2, ignored_collections: 9 },
    { new_collections: 3, incomplete_not_enriched: 4, ignored_collections: 1 },
    undefined as unknown as PartialSyncResultData
  ];

  const aggregated = aggregateBatchSyncResults(batches, ['Erreur lot 1: échec']);

  assert.equal(
    aggregated.summary.total_processed,
    aggregated.new_collections +
      aggregated.idempotent_updates +
      aggregated.enriched_collections +
      aggregated.incomplete_not_enriched +
      aggregated.ignored_collections
  );
  assert.equal(aggregated.summary.total_processed, 31);
});
