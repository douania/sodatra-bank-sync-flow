import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('la route Core est additive et ne remplace pas le rapprochement historique', async () => {
  const app = await read('../../App.tsx');
  assert.match(app, /path="\/collections-remittances"/);
  assert.match(app, /path="\/reconciliation"/);
});

test('la navigation Core reste cachée hors cible locale autorisée', async () => {
  const layout = await read('../../components/Layout.tsx');
  assert.match(layout, /currentCollectionsCoreRuntimeVerdict\(\)\.allowed/);
});

test('la saisie utilise une seule RPC atomique', async () => {
  const service = await read('./collectionsCoreService.ts');
  for (const rpc of ['create_collection_entry_v1','validate_collection_remittance_v1','propose_collection_match_v1','confirm_collection_match_v1','export_collection_register_v1']) {
    assert.match(service, new RegExp(rpc));
  }
  assert.doesNotMatch(service, /create_collection_remittance_v1|add_collection_remittance_item_v1|allocate_collection_invoice_v1|runtime_control|service_role/);
  assert.match(service, /p_command_key: workflowKey/);
  assert.match(service, /p_invoice: input\.invoiceReference\.trim\(\)/);
});

test('un rechargement conserve uniquement la clé opaque du workflow', async () => {
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.match(page, /sessionStorage\.getItem\(entryWorkflowStorageKey\)/);
  assert.match(page, /sessionStorage\.setItem\(entryWorkflowStorageKey, generated\)/);
  assert.doesNotMatch(page, /sessionStorage\.setItem\([^,]+,\s*JSON\.stringify\(form\)/);
});

test('le registre affiche la liquidité nette sans la recalculer', async () => {
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.match(page, /<TableHead>Liquidité nette<\/TableHead>/);
  assert.match(page, /<TableHead>Retenue bancaire observée<\/TableHead>/);
  assert.match(page, /money\.format\(row\.netLiquidityAmount\)/);
});

test('le parcours simplifié ne rattache pas les débits de frais séparés', async () => {
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.match(page, /Crédit au nominal/);
  assert.match(page, /Crédit net après retenue bancaire/);
  assert.match(page, /Les débits de frais séparés restent dans le relevé bancaire/);
  assert.doesNotMatch(page, /value="FEES_SEPARATE"/);
});

test('aucun paiement ni écriture comptable n’est présenté comme exécuté', async () => {
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.match(page, /sans exécuter de paiement ni passer d’écriture comptable/);
});
