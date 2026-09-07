import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE,
  assertLegacyCollectionMutationAllowed,
  currentLegacyCollectionMutationVerdict,
  executeLegacyCollectionMutation,
  validateLegacyCollectionMutationTarget,
  type LegacyCollectionMutationAction,
} from './uploadRuntimeGuard';

// PACK 0 — isolation des écritures Collection legacy (/reconciliation).
// Aucune donnée bancaire réelle, aucun accès Supabase : le client généré est
// court-circuité par un stub qui jette au moindre accès, ce qui prouve
// physiquement qu'aucun handler neutralisé ne touche la base.
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
const componentSkip = nodeMajorVersion >= 24 ? 'Harness Supabase/Vite exécuté en CI Node 20.' : false;

const ACTIONS: readonly LegacyCollectionMutationAction[] = ['legacy_sync', 'legacy_mark_processed'];
const STAGING_URL = 'https://gbbsqcscryygqlmqncyv.supabase.co';
const PRODUCTION_URL = 'https://leakcdbbawzysfqyqsnr.supabase.co';

test('la garde legacy refuse chaque action sur toutes les cibles, y compris staging et cible courante', () => {
  for (const action of ACTIONS) {
    for (const input of [
      { supabaseUrl: STAGING_URL, projectId: 'gbbsqcscryygqlmqncyv' },
      { supabaseUrl: PRODUCTION_URL, projectId: 'leakcdbbawzysfqyqsnr' },
      { supabaseUrl: 'https://unknown.supabase.co' },
      {},
    ]) {
      const verdict = validateLegacyCollectionMutationTarget(input, action);
      assert.equal(verdict.allowed, false, `${action} must be refused for ${JSON.stringify(input)}`);
      assert.equal(verdict.action, action);
      assert.equal(verdict.reason, LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE);
    }
    assert.equal(currentLegacyCollectionMutationVerdict(action).allowed, false);
    assert.throws(
      () => assertLegacyCollectionMutationAllowed(action),
      { message: LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE },
    );
  }
});

test('le seul point d’exécution legacy refuse avant tout appel service, pour la synchronisation comme pour le marquage', async () => {
  for (const action of ACTIONS) {
    let calls = 0;
    const outcome = await executeLegacyCollectionMutation(action, async () => {
      calls += 1;
      throw new Error(`la mutation legacy ${action} ne doit jamais être appelée`);
    });
    assert.deepEqual(outcome, { outcome: 'refused', action, reason: LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE });
    assert.equal(calls, 0);
  }
});

test('les composants rendus n’exposent plus aucune action de synchronisation ni de marquage', { skip: componentSkip }, async () => {
  const { default: IntelligentSyncManager } = await import('@/components/IntelligentSyncManager');
  const { default: CollectionsManager } = await import('@/components/CollectionsManager');
  const { default: Reconciliation } = await import('@/pages/Reconciliation');

  const syncMarkup = renderToStaticMarkup(<IntelligentSyncManager />);
  assert.doesNotMatch(syncMarkup, /Synchroniser/);
  assert.match(syncMarkup, /Synchronisation désactivée/);
  assert.match(syncMarkup, /lecture seule/);

  const collectionsMarkup = renderToStaticMarkup(<CollectionsManager />);
  assert.doesNotMatch(collectionsMarkup, /Payer Effet|Encaisser|Créditer|Analyse des Doublons/);
  assert.match(collectionsMarkup, /Marquage manuel désactivé/);

  const pageMarkup = renderToStaticMarkup(<Reconciliation />);
  assert.match(pageMarkup, /Écritures legacy isolées/);
  assert.doesNotMatch(pageMarkup, /Synchroniser|Payer Effet|Encaisser|Créditer/);
});

test('contrat source : aucun appel de mutation legacy ne subsiste dans les composants et la page', () => {
  const sync = readFileSync('src/components/IntelligentSyncManager.tsx', 'utf8');
  assert.doesNotMatch(sync, /intelligentSyncService\.processIntelligentSync/);
  assert.doesNotMatch(sync, /\.processIntelligentSync\(/);
  assert.doesNotMatch(sync, /onSyncComplete|handleSync\b/);
  assert.match(sync, /LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE/);
  assert.match(sync, /intelligentSyncService\.analyzeExcelFile\(/); // consultation conservée

  const collections = readFileSync('src/components/CollectionsManager.tsx', 'utf8');
  assert.doesNotMatch(collections, /updateCollectionDateOfValidity|markAsProcessed|DuplicateAnalyzer|removeDuplicates/);
  assert.match(collections, /LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE/);
  assert.match(collections, /databaseService\.getCollectionReports\(\)/); // consultation conservée

  // Le seul exécuteur legacy vit dans la garde et évalue le verdict avant `run`.
  const guard = readFileSync('src/services/uploadRuntimeGuard.ts', 'utf8');
  const executor = guard.slice(guard.indexOf('export async function executeLegacyCollectionMutation'));
  assert.ok(executor.indexOf('currentLegacyCollectionMutationVerdict(action)') < executor.indexOf('await run()'));

  const page = readFileSync('src/pages/Reconciliation.tsx', 'utf8');
  assert.doesNotMatch(page, /onSyncComplete|handleSyncComplete/);
  assert.match(page, /LEGACY_COLLECTION_WRITE_PATH_ISOLATED_MESSAGE/);

  // Le service Excel FROZEN n'est pas modifié par ce pack : il reste importé
  // tel quel et n'est pas réécrit pour porter la garde.
  const frozen = readFileSync('src/services/intelligentSyncService.ts', 'utf8');
  assert.doesNotMatch(frozen, /uploadRuntimeGuard|LEGACY_COLLECTION/);
});
