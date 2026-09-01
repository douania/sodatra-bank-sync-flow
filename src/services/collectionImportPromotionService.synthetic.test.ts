import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertPromotionAllowed,
  assessCollectionRowShift,
  getValidatedCollections,
  promoteValidatedCollections,
  COLLECTION_SHIFT_MIN_DIVERGENT_ROWS,
  type CollectionAtomicPromotionEngine,
} from './collectionImportPromotionService';
import { createCollectionImportCommandKey } from './collectionImportCommandKey';
import { buildCollectionRowId } from './collectionImportReviewService';
import type { CollectionReport } from '@/types/banking';
import type {
  CollectionImportReview,
  CollectionReviewRow,
  SyncResultData,
} from '@/types/processing';
import type { CollectionComparison } from './intelligentSyncService';

const allowPromotionGate = () => ({ allowed: true });

function syntheticCollection(
  sourceRow: number,
  overrides: Partial<CollectionReport> = {},
): CollectionReport {
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
  overrides: Partial<CollectionImportReview> = {},
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
    preparedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function syncResult(newRows: number, updatedRows: number): SyncResultData {
  return {
    new_collections: newRows,
    idempotent_updates: updatedRows,
    enriched_collections: 0,
    incomplete_not_enriched: 0,
    ignored_collections: 0,
    errors: [],
    summary: {
      total_processed: newRows + updatedRows,
      enrichments: {
        date_of_validity_added: 0,
        bank_commissions_added: 0,
        references_updated: 0,
        statuses_updated: 0,
      },
    },
  };
}

function createFakeAtomicEngine(options: { fail?: boolean } = {}) {
  const store = new Map<string, CollectionReport>();
  const calls = { promote: 0 };
  const engine: CollectionAtomicPromotionEngine = {
    async promote(collections) {
      calls.promote++;
      const next = new Map(store);
      let inserted = 0;
      let updated = 0;
      for (const collection of collections) {
        const key = buildCollectionRowId(collection.excelFilename!, collection.excelSourceRow!);
        if (next.has(key)) updated++;
        else inserted++;
        next.set(key, collection);
      }
      if (options.fail) throw new Error('transaction synthétique annulée');
      store.clear();
      for (const [key, value] of next) store.set(key, value);
      return syncResult(inserted, updated);
    },
  };
  return { engine, store, calls };
}

test('promotion sans review prête : refusée avant la RPC atomique', async () => {
  const { engine, store, calls } = createFakeAtomicEngine();
  const review = syntheticReview([{ sourceRow: 2, selected: true }], { reviewReady: false });
  await assert.rejects(
    promoteValidatedCollections(review, engine, allowPromotionGate),
    /review n'est pas prête/i,
  );
  assert.equal(calls.promote, 0);
  assert.equal(store.size, 0);
});

test('zéro ligne acceptée ou sélectionnée : promotion refusée', async () => {
  const { engine, calls } = createFakeAtomicEngine();
  const empty = syntheticReview([]);
  const unselected = syntheticReview([{ sourceRow: 2, selected: false }]);
  assert.equal(assertPromotionAllowed(empty).allowed, false);
  assert.equal(assertPromotionAllowed(unselected).allowed, false);
  await assert.rejects(promoteValidatedCollections(empty, engine, allowPromotionGate));
  await assert.rejects(promoteValidatedCollections(unselected, engine, allowPromotionGate));
  assert.equal(calls.promote, 0);
});

test('une seule RPC reçoit exclusivement les lignes explicitement sélectionnées', async () => {
  const { engine, store, calls } = createFakeAtomicEngine();
  const review = syntheticReview([
    { sourceRow: 2, selected: true },
    { sourceRow: 3, selected: false },
    { sourceRow: 4, selected: true },
  ]);
  assert.deepEqual(getValidatedCollections(review).map(row => row.excelSourceRow), [2, 4]);
  const promotion = await promoteValidatedCollections(review, engine, allowPromotionGate);
  assert.equal(calls.promote, 1);
  assert.equal(promotion.promoted, true);
  assert.equal(promotion.validatedCount, 2);
  assert.equal(promotion.syncResult.new_collections, 2);
  assert.equal(store.size, 2);
  assert.equal(store.has(buildCollectionRowId('COLLECTION_REPORT_SYNTHETIC.xlsx', 3)), false);
});

test('rejeu de la même traçabilité reste idempotent sans doublon', async () => {
  const { engine, store } = createFakeAtomicEngine();
  const review = syntheticReview([
    { sourceRow: 2, selected: true },
    { sourceRow: 3, selected: true },
  ]);
  const first = await promoteValidatedCollections(review, engine, allowPromotionGate);
  const second = await promoteValidatedCollections(review, engine, allowPromotionGate);
  assert.equal(first.syncResult.new_collections, 2);
  assert.equal(second.syncResult.idempotent_updates, 2);
  assert.equal(store.size, 2);
});

test('échec de la RPC atomique : aucune ligne du lot n’est conservée', async () => {
  const { engine, store, calls } = createFakeAtomicEngine({ fail: true });
  const review = syntheticReview(
    Array.from({ length: 120 }, (_, index) => ({ sourceRow: index + 2, selected: true })),
  );
  await assert.rejects(
    promoteValidatedCollections(review, engine, allowPromotionGate),
    /transaction synthétique annulée/,
  );
  assert.equal(calls.promote, 1);
  assert.equal(store.size, 0);
});

test('clé de commande : même payload = même UUID, payload différent = UUID différent', async () => {
  const first = await createCollectionImportCommandKey([{ trace: 'A', amount: 100 }]);
  const replay = await createCollectionImportCommandKey([{ trace: 'A', amount: 100 }]);
  const changed = await createCollectionImportCommandKey([{ trace: 'A', amount: 101 }]);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(replay, first);
  assert.notEqual(changed, first);
});

function shiftComparison(
  excelRow: Partial<CollectionReport>,
  existingRecord?: Partial<CollectionReport>,
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

test('diagnostic de décalage : toute divergence d’identité stable bloque', () => {
  const identical = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) =>
      shiftComparison(identityRow(offset + index), identityRow(offset + index))
    );
  const divergent = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) =>
      shiftComparison(identityRow(offset + index), identityRow(offset + index + 1000))
    );
  assert.equal(assessCollectionRowShift(identical(30)).blocked, false);
  const absolute = assessCollectionRowShift([...identical(99), ...divergent(1, 100)]);
  assert.equal(absolute.divergentCount, COLLECTION_SHIFT_MIN_DIVERGENT_ROWS);
  assert.equal(absolute.blocked, true);
  assert.equal(assessCollectionRowShift([...identical(8), ...divergent(2, 100)]).blocked, true);
  assert.equal(assessCollectionRowShift([shiftComparison(identityRow(1))]).blocked, false);
});

test('contrat serveur : scope expirant, RPC atomique, audit et garde anti-contournement', () => {
  const migration = readFileSync(
    'supabase/migrations/20260901000000_collection_report_controlled_production_activation.sql',
    'utf8',
  );

  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS collection_import_private/);
  assert.match(migration, /promotion_scope_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration, /enabled_until > statement_timestamp\(\) \+ interval '2 hours'/);
  assert.match(migration, /CREATE TABLE collection_import_private\.runtime_control_events/);
  assert.match(migration, /CREATE TABLE collection_import_private\.commands/);
  assert.match(migration, /PRIMARY KEY \(actor_id, command_key\)/);
  assert.match(migration, /CREATE TABLE collection_import_private\.write_contexts/);
  assert.match(migration, /context\.transaction_id = txid_current\(\)/);
  assert.match(migration, /context\.actor_id = auth\.uid\(\)/);
  assert.match(migration, /CREATE TABLE collection_import_private\.row_audit/);
  assert.match(migration, /before_row jsonb/);
  assert.match(migration, /after_row jsonb NOT NULL/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA collection_import_private/);

  assert.match(migration, /CREATE FUNCTION public\.import_collection_report_atomic_v1/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /COLLECTION_IMPORT_FORBIDDEN/);
  assert.match(migration, /assert_promotion_scope_v1\(\)/);
  assert.match(migration, /FROM collection_import_private\.runtime_control AS control[\s\S]*FOR SHARE/);
  assert.match(migration, /v_enabled_until <= clock_timestamp\(\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /encode\(sha256\(convert_to\(p_rows::text, 'UTF8'\)\), 'hex'\)/);
  assert.match(migration, /jsonb_array_length\(p_rows\) NOT BETWEEN 1 AND 5000/);
  assert.match(migration, /COLLECTION_IMPORT_DUPLICATE_TRACEABILITY_IN_PAYLOAD/);
  assert.match(migration, /COLLECTION_IMPORT_MASS_ROW_SHIFT_DETECTED/);
  assert.match(migration, /ON CONFLICT \(excel_filename, excel_source_row\)/);
  assert.doesNotMatch(migration, /status = EXCLUDED\.status/);
  assert.doesNotMatch(migration, /processing_status = EXCLUDED\.processing_status/);
  assert.match(migration, /date_of_validity = COALESCE\(current_row\.date_of_validity, EXCLUDED\.date_of_validity\)/);
  assert.match(migration, /GET DIAGNOSTICS v_audit_rows = ROW_COUNT/);
  assert.match(migration, /COLLECTION_IMPORT_AUDIT_INCOMPLETE/);
  assert.doesNotMatch(migration, /set_config\('sodatra\.collection_import_authorized'/);
  assert.match(migration, /COLLECTION_IMPORT_ATOMIC_RPC_REQUIRED/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.import_collection_report_atomic_v1\(uuid,jsonb\)[\s\S]*TO authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.import_collection_report_atomic_v1\(uuid,jsonb\)[\s\S]*service_role/);
});

test('contrat frontend : une seule RPC mutative et verrou serveur strictement vrai', () => {
  const atomicService = readFileSync('src/services/collectionReportAtomicImportService.ts', 'utf8');
  const commandKeyService = readFileSync('src/services/collectionImportCommandKey.ts', 'utf8');
  const promotionService = readFileSync('src/services/collectionImportPromotionService.ts', 'utf8');
  const page = readFileSync('src/pages/FileUpload.tsx', 'utf8');

  assert.match(atomicService, /rpc\('import_collection_report_atomic_v1'/);
  assert.doesNotMatch(atomicService, /\.from\('collection_report'\)/);
  assert.doesNotMatch(atomicService, /error\.message \|\|/);
  assert.match(commandKeyService, /digest\('SHA-256'/);
  assert.match(promotionService, /promoteCollectionReportAtomically/);
  assert.doesNotMatch(promotionService, /processIntelligentSync/);
  assert.doesNotMatch(promotionService, /PROMOTION_BATCH_SIZE/);
  assert.match(page, /collectionPromotionScopeQuery\.data === true/);
  assert.match(page, /!collectionPromotionScopeQuery\.isFetching/);
  assert.match(page, /allowedDocumentKinds: deploymentTarget === 'production'/);
  assert.match(page, /\['COLLECTION_REPORT'\]/);
});
