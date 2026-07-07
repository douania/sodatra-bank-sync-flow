import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPromotionAllowed,
  assessCollectionRowShift,
  getValidatedCollections,
  promoteValidatedCollections,
  COLLECTION_SHIFT_MIN_DIVERGENT_ROWS,
  type CollectionSyncEngine,
} from './collectionImportPromotionService';
import { buildCollectionRowId } from './collectionImportReviewService';
import type { CollectionReport } from '@/types/banking';
import type { CollectionImportReview, CollectionReviewRow } from '@/types/processing';
import type { CollectionComparison } from './intelligentSyncService';

// ⭐ PACK-C — Tests synthétiques de la promotion contrôlée.
// Aucune donnée bancaire réelle, aucun accès Supabase : le moteur de sync est
// une simulation en mémoire qui reproduit la sémantique d'idempotence existante
// SELECT-then-INSERT/UPDATE sur la clé (excel_filename, excel_source_row).

function syntheticCollection(sourceRow: number, overrides: Partial<CollectionReport> = {}): CollectionReport {
  return {
    reportDate: '2026-06-05',
    clientCode: `CLIENT_SYN_${sourceRow}`,
    collectionAmount: 100000 + sourceRow,
    bankName: 'BANQUE_SYNTHETIQUE_1',
    status: 'pending',
    excelFilename: 'COLLECTION_REPORT_SYNTHETIC.xlsx',
    excelSourceRow: sourceRow,
    ...overrides,
  };
}

function syntheticReview(
  rows: Array<{ sourceRow: number; selected: boolean }>,
  overrides: Partial<CollectionImportReview> = {}
): CollectionImportReview {
  const acceptedRows: CollectionReviewRow[] = rows.map(({ sourceRow, selected }) => {
    const collection = syntheticCollection(sourceRow);
    return {
      rowId: buildCollectionRowId(collection.excelFilename!, collection.excelSourceRow!),
      collection,
      selected,
    };
  });

  return {
    reviewReady: true,
    files: ['COLLECTION_REPORT_SYNTHETIC.xlsx'],
    acceptedRows,
    rejectedRows: [],
    fileLevelErrors: [],
    warnings: [],
    counters: {
      files_processed: 1,
      accepted_rows: acceptedRows.length,
      rejected_rows: 0,
      file_level_rejections: 0,
      warnings: 0,
    },
    preparedAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

function createFakeSyncEngine(options: { failOnSyncCall?: number } = {}) {
  // "Base" synthétique en mémoire, indexée sur la clé d'idempotence existante.
  const store = new Map<string, CollectionReport>();
  const calls = { analyze: 0, sync: 0 };

  const engine: CollectionSyncEngine = {
    async analyze(collections) {
      calls.analyze++;
      return collections.map(collection => ({
        excelRow: collection,
        status: 'NEW',
        missingFields: [],
        enrichmentOpportunities: [],
        collectionKey: buildCollectionRowId(collection.excelFilename!, collection.excelSourceRow!),
      })) as unknown as CollectionComparison[];
    },
    async sync(comparisons) {
      calls.sync++;
      if (options.failOnSyncCall === calls.sync) {
        throw new Error('timeout synthétique du lot');
      }

      let new_collections = 0;
      let idempotent_updates = 0;
      for (const comparison of comparisons) {
        const collection = comparison.excelRow as CollectionReport;
        const key = buildCollectionRowId(collection.excelFilename!, collection.excelSourceRow!);
        // Sémantique upsertNewCollection : SELECT par traçabilité puis
        // UPDATE idempotent si trouvé, INSERT sinon. Jamais de doublon.
        if (store.has(key)) {
          store.set(key, collection);
          idempotent_updates++;
        } else {
          store.set(key, collection);
          new_collections++;
        }
      }

      return {
        new_collections,
        idempotent_updates,
        enriched_collections: 0,
        incomplete_not_enriched: 0,
        ignored_collections: 0,
        errors: [],
      };
    },
  };

  return { engine, store, calls };
}

// --- Cas 5 : promotion sans validation impossible ----------------------------

test('promotion sans review prête : refusée, aucun appel au moteur de sync', async () => {
  const { engine, store, calls } = createFakeSyncEngine();

  assert.equal(assertPromotionAllowed(null).allowed, false);
  assert.equal(assertPromotionAllowed(undefined).allowed, false);

  const notReady = syntheticReview([{ sourceRow: 2, selected: true }], { reviewReady: false });
  assert.equal(assertPromotionAllowed(notReady).allowed, false);
  await assert.rejects(promoteValidatedCollections(notReady, engine), /review n'est pas prête/i);

  assert.equal(calls.analyze, 0);
  assert.equal(calls.sync, 0);
  assert.equal(store.size, 0);
});

test('promotion avec zéro ligne validée : refusée, aucune écriture', async () => {
  const { engine, store, calls } = createFakeSyncEngine();
  const review = syntheticReview([
    { sourceRow: 2, selected: false },
    { sourceRow: 3, selected: false },
  ]);

  const gate = assertPromotionAllowed(review);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason ?? '', /Aucune ligne validée/);

  await assert.rejects(promoteValidatedCollections(review, engine), /Aucune ligne validée/);
  assert.equal(calls.analyze, 0);
  assert.equal(calls.sync, 0);
  assert.equal(store.size, 0);
});

test('promotion avec zéro ligne acceptée (fichier entièrement rejeté) : refusée', async () => {
  const { engine, calls } = createFakeSyncEngine();
  const review = syntheticReview([], {
    fileLevelErrors: [
      { file: 'COLLECTION_REPORT_SYNTHETIC.xlsx', message: 'Headers obligatoires manquants: BANK NAME.' },
    ],
  });

  const gate = assertPromotionAllowed(review);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason ?? '', /Aucune ligne acceptée/);

  await assert.rejects(promoteValidatedCollections(review, engine));
  assert.equal(calls.sync, 0);
});

// --- Cas 6 : promotion des lignes validées uniquement ------------------------

test('promotion des lignes validées uniquement : les lignes non cochées ne sont jamais écrites', async () => {
  const { engine, store, calls } = createFakeSyncEngine();
  const review = syntheticReview([
    { sourceRow: 2, selected: true },
    { sourceRow: 3, selected: false },
    { sourceRow: 4, selected: true },
  ]);

  const validated = getValidatedCollections(review);
  assert.equal(validated.length, 2);
  assert.deepEqual(validated.map(c => c.excelSourceRow), [2, 4]);

  const promotion = await promoteValidatedCollections(review, engine);

  assert.equal(promotion.promoted, true);
  assert.equal(promotion.validatedCount, 2);
  assert.equal(promotion.syncResult.new_collections, 2);
  assert.equal(promotion.syncResult.summary.total_processed, 2);
  assert.equal(calls.analyze, 1);
  assert.equal(calls.sync, 1);

  assert.equal(store.size, 2);
  assert.equal(store.has(buildCollectionRowId('COLLECTION_REPORT_SYNTHETIC.xlsx', 2)), true);
  assert.equal(store.has(buildCollectionRowId('COLLECTION_REPORT_SYNTHETIC.xlsx', 3)), false);
  assert.equal(store.has(buildCollectionRowId('COLLECTION_REPORT_SYNTHETIC.xlsx', 4)), true);
});

// --- Cas 7 : réimport même fichier/ligne → idempotent, pas de doublon --------

test('réimport du même fichier/ligne : update idempotent via (excel_filename, excel_source_row), aucun doublon', async () => {
  const { engine, store } = createFakeSyncEngine();
  const review = syntheticReview([
    { sourceRow: 2, selected: true },
    { sourceRow: 3, selected: true },
  ]);

  const firstRun = await promoteValidatedCollections(review, engine);
  assert.equal(firstRun.syncResult.new_collections, 2);
  assert.equal(firstRun.syncResult.idempotent_updates, 0);
  assert.equal(store.size, 2);

  const secondRun = await promoteValidatedCollections(review, engine);
  assert.equal(secondRun.syncResult.new_collections, 0);
  assert.equal(secondRun.syncResult.idempotent_updates, 2);
  // Pas de doublon : la "base" synthétique contient toujours exactement 2 lignes.
  assert.equal(store.size, 2);
});

// --- Cas 8 : erreurs sync visibles, jamais masquées --------------------------

test('échec d\'un lot : erreur visible dans syncResult.errors, les autres lots continuent', async () => {
  // 120 lignes validées → 3 lots de 50/50/20 ; le lot 2 échoue.
  const { engine, store, calls } = createFakeSyncEngine({ failOnSyncCall: 2 });
  const rows = Array.from({ length: 120 }, (_, index) => ({
    sourceRow: index + 2,
    selected: true,
  }));
  const review = syntheticReview(rows);

  const promotion = await promoteValidatedCollections(review, engine);

  assert.equal(promotion.promoted, true);
  assert.equal(promotion.validatedCount, 120);
  assert.equal(calls.sync, 3);

  // Lots 1 et 3 écrits (50 + 20), lot 2 en erreur visible.
  assert.equal(store.size, 70);
  assert.equal(promotion.syncResult.new_collections, 70);
  assert.equal(promotion.syncResult.errors.length, 1);
  assert.match(promotion.syncResult.errors[0].error, /Erreur lot 2/);
  assert.match(promotion.syncResult.errors[0].error, /timeout synthétique/);
});

test('les erreurs collection remontées par le moteur restent visibles après agrégation', async () => {
  const failingEngine: CollectionSyncEngine = {
    async analyze(collections) {
      return collections.map(collection => ({
        excelRow: collection,
        status: 'NEW',
        missingFields: [],
        enrichmentOpportunities: [],
        collectionKey: 'SYN',
      })) as unknown as CollectionComparison[];
    },
    async sync() {
      return {
        new_collections: 1,
        idempotent_updates: 0,
        enriched_collections: 0,
        incomplete_not_enriched: 0,
        ignored_collections: 0,
        errors: [
          { collection: { clientCode: 'CLIENT_SYN_2' }, error: 'Erreur insertion synthétique' },
        ],
      };
    },
  };

  const review = syntheticReview([
    { sourceRow: 2, selected: true },
    { sourceRow: 3, selected: true },
  ]);

  const promotion = await promoteValidatedCollections(review, failingEngine);

  assert.equal(promotion.syncResult.errors.length, 1);
  assert.equal(promotion.syncResult.errors[0].collection.clientCode, 'CLIENT_SYN_2');
  assert.equal(promotion.syncResult.errors[0].error, 'Erreur insertion synthétique');
});

// ---------------------------------------------------------------------------
// ⭐ DAILY-INGESTION-0C — garde-fou de décalage massif des lignes Collection
// ---------------------------------------------------------------------------

// Moteur simulé avec une "base" préexistante : analyze restitue existingRecord
// pour chaque trace Excel déjà connue, comme le fait intelligentSyncService.
function createFakeSyncEngineWithExistingBase(existingRecords: CollectionReport[]) {
  const store = new Map<string, CollectionReport>();
  for (const record of existingRecords) {
    store.set(buildCollectionRowId(record.excelFilename!, record.excelSourceRow!), record);
  }
  const calls = { analyze: 0, sync: 0 };

  const engine: CollectionSyncEngine = {
    async analyze(collections) {
      calls.analyze++;
      return collections.map(collection => {
        const key = buildCollectionRowId(collection.excelFilename!, collection.excelSourceRow!);
        const existing = store.get(key);
        return {
          excelRow: collection,
          existingRecord: existing,
          status: existing ? 'EXISTS_COMPLETE' : 'NEW',
          missingFields: [],
          enrichmentOpportunities: [],
          collectionKey: key,
        };
      }) as unknown as CollectionComparison[];
    },
    async sync(comparisons) {
      calls.sync++;
      let new_collections = 0;
      let idempotent_updates = 0;
      for (const comparison of comparisons) {
        const collection = comparison.excelRow as CollectionReport;
        const key = buildCollectionRowId(collection.excelFilename!, collection.excelSourceRow!);
        if (store.has(key)) {
          store.set(key, collection);
          idempotent_updates++;
        } else {
          store.set(key, collection);
          new_collections++;
        }
      }
      return {
        new_collections,
        idempotent_updates,
        enriched_collections: 0,
        incomplete_not_enriched: 0,
        ignored_collections: 0,
        errors: [],
      };
    },
  };

  return { engine, store, calls };
}

test('0C décalage massif : insertion au milieu simulée -> promotion bloquée, sync jamais appelé', async () => {
  // Base existante : lignes 1..10 telles qu'importées initialement.
  // Fichier réexporté : une ligne insérée au milieu a décalé toutes les
  // lignes -> à chaque excel_source_row N correspond désormais le contenu de
  // l'ancienne ligne N-1 (identité stable différente sur chaque trace).
  const existing = Array.from({ length: 10 }, (_, index) => syntheticCollection(index + 1));
  const review = syntheticReview(
    Array.from({ length: 10 }, (_, index) => ({ sourceRow: index + 1, selected: true }))
  );
  review.acceptedRows = review.acceptedRows.map((row, index) => ({
    ...row,
    collection: {
      ...syntheticCollection(index), // contenu de la ligne précédente
      excelSourceRow: index + 1,     // ...sous la trace de la ligne courante
      excelFilename: 'COLLECTION_REPORT_SYNTHETIC.xlsx',
    },
  }));

  const { engine, store, calls } = createFakeSyncEngineWithExistingBase(existing);
  const snapshot = new Map(store);

  await assert.rejects(
    promoteValidatedCollections(review, engine),
    /Promotion bloquée : possible décalage massif des lignes Collection/
  );

  assert.equal(calls.sync, 0, 'sync must never run when the shift guard fires');
  assert.deepEqual([...store.entries()], [...snapshot.entries()], 'no write may occur');
});

test('0C décalage : réimport strictement identique -> aucune fausse alerte, idempotence préservée', async () => {
  const existing = Array.from({ length: 10 }, (_, index) => syntheticCollection(index + 1));
  const review = syntheticReview(
    Array.from({ length: 10 }, (_, index) => ({ sourceRow: index + 1, selected: true }))
  );

  const { engine, calls } = createFakeSyncEngineWithExistingBase(existing);
  const promotion = await promoteValidatedCollections(review, engine);

  assert.equal(calls.sync, 1);
  assert.equal(promotion.syncResult.idempotent_updates, 10);
  assert.equal(promotion.syncResult.errors.length, 0);
});

test('0C décalage : des enrichissements non identitaires ne déclenchent jamais le blocage', async () => {
  // Les lignes existantes ne diffèrent que sur des champs volatils/enrichissables.
  const existing = Array.from({ length: 10 }, (_, index) => ({
    ...syntheticCollection(index + 1),
    status: 'processed' as const,
    processingStatus: 'FULLY_PROCESSED',
    dateOfValidity: '2026-06-20',
    creditedDate: '2026-06-21',
    commission: 1234,
    bankCommission: 567,
    matchConfidence: 0.99,
    matchMethod: 'SYNTHETIC_MATCH',
    processedAt: '2026-06-21T10:00:00.000Z',
  }));
  const review = syntheticReview(
    Array.from({ length: 10 }, (_, index) => ({ sourceRow: index + 1, selected: true }))
  );

  const { engine, calls } = createFakeSyncEngineWithExistingBase(existing);
  const promotion = await promoteValidatedCollections(review, engine);

  assert.equal(calls.sync, 1);
  assert.equal(promotion.syncResult.errors.length, 0);
});

// --- Tests unitaires du calcul de décalage -----------------------------------

function shiftComparison(
  excelRow: Partial<CollectionReport>,
  existingRecord?: Partial<CollectionReport>
): CollectionComparison {
  return {
    excelRow,
    existingRecord,
    status: existingRecord ? 'EXISTS_COMPLETE' : 'NEW',
    missingFields: [],
    enrichmentOpportunities: [],
    collectionKey: 'synthetic-key',
  } as unknown as CollectionComparison;
}

function identityRow(seed: number): Partial<CollectionReport> {
  return {
    reportDate: '2026-06-05',
    clientCode: `CLIENT_SYN_${seed}`,
    collectionAmount: 100000 + seed,
    bankName: 'BANQUE_SYNTHETIQUE_1',
    factureNo: `FA-${seed}`,
    noChqBd: `CHQ-${seed}`,
  };
}

test('0C assessCollectionRowShift : seuil absolu (5 lignes) et seuil relatif (20 %)', () => {
  const identical = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) =>
      shiftComparison(identityRow(offset + index), identityRow(offset + index))
    );
  const divergent = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) =>
      shiftComparison(identityRow(offset + index), identityRow(offset + index + 1000))
    );

  // 4 divergentes sur 30 (13 %) : sous les deux seuils -> pas de blocage.
  const belowBoth = assessCollectionRowShift([...identical(26), ...divergent(4, 100)]);
  assert.equal(belowBoth.comparedExistingCount, 30);
  assert.equal(belowBoth.divergentCount, 4);
  assert.equal(belowBoth.blocked, false);

  // 5 divergentes sur 30 (17 %) : seuil absolu atteint -> blocage.
  const absolute = assessCollectionRowShift([...identical(25), ...divergent(5, 100)]);
  assert.equal(absolute.divergentCount, COLLECTION_SHIFT_MIN_DIVERGENT_ROWS);
  assert.equal(absolute.blocked, true);

  // 2 divergentes sur 10 (20 %) : seuil relatif atteint -> blocage.
  const relative = assessCollectionRowShift([...identical(8), ...divergent(2, 100)]);
  assert.equal(relative.blocked, true);

  // 1 divergente sur 10 (10 %) : sous les deux seuils -> pas de blocage.
  const single = assessCollectionRowShift([...identical(9), ...divergent(1, 100)]);
  assert.equal(single.blocked, false);

  // Aucune ligne existante comparée : rien à bloquer.
  const onlyNew = assessCollectionRowShift([shiftComparison(identityRow(1))]);
  assert.equal(onlyNew.comparedExistingCount, 0);
  assert.equal(onlyNew.blocked, false);
});
