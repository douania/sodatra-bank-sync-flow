import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateBatchSyncResults } from './syncResultAggregator';
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
  assert.equal(aggregated.ignored_collections, 4);
  assert.equal(aggregated.summary.total_processed, 10);
  assert.deepEqual(aggregated.errors, []);
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

test('total_processed correspond toujours à la somme des quatre compteurs principaux', () => {
  const batches: PartialSyncResultData[] = [
    { new_collections: 5, idempotent_updates: 7, enriched_collections: 2, ignored_collections: 9 },
    { new_collections: 3, ignored_collections: 1 },
    undefined as unknown as PartialSyncResultData
  ];

  const aggregated = aggregateBatchSyncResults(batches, ['Erreur lot 1: échec']);

  assert.equal(
    aggregated.summary.total_processed,
    aggregated.new_collections +
      aggregated.idempotent_updates +
      aggregated.enriched_collections +
      aggregated.ignored_collections
  );
  assert.equal(aggregated.summary.total_processed, 27);
});
