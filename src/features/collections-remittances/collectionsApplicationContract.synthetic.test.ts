import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const page = readFileSync('src/pages/CollectionsRemittances.tsx', 'utf8');
const service = readFileSync('src/features/collections-remittances/collectionsService.ts', 'utf8');
const runtimeTarget = readFileSync(
  'src/features/collections-remittances/collectionsRuntimeTarget.ts',
  'utf8',
);
const types = readFileSync('src/features/collections-remittances/collectionsTypes.ts', 'utf8');

test('raccorde la page 0Z1B sans remplacer le rapprochement historique', () => {
  assert.match(app, /path="\/collections-remittances"/);
  assert.match(app, /path="\/reconciliation"/);
  assert.match(app, /<ProtectedRoute><CollectionsRemittances \/><\/ProtectedRoute>/);
  assert.match(layout, /href: '\/collections-remittances'/);
  assert.match(layout, /collectionsLocalEnabled/);
});

test('ferme lecture et mutation hors instance locale explicitement activée', () => {
  assert.match(runtimeTarget, /VITE_COLLECTIONS_0Z1B_LOCAL_ENABLED/);
  assert.match(runtimeTarget, /host !== 'localhost'/);
  assert.match(runtimeTarget, /host !== '127\.0\.0\.1'/);
  assert.match(service, /assertLocalTarget\('read'\)/);
  assert.match(service, /assertLocalTarget\('mutate'\)/);
  assert.match(page, /currentCollectionsRuntimeTargetVerdict\('read'\)/);
});

test('utilise uniquement les RPC métier pour les mutations applicatives', () => {
  for (const rpc of [
    'create_collection_receipt_v1',
    'allocate_collection_invoice_v1',
    'create_collection_prorogation_v1',
    'attach_collection_prorogation_source_v1',
    'attach_collection_replacement_effect_v1',
    'prepare_collection_funding_cheque_v1',
    'approve_collection_funding_cheque_v1',
    'confirm_collection_funding_delivery_v1',
    'propose_collection_match_v1',
    'confirm_collection_match_v1',
  ]) {
    assert.match(service, new RegExp(`runCommand\\('${rpc}'`));
    assert.match(types, new RegExp(`${rpc}:`));
  }

  assert.doesNotMatch(service, /\.(insert|update|delete|upsert)\s*\(/);
  assert.equal(service.includes('service_role'), false);
  assert.equal(service.includes('createClient('), false);
});

test('conserve les contrôles fonctionnels visibles et la séparation des acteurs', () => {
  assert.match(page, /row\.created_by === currentUserId/);
  assert.match(page, /row\.proposed_by === currentUserId/);
  assert.match(page, /Motif de confirmation \(8 caractères minimum\)/);
  assert.match(page, /Banque du client/);
  assert.match(page, /Banque SODATRA/);
  assert.match(page, /La proposition n’est jamais une confirmation automatique/);
});

test('présente la même identité métier dans la proposition et sa confirmation', () => {
  assert.equal(page.match(/collectionReceiptIdentity\(/g)?.length, 2);
  assert.match(page, /missingCollectionReceiptIdentity\(row\.aggregate_id\)/);
  assert.match(page, /Montant proposé/);
});
