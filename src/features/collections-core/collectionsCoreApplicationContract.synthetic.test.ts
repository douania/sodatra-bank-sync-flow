import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('la route Core est additive et ne remplace pas le rapprochement historique', async () => {
  const app = await read('../../App.tsx');
  assert.match(app, /path="\/collections-remittances"/);
  assert.match(app, /path="\/reconciliation"/);
});

test('la navigation Core reste cachée tant que la garde partagée ne l’autorise pas', async () => {
  const layout = await read('../../components/Layout.tsx');
  const app = await read('../../App.tsx');
  assert.match(layout, /useCollectionsCorePilotGate/);
  assert.match(layout, /collectionsCoreGate\.status === 'allowed'/);
  assert.match(app, /CollectionsCorePilotGateProvider/);
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

test('bloque toutes les fonctions de phase B avant leur accès réseau en staging', async () => {
  const service = await read('./collectionsCoreService.ts');
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.equal((service.match(/assertReady\('phase_b'\)/g) ?? []).length, 4);
  assert.match(service, /listActiveCreditLines[\s\S]*?assertReady\('phase_b'\)[\s\S]*?daily_statement_lines_canonical/);
  assert.match(page, /Phase A uniquement[\s\S]*Daily v2 reste NOT_RUN/);
});

test('le panneau staging expose seulement préparer et fermer pour G', async () => {
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.match(page, /actor==='G'&&<PilotAdministrationPanel/);
  assert.match(page, /Préparer le pilote/);
  assert.match(page, /Fermer le pilote/);
});

test('le bandeau staging porte les trois avertissements métier obligatoires', async () => {
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.match(
    page,
    /PILOTE STAGING — données synthétiques uniquement — aucun paiement ni écriture comptable/,
  );
});

test('le compte de dépôt synthétique est vérifié avant la RPC de saisie', async () => {
  const service = await read('./collectionsCoreService.ts');
  const createStart = service.indexOf('export async function createCollectionEntry');
  const accountPreflight = service.indexOf('const activeAccounts = await listCollectionAccounts()', createStart);
  const createRpc = service.indexOf("rpc('create_collection_entry_v1'", createStart);
  assert.ok(createStart >= 0 && accountPreflight > createStart && createRpc > accountPreflight);
  assert.match(service, /PILOT_DEPOSIT_ACCOUNT_REJECTED/);
});

test('la fermeture vérifie A/B avant de révoquer G en dernier', async () => {
  const service = await read('./collectionsCoreService.ts');
  const postControl = service.indexOf('const businessPostControl');
  const revokeGrantor = service.indexOf('REVOKE:G:MANAGE_ACCESS');
  assert.ok(postControl > 0 && revokeGrantor > postControl);
});
