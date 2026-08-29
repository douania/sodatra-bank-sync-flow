import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';

import {
  currentUploadMutationVerdict,
  validateUploadMutationTarget,
  UPLOAD_READ_ONLY_TARGET_MESSAGE,
  type UploadMutationCapability,
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
// inconnu/invalide = refus fail-closed. Capacités du flux d'import :
// sélection/traitement = deposit ; promotion Collection = promote.

// Note runner : le client Supabase généré (`@/integrations/supabase/client`)
// est Vite-only et crashe sous Node ; comme dans
// collectionImportReviewService.classification.synthetic.test.ts, il est
// court-circuité par un stub inerte via un hook de résolution auto-contenu.
// Le stub jette au moindre accès : ce test ne peut physiquement pas toucher
// Supabase, ce qui prouve aussi qu'aucun traitement ne démarre sous refus.
const SUPABASE_CLIENT_SPECIFIER = '@/integrations/supabase/client';

const supabaseStubModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    'export const supabase = new Proxy({}, {' +
      ' get() { throw new Error("synthetic test: supabase client must never be used"); }' +
      ' });'
  );

const resolverHooksUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    `export function resolve(specifier, context, nextResolve) {
      if (specifier === ${JSON.stringify(SUPABASE_CLIENT_SPECIFIER)}) {
        return { shortCircuit: true, url: ${JSON.stringify(supabaseStubModuleUrl)} };
      }
      return nextResolve(specifier, context);
    }`
  );

register(resolverHooksUrl);

const nodeMajorVersion = Number(process.versions.node.split('.')[0]);

const MUTATION_CAPABILITIES: readonly UploadMutationCapability[] = ['deposit', 'promote'];

const STAGING_URL = 'https://gbbsqcscryygqlmqncyv.supabase.co';
const PRODUCTION_URL = 'https://leakcdbbawzysfqyqsnr.supabase.co';

const page = readFileSync('src/pages/FileUpload.tsx', 'utf8');
const processing = readFileSync('src/services/fileProcessingService.ts', 'utf8');
const promotion = readFileSync('src/services/collectionImportPromotionService.ts', 'utf8');
const guard = readFileSync('src/services/uploadRuntimeGuard.ts', 'utf8');

function trappedEngine(): CollectionSyncEngine {
  return {
    async analyze() {
      throw new Error('analyze ne doit jamais être appelé sous la garde read-only');
    },
    async sync() {
      throw new Error('sync ne doit jamais être appelé sous la garde read-only');
    },
  };
}

function syntheticReadyReview(): CollectionImportReview {
  return {
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
}

// --- Matrice capacité × cible : staging inchangé, production/inconnu refusés -

test('matrice : staging autorise deposit ET promote (comportement inchangé)', () => {
  for (const capability of MUTATION_CAPABILITIES) {
    assert.equal(
      validateUploadMutationTarget(
        { supabaseUrl: STAGING_URL, projectId: 'gbbsqcscryygqlmqncyv' },
        capability,
      ).allowed,
      true,
      `staging must allow ${capability}`,
    );
    assert.equal(
      validateUploadMutationTarget({ supabaseUrl: STAGING_URL }, capability).allowed,
      true,
      `staging (URL seule) must allow ${capability}`,
    );
  }
});

test('matrice : production refuse deposit ET promote (lecture seule)', () => {
  for (const capability of MUTATION_CAPABILITIES) {
    assert.equal(
      validateUploadMutationTarget({ supabaseUrl: PRODUCTION_URL }, capability).allowed,
      false,
      `production must refuse ${capability}`,
    );
    assert.equal(
      validateUploadMutationTarget(
        { supabaseUrl: PRODUCTION_URL, projectId: 'leakcdbbawzysfqyqsnr' },
        capability,
      ).allowed,
      false,
      `production (avec projectId) must refuse ${capability}`,
    );
  }
});

test('matrice : cible inconnue, invalide, absente ou contradictoire refusée pour chaque capacité', () => {
  for (const capability of MUTATION_CAPABILITIES) {
    for (const input of [
      {},
      { supabaseUrl: '   ' },
      { supabaseUrl: 'not-an-url' },
      { supabaseUrl: 'https://example.com' },
      { supabaseUrl: 'https://aaaabbbbccccdddd.supabase.co' },
      { supabaseUrl: STAGING_URL, projectId: 'leakcdbbawzysfqyqsnr' },
    ]) {
      assert.equal(
        validateUploadMutationTarget(input, capability).allowed,
        false,
        `${JSON.stringify(input)} must refuse ${capability} fail-closed`,
      );
    }
  }
});

test('environnement runtime illisible (hors Vite) : refus fail-closed des deux capacités sans lever', () => {
  // Sous Node/tsx, import.meta.env est absent : le verdict courant doit
  // refuser proprement, jamais autoriser ni jeter.
  for (const capability of MUTATION_CAPABILITIES) {
    assert.equal(currentUploadMutationVerdict(capability).allowed, false);
  }
});

// --- Matrice deposit sans promote : la promotion refuse ----------------------

test('matrice : une cible déposante mais non promouvante est refusée pour la promotion', async () => {
  // Politique canonique actuelle : aucune cible n'accorde deposit sans
  // promote. Cette cible hypothétique fige le contrat de capacité : la
  // promotion interroge « promote », jamais « deposit » — si une telle cible
  // apparaissait, la promotion resterait refusée avant tout appel moteur.
  const hypotheticalDepositOnlyTarget = {
    deposit: { allowed: true },
    promote: { allowed: false },
  } as const;

  assert.equal(hypotheticalDepositOnlyTarget.deposit.allowed, true);

  await assert.rejects(
    promoteValidatedCollections(
      syntheticReadyReview(),
      trappedEngine(),
      () => hypotheticalDepositOnlyTarget.promote,
    ),
    new RegExp(UPLOAD_READ_ONLY_TARGET_MESSAGE.slice(0, 30)),
  );
});

test('promotion avec garde par défaut hors cible autorisée : rejet avant tout appel moteur', async () => {
  await assert.rejects(
    promoteValidatedCollections(syntheticReadyReview(), trappedEngine()),
    new RegExp(UPLOAD_READ_ONLY_TARGET_MESSAGE.slice(0, 30)),
  );
});

// --- Comportement réel : processFiles([]) refuse avant tout traitement -------

test('processFiles exécuté sous cible non autorisée : refus structuré avant tout traitement', {
  // Le hook register() intercepte l'alias Vite sous Node 20 (runtime CI). Sous
  // Node 24 + tsx, l'alias est résolu avant le hook et le client généré Vite
  // crashe avant le test. Le contrat source qui impose la garde avant timeout,
  // heartbeat et traitement reste vérifié plus bas sur toutes les versions.
  skip: nodeMajorVersion >= 24 ? 'Harness Supabase/Vite exécuté en CI Node 20.' : false,
}, async () => {
  // Import dynamique APRÈS l'enregistrement du hook (chaîne legacy complète).
  const { fileProcessingService } = await import('./fileProcessingService');

  const result = await fileProcessingService.processFiles([]);

  assert.equal(result.success, false);
  assert.deepEqual(result.errors, [UPLOAD_READ_ONLY_TARGET_MESSAGE]);
  assert.deepEqual(result.data?.bankReports, []);
  assert.deepEqual(result.data?.collectionReports, []);
  assert.equal(result.data?.syncResult, undefined);
  // Preuve d'absence de traitement : le stub Supabase piégé jette au moindre
  // accès et n'a pas jeté ; le contrat ci-dessous fige en plus que la garde
  // précède timeout et heartbeat dans le source.
});

test('le service aval partage la classification stricte du précontrôle', {
  skip: nodeMajorVersion >= 24 ? 'Harness Supabase/Vite exécuté en CI Node 20.' : false,
}, async () => {
  const { fileProcessingService } = await import('./fileProcessingService');
  const service = fileProcessingService as unknown as {
    detectFileTypeDetailed(file: File): Promise<string>;
    categorizeFiles(files: File[]): Promise<{
      blockedFiles: Array<{ file: File; reason: string }>;
    }>;
  };
  const syntheticFile = (name: string, lastModified = 1) => (
    new File(['synthetic'], name, { lastModified })
  );

  assert.equal(
    await service.detectFileTypeDetailed(syntheticFile('Releve BDK FP2026.pdf')),
    'BANK_REPORT',
  );
  assert.equal(
    await service.detectFileTypeDetailed(syntheticFile('Relevé Société Générale.pdf')),
    'BANK_REPORT',
  );
  assert.equal(await service.detectFileTypeDetailed(syntheticFile('CORPORATE.pdf')), 'UNKNOWN');
  assert.equal(await service.detectFileTypeDetailed(syntheticFile('RUBICON.pdf')), 'UNKNOWN');
  assert.equal(await service.detectFileTypeDetailed(syntheticFile('MSG.pdf')), 'UNKNOWN');
  assert.equal(
    await service.detectFileTypeDetailed(syntheticFile('synthetic-BDK-internal-book.xlsx')),
    'INTERNAL_BOOK',
  );

  const singletonConflict = await service.categorizeFiles([
    syntheticFile('Fund Position matin.xlsx', 1),
    syntheticFile('Fund Position soir.xlsx', 2),
    syntheticFile('Fund Position clôture.xlsx', 3),
  ]);
  assert.equal(singletonConflict.blockedFiles.length, 3);
  assert.equal(new Set(singletonConflict.blockedFiles.map(entry => entry.file)).size, 3);
});

// --- Contrat : le guard réutilise la politique canonique, sans doublon -------

test('le guard réutilise la politique canonique Daily v2 sans dupliquer les refs projet', () => {
  assert.match(guard, /from '@\/features\/daily-v2\/dailyV2RuntimeTarget'/);
  assert.match(guard, /validateDailyV2RuntimeTarget\(input, 'read'\)/);
  assert.match(guard, /currentDailyV2RuntimeTargetVerdict\('read'\)/);
  assert.match(guard, /DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF/);
  assert.match(guard, /targetVerdict\.projectRef !== DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF/);
  // La capacité est obligatoire : aucune valeur par défaut, chaque appelant
  // la déclare (même règle que la garde canonique).
  assert.match(guard, /capability: UploadMutationCapability,/);
  assert.doesNotMatch(guard, /capability: UploadMutationCapability = /);
  // Sous-ensemble mutation uniquement : jamais read/admin.
  assert.match(guard, /export type UploadMutationCapability = 'deposit' \| 'promote';/);
  // Source unique de vérité : aucune ref projet recopiée dans le guard.
  assert.doesNotMatch(guard, /gbbsqcscryygqlmqncyv/);
  assert.doesNotMatch(guard, /leakcdbbawzysfqyqsnr/);
});

// --- Contrat : la page /upload est fail-closed en lecture seule --------------

test('la page /upload déclare une capacité par famille d\'actions et reste fail-closed', () => {
  // Sélection/traitement = deposit ; promotion = promote.
  assert.match(page, /const targetAllowsDeposit = isUploadMutationAllowed\('deposit'\);/);
  assert.match(page, /const targetAllowsPromotion = isUploadMutationAllowed\('promote'\);/);
  assert.match(page, /const importAccess = evaluateOperationalImportAccess\(\{/);
  assert.match(page, /const canProcessFiles = importAccess\.allowed;/);
  assert.match(page, /const canPromoteCollections = importAccess\.allowed && targetAllowsPromotion;/);
  assert.match(
    page,
    /function isBlockedOperationalImportAccess\([\s\S]*?Extract<OperationalImportAccessVerdict, \{ allowed: false \}>[\s\S]*?return verdict\.allowed === false;/,
  );

  // Dropzone jamais active sans la capacité deposit.
  assert.match(page, /disabled: !canProcessFiles,/);

  // Retour anticipé lecture seule AVANT toute interface active, avec bandeau
  // explicite ; la dropzone n'est rendue que dans la branche autorisée.
  assert.match(page, /if \(!canProcessFiles\) \{\s*return \([\s\S]*?<AlertTitle>\{blockedCopy\.title\}<\/AlertTitle>/);
  assert.match(page, /title: 'Production en lecture seule', description: UPLOAD_READ_ONLY_TARGET_MESSAGE/);
  const readOnlyReturn = page.indexOf('<AlertTitle>{blockedCopy.title}</AlertTitle>');
  const activeDropzone = page.indexOf('{...getRootProps(');
  assert.ok(readOnlyReturn >= 0 && activeDropzone >= 0);
  assert.ok(readOnlyReturn < activeDropzone, 'read-only state must render before the dropzone');

  // Handlers fail-closed, chacun sur SA capacité, même si un bouton résiduel
  // était déclenché.
  assert.match(
    page,
    /if \(!canProcessFiles\) \{\s*toast\(\{\s*variant: "destructive",\s*title: blockedCopy\.title,\s*description: blockedCopy\.description,\s*\}\);\s*return;\s*\}/,
  );
  assert.match(
    page,
    /if \(!canPromoteCollections\) \{\s*toast\(\{\s*variant: "destructive",\s*title: blockedCopy\.title,\s*description: blockedCopy\.description,\s*\}\);\s*return;\s*\}/,
  );
  assert.equal((page.match(/if \(!canProcessFiles\) \{/g) ?? []).length, 2);
  assert.equal((page.match(/if \(!canPromoteCollections\) \{/g) ?? []).length, 1);
});

test('staging : le pipeline d\'import de la page reste strictement inchangé', () => {
  assert.match(page, /useDropzone\(\{/);
  assert.match(page, /\{\.\.\.getRootProps\(\{ className: 'dropzone' \}\)\}/);
  assert.match(page, /await partitionCollectionReportFiles\(selectedFiles\)/);
  assert.match(page, /await fileProcessingService\.processFiles\(otherFiles\)/);
  assert.match(page, /await promoteValidatedCollections\(reviewWithSelection\)/);
  assert.match(page, /const gate = assertPromotionAllowed\(reviewWithSelection\)/);
  assert.match(page, /roles: rolesQuery\.data \?\? \[\]/);
  assert.match(page, /enabled: Boolean\(user\?\.id\) && targetAllowsDeposit/);
});

// --- Contrat : services fail-closed avant tout travail -----------------------

test('processFiles exige la capacité deposit avant timeout, heartbeat et tout traitement', () => {
  assert.match(processing, /from '\.\/uploadRuntimeGuard'/);
  assert.match(
    processing,
    /const uploadGate = currentUploadMutationVerdict\('deposit'\);\s*if \(!uploadGate\.allowed\) \{\s*results\.errors\.push\(UPLOAD_READ_ONLY_TARGET_MESSAGE\);\s*return results;\s*\}/,
  );
  const gateIndex = processing.indexOf("currentUploadMutationVerdict('deposit')");
  const timeoutIndex = processing.indexOf('setTimeout');
  assert.ok(gateIndex >= 0 && timeoutIndex >= 0);
  assert.ok(gateIndex < timeoutIndex, 'the gate must precede the processing timeout setup');
});

test('promoteValidatedCollections exige la capacité promote par défaut, fail-closed', () => {
  assert.match(promotion, /from '\.\/uploadRuntimeGuard'/);
  assert.match(
    promotion,
    /uploadMutationGate: UploadMutationGate = \(\) => currentUploadMutationVerdict\('promote'\)/,
  );
  assert.match(
    promotion,
    /if \(!uploadMutationGate\(\)\.allowed\) \{\s*throw new Error\(UPLOAD_READ_ONLY_TARGET_MESSAGE\);\s*\}/,
  );
  const gateIndex = promotion.indexOf('if (!uploadMutationGate().allowed)');
  const businessGateIndex = promotion.indexOf('const gate = assertPromotionAllowed(review);');
  assert.ok(gateIndex >= 0 && businessGateIndex >= 0);
  assert.ok(gateIndex < businessGateIndex, 'the target gate must precede the business gate');
});
