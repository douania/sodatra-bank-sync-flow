import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  currentUploadMutationVerdict,
  validateUploadMutationTarget,
  UPLOAD_READ_ONLY_TARGET_MESSAGE,
} from './uploadRuntimeGuard';
import {
  promoteValidatedCollections,
  type CollectionSyncEngine,
} from './collectionImportPromotionService';
import type { CollectionImportReview } from '@/types/processing';

// ⭐ 0Z_AM — GLOBAL-PRODUCTION-READ-ONLY-UPLOAD-GUARD.
// Aucune donnée bancaire réelle, aucun accès Supabase. La garde /upload est une
// barrière d'interface (jamais de sécurité) qui réutilise la politique
// canonique cible × capacité de Daily v2 : production = read uniquement,
// inconnu/invalide = refus fail-closed.

const STAGING_URL = 'https://gbbsqcscryygqlmqncyv.supabase.co';
const PRODUCTION_URL = 'https://leakcdbbawzysfqyqsnr.supabase.co';

const page = readFileSync('src/pages/FileUpload.tsx', 'utf8');
const processing = readFileSync('src/services/fileProcessingService.ts', 'utf8');
const promotion = readFileSync('src/services/collectionImportPromotionService.ts', 'utf8');
const guard = readFileSync('src/services/uploadRuntimeGuard.ts', 'utf8');

// --- Politique de cible : staging inchangé, production et inconnu refusés ----

test('staging autorisé : la mutation d\'import reste permise (comportement inchangé)', () => {
  const withProjectId = validateUploadMutationTarget({
    supabaseUrl: STAGING_URL,
    projectId: 'gbbsqcscryygqlmqncyv',
  });
  assert.equal(withProjectId.allowed, true);

  const urlOnly = validateUploadMutationTarget({ supabaseUrl: STAGING_URL });
  assert.equal(urlOnly.allowed, true);
});

test('production : la mutation d\'import est refusée (lecture seule)', () => {
  assert.equal(validateUploadMutationTarget({ supabaseUrl: PRODUCTION_URL }).allowed, false);
  assert.equal(
    validateUploadMutationTarget({
      supabaseUrl: PRODUCTION_URL,
      projectId: 'leakcdbbawzysfqyqsnr',
    }).allowed,
    false,
  );
});

test('cible inconnue, invalide, absente ou contradictoire : refus fail-closed', () => {
  assert.equal(validateUploadMutationTarget({}).allowed, false);
  assert.equal(validateUploadMutationTarget({ supabaseUrl: '   ' }).allowed, false);
  assert.equal(validateUploadMutationTarget({ supabaseUrl: 'not-an-url' }).allowed, false);
  assert.equal(validateUploadMutationTarget({ supabaseUrl: 'https://example.com' }).allowed, false);
  assert.equal(
    validateUploadMutationTarget({ supabaseUrl: 'https://aaaabbbbccccdddd.supabase.co' }).allowed,
    false,
  );
  assert.equal(
    validateUploadMutationTarget({
      supabaseUrl: STAGING_URL,
      projectId: 'leakcdbbawzysfqyqsnr',
    }).allowed,
    false,
  );
});

test('environnement runtime illisible (hors Vite) : refus fail-closed sans lever', () => {
  // Sous Node/tsx, import.meta.env est absent : le verdict courant doit
  // refuser proprement, jamais autoriser ni jeter.
  const verdict = currentUploadMutationVerdict();
  assert.equal(verdict.allowed, false);
});

// --- Refus runtime fail-closed de la promotion avec la garde par défaut ------

test('promotion avec garde par défaut hors cible autorisée : rejet avant tout appel moteur', async () => {
  const trappedEngine: CollectionSyncEngine = {
    async analyze() {
      throw new Error('analyze ne doit jamais être appelé sous la garde read-only');
    },
    async sync() {
      throw new Error('sync ne doit jamais être appelé sous la garde read-only');
    },
  };

  const review: CollectionImportReview = {
    reviewReady: true,
    files: ['COLLECTION_REPORT_SYNTHETIC.xlsx'],
    acceptedRows: [
      {
        rowId: 'COLLECTION_REPORT_SYNTHETIC.xlsx::2',
        collection: {
          reportDate: '2026-06-05',
          clientCode: 'CLIENT_SYN_2',
          collectionAmount: 100002,
          bankName: 'BANQUE_SYNTHETIQUE_1',
          status: 'pending',
          excelFilename: 'COLLECTION_REPORT_SYNTHETIC.xlsx',
          excelSourceRow: 2,
        },
        selected: true,
      },
    ],
    rejectedRows: [],
    fileLevelErrors: [],
    warnings: [],
    counters: {
      files_processed: 1,
      accepted_rows: 1,
      rejected_rows: 0,
      file_level_rejections: 0,
      warnings: 0,
    },
    preparedAt: '2026-07-30T00:00:00.000Z',
  };

  await assert.rejects(
    promoteValidatedCollections(review, trappedEngine),
    new RegExp(UPLOAD_READ_ONLY_TARGET_MESSAGE.slice(0, 30)),
  );
});

// --- Contrat : le guard réutilise la politique canonique, sans doublon -------

test('le guard réutilise la politique canonique Daily v2 sans dupliquer les refs projet', () => {
  assert.match(guard, /from '@\/features\/daily-v2\/dailyV2RuntimeTarget'/);
  assert.match(guard, /validateDailyV2RuntimeTarget\(input, 'deposit'\)/);
  assert.match(guard, /currentDailyV2RuntimeTargetVerdict\('deposit'\)/);
  // Source unique de vérité : aucune ref projet recopiée dans le guard.
  assert.doesNotMatch(guard, /gbbsqcscryygqlmqncyv/);
  assert.doesNotMatch(guard, /leakcdbbawzysfqyqsnr/);
});

// --- Contrat : la page /upload est fail-closed en lecture seule --------------

test('la page /upload rend un état lecture seule fail-closed sans interface active', () => {
  // Garde d'interface calculée depuis la politique canonique.
  assert.match(page, /const uploadMutationAllowed = isUploadMutationAllowed\(\);/);

  // Dropzone jamais active sans capacité de mutation.
  assert.match(page, /disabled: !uploadMutationAllowed,/);

  // Retour anticipé lecture seule AVANT toute interface active, avec bandeau
  // explicite ; la dropzone n'est rendue que dans la branche autorisée.
  assert.match(
    page,
    /if \(!uploadMutationAllowed\) \{\s*return \([\s\S]*?Production en lecture seule[\s\S]*?\);\s*\}\s*return \(/,
  );
  const readOnlyReturn = page.indexOf('Production en lecture seule</AlertTitle>');
  const activeDropzone = page.indexOf('{...getRootProps(');
  assert.ok(readOnlyReturn >= 0 && activeDropzone >= 0);
  assert.ok(readOnlyReturn < activeDropzone, 'read-only state must render before the dropzone');

  // Handlers fail-closed (traitement ET promotion), même si un bouton résiduel
  // était déclenché : trois gardes au total (2 handlers + 1 rendu).
  const handlerGuards = page.match(
    /if \(!uploadMutationAllowed\) \{\s*toast\(\{\s*variant: "destructive",\s*title: "Production en lecture seule",\s*description: UPLOAD_READ_ONLY_TARGET_MESSAGE,\s*\}\);\s*return;\s*\}/g,
  );
  assert.equal(handlerGuards?.length, 2);
  assert.equal((page.match(/if \(!uploadMutationAllowed\) \{/g) ?? []).length, 3);
});

test('staging : le pipeline d\'import de la page reste strictement inchangé', () => {
  assert.match(page, /useDropzone\(\{/);
  assert.match(page, /\{\.\.\.getRootProps\(\{ className: 'dropzone' \}\)\}/);
  assert.match(page, /await partitionCollectionReportFiles\(selectedFiles\)/);
  assert.match(page, /await fileProcessingService\.processFiles\(otherFiles\)/);
  assert.match(page, /await promoteValidatedCollections\(reviewWithSelection\)/);
  assert.match(page, /const gate = assertPromotionAllowed\(reviewWithSelection\)/);
});

// --- Contrat : services fail-closed avant tout travail -----------------------

test('processFiles refuse fail-closed avant timeout, heartbeat et tout traitement', () => {
  assert.match(processing, /from '\.\/uploadRuntimeGuard'/);
  assert.match(
    processing,
    /const uploadGate = currentUploadMutationVerdict\(\);\s*if \(!uploadGate\.allowed\) \{\s*results\.errors\.push\(UPLOAD_READ_ONLY_TARGET_MESSAGE\);\s*return results;\s*\}/,
  );
  const gateIndex = processing.indexOf('currentUploadMutationVerdict()');
  const timeoutIndex = processing.indexOf('setTimeout');
  assert.ok(gateIndex >= 0 && timeoutIndex >= 0);
  assert.ok(gateIndex < timeoutIndex, 'the gate must precede the processing timeout setup');
});

test('promoteValidatedCollections garde une entrée fail-closed par défaut', () => {
  assert.match(promotion, /from '\.\/uploadRuntimeGuard'/);
  assert.match(promotion, /uploadMutationGate: UploadMutationGate = currentUploadMutationVerdict/);
  assert.match(
    promotion,
    /if \(!uploadMutationGate\(\)\.allowed\) \{\s*throw new Error\(UPLOAD_READ_ONLY_TARGET_MESSAGE\);\s*\}/,
  );
  const gateIndex = promotion.indexOf('if (!uploadMutationGate().allowed)');
  const businessGateIndex = promotion.indexOf('const gate = assertPromotionAllowed(review);');
  assert.ok(gateIndex >= 0 && businessGateIndex >= 0);
  assert.ok(gateIndex < businessGateIndex, 'the target gate must precede the business gate');
});
