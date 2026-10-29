import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Production « administration seule » : garde de cible, liste blanche du
// service, décision d'ouverture et page. Doubles injectés au chargement des
// modules (hook de résolution Node), jamais par une option de production : le
// client Supabase enregistre chaque appel ; la cible vue par le service et la
// garde lue par la page sont fournies par le test. La garde de cible elle-même
// est testée sans double.
type Call = { kind: 'rpc' | 'session'; name: string; args?: Record<string, unknown> };
interface Harness {
  calls: Call[];
  verdict: Record<string, unknown>;
  gate: unknown;
}
const harness: Harness = { calls: [], verdict: {}, gate: { status: 'checking' } };
(globalThis as unknown as { __payablesAdminHarness: Harness }).__payablesAdminHarness = harness;

const supabaseStub = 'data:text/javascript,' + encodeURIComponent(`
  const h = globalThis.__payablesAdminHarness;
  export const supabase = {
    auth: { getSession: async () => { h.calls.push({ kind: 'session', name: 'getSession' }); return { data: { session: { user: { id: 'u' } } }, error: null }; } },
    rpc: (name, args) => {
      h.calls.push({ kind: 'rpc', name, args });
      return Promise.resolve(name === 'payables_read_v1' ? { data: [], error: null } : { data: { ok: true }, error: null });
    },
  };`);
const targetStub = 'data:text/javascript,' + encodeURIComponent(`
  export function currentPayablesRuntimeVerdict() { return globalThis.__payablesAdminHarness.verdict; }
  export function isRuntimeRefused(v) { return v.allowed === false; }`);
const gateStub = 'data:text/javascript,' + encodeURIComponent(`
  export function usePayablesChequesGate() { return { gate: globalThis.__payablesAdminHarness.gate, refresh() {} }; }`);
register('data:text/javascript,' + encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === '@/integrations/supabase/client') return { shortCircuit: true, url: ${JSON.stringify(supabaseStub)} };
    if (specifier === './payablesRuntimeTarget' && context.parentURL && context.parentURL.includes('payablesChequesService')) {
      return { shortCircuit: true, url: ${JSON.stringify(targetStub)} };
    }
    if (specifier === '@/features/payables-cheques/PayablesChequesGate' && context.parentURL
      && context.parentURL.includes('pages/PayablesCheques')) {
      return { shortCircuit: true, url: ${JSON.stringify(gateStub)} };
    }
    return nextResolve(specifier, context);
  }`));

// Le lanceur de tests compile le JSX en React.createElement (transformation classique).
(globalThis as unknown as { React: typeof React }).React = React;
const { validatePayablesRuntimeTarget } = await import('./payablesRuntimeTarget');
const service = await import('./payablesChequesService');
const { moduleOpening } = await import('./payablesAdminModel');
const { default: PayablesCheques } = await import('../../pages/PayablesCheques');
type Access = Parameters<typeof moduleOpening>[1];

const PROD_URL = 'https://leakcdbbawzysfqyqsnr.supabase.co';
const PROD_ID = 'leakcdbbawzysfqyqsnr';
const STAGING_URL = 'https://gbbsqcscryygqlmqncyv.supabase.co';
const STAGING_ID = 'gbbsqcscryygqlmqncyv';
const FULL_LOCAL = { allowed: true, environment: 'local', mode: 'full' };
const ADMIN_ONLY = { allowed: true, environment: 'production', mode: 'admin-only' };

function reset(verdict: Record<string, unknown>) {
  harness.calls.length = 0;
  harness.verdict = verdict;
}

// --- Garde de cible ----------------------------------------------------------

test('production refusée par défaut, quels que soient les autres drapeaux', () => {
  for (const extra of [{}, { stagingEnabled: 'true' }, { localEnabled: 'true' }, { productionAdminOnly: 'TRUE' },
    { productionAdminOnly: '1' }, { productionAdminOnly: 'true ' }]) {
    const verdict = validatePayablesRuntimeTarget({ supabaseUrl: PROD_URL, projectId: PROD_ID, ...extra });
    assert.deepEqual(verdict, { allowed: false, reason: 'Le module chèques reste interdit en production.' }, JSON.stringify(extra));
  }
});

test('drapeau de build dédié et projet de production exact : administration seule', () => {
  assert.deepEqual(validatePayablesRuntimeTarget({ supabaseUrl: PROD_URL, projectId: PROD_ID, productionAdminOnly: 'true' }),
    { allowed: true, environment: 'production', mode: 'admin-only' });
  assert.deepEqual(validatePayablesRuntimeTarget({ supabaseUrl: `${PROD_URL}/`, projectId: PROD_ID, productionAdminOnly: 'true' }),
    { allowed: true, environment: 'production', mode: 'admin-only' }, 'a trailing slash is the same origin');
});

test('cibles contradictoires : refusées, jamais ramenées à un autre environnement', () => {
  const contradictory = 'La cible de production du module chèques est contradictoire.';
  const cases: Array<Record<string, string | undefined>> = [
    { supabaseUrl: PROD_URL, projectId: STAGING_ID },
    { supabaseUrl: PROD_URL, projectId: undefined },
    { supabaseUrl: STAGING_URL, projectId: PROD_ID },
    { supabaseUrl: 'http://localhost:54321', projectId: PROD_ID },
    { supabaseUrl: `${PROD_URL}/rest/v1`, projectId: PROD_ID },
    { supabaseUrl: `${PROD_URL}:8443`, projectId: PROD_ID },
    { supabaseUrl: 'http://leakcdbbawzysfqyqsnr.supabase.co', projectId: PROD_ID },
    { supabaseUrl: 'https://user:secret@leakcdbbawzysfqyqsnr.supabase.co', projectId: PROD_ID },
    { supabaseUrl: `${PROD_URL}?project=x`, projectId: PROD_ID },
    { supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co.', projectId: PROD_ID },
    { supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co.evil.example', projectId: PROD_ID },
    { supabaseUrl: PROD_URL, projectId: PROD_ID, stagingEnabled: 'true' },
    { supabaseUrl: PROD_URL, projectId: PROD_ID, localEnabled: 'true' },
  ];
  for (const input of cases) {
    assert.deepEqual(validatePayablesRuntimeTarget({ ...input, productionAdminOnly: 'true' }),
      { allowed: false, reason: contradictory }, JSON.stringify(input));
  }
  // Drapeau de production sur une autre cible : refus, ni staging ni local ouverts.
  const reserved = 'Le mode administration seule est réservé au projet de production.';
  assert.deepEqual(validatePayablesRuntimeTarget({ supabaseUrl: STAGING_URL, projectId: STAGING_ID, stagingEnabled: 'true',
    productionAdminOnly: 'true' }), { allowed: false, reason: reserved });
  assert.deepEqual(validatePayablesRuntimeTarget({ supabaseUrl: 'http://localhost:54321', localEnabled: 'true',
    productionAdminOnly: 'true' }), { allowed: false, reason: reserved });
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'https://example.supabase.co', productionAdminOnly: 'true' }).allowed, false);
  // Nom d'hôte suivi d'un point, sans project ID de production : ni production ni staging.
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co.', productionAdminOnly: 'true' }).allowed, false);
  // Variantes d'écriture normalisées par l'analyseur d'URL : même origine, toujours administration seule.
  for (const spelled of ['HTTPS://LEAKCDBBAWZYSFQYQSNR.SUPABASE.CO', 'https://leakcdbbawzysfqyqsnr.supabase.co:443']) {
    assert.deepEqual(validatePayablesRuntimeTarget({ supabaseUrl: spelled, projectId: PROD_ID, productionAdminOnly: 'true' }),
      { allowed: true, environment: 'production', mode: 'admin-only' }, spelled);
    assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: spelled, projectId: PROD_ID }).allowed, false, spelled);
  }
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'not a url', productionAdminOnly: 'true' }).allowed, false);
});

test('non-régression local et staging : module complet, inchangé sans le drapeau', () => {
  assert.deepEqual(validatePayablesRuntimeTarget({ supabaseUrl: STAGING_URL, projectId: STAGING_ID, stagingEnabled: 'true' }),
    { allowed: true, environment: 'staging', mode: 'full' });
  assert.deepEqual(validatePayablesRuntimeTarget({ supabaseUrl: 'http://localhost:54321', localEnabled: 'true' }),
    { allowed: true, environment: 'local', mode: 'full' });
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: STAGING_URL, projectId: STAGING_ID }).allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: `${STAGING_URL}/rest`, projectId: STAGING_ID, stagingEnabled: 'true' }).allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'http://localhost:54321' }).allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'http://localhost:54321', localEnabled: 'true', projectId: STAGING_ID }).allowed, false);
});

// --- Liste blanche du service -------------------------------------------------

const ALLOWED_EXPORTS = [
  'readMyAccess', 'listPersons', 'listPersonLinks', 'listCapabilityGrants', 'listParameters',
  'adminSetCapability', 'adminCreatePerson', 'adminSetPersonLink', 'adminSetParameter', 'adminRejectLegacyProposal',
].sort();
const NOT_A_CALL = new Set(['newCommandKey', 'isAdminOnlyCallAllowed']);
// Argument universel : toute propriété lue vaut « x » ; aucune fonction n'échoue avant le service.
const anyArg = () => new Proxy({}, { get: (_target, key) => (key === 'then' ? undefined : 'x') });
const callableExports = () => Object.entries(service)
  .filter(([name, value]) => typeof value === 'function' && !NOT_A_CALL.has(name)) as Array<[string, (...a: unknown[]) => unknown]>;

test('administration seule : tout appel hors liste blanche est refusé avant la session et le réseau', async () => {
  const reached: string[] = [];
  for (const [name, fn] of callableExports()) {
    reset(ADMIN_ONLY);
    try {
      await fn(anyArg(), anyArg(), anyArg(), anyArg(), anyArg(), anyArg(), anyArg(), anyArg());
      reached.push(name);
      assert.deepEqual(harness.calls.map((c) => c.kind), ['session', 'rpc'], `${name}: session then one call`);
    } catch (error) {
      assert.equal((error as { code?: string }).code, 'PAYABLES_ADMIN_ONLY_CALL_REFUSED', `${name}: ${String(error)}`);
      assert.match((error as Error).message, /seul le panneau d’administration est ouvert/);
      assert.deepEqual(harness.calls, [], `${name}: nothing sent, session not even read`);
    }
  }
  assert.deepEqual(reached.sort(), ALLOWED_EXPORTS);
  assert.ok(callableExports().length > 40, 'the whole service surface is exercised');
});

test('administration seule : appels autorisés exacts, quatre listes sans argument', async () => {
  reset(ADMIN_ONLY);
  await service.readMyAccess();
  await service.listPersons();
  await service.listPersonLinks();
  await service.listCapabilityGrants();
  await service.listParameters();
  const rpcs = harness.calls.filter((c) => c.kind === 'rpc');
  assert.deepEqual(rpcs.map((c) => c.name), ['payables_my_access_v1', 'payables_read_v1', 'payables_read_v1', 'payables_read_v1', 'payables_read_v1']);
  assert.deepEqual(rpcs.slice(1).map((c) => c.args), [
    { p_list: 'persons', p_args: {} }, { p_list: 'person_links', p_args: {} },
    { p_list: 'capability_grants', p_args: {} }, { p_list: 'parameters', p_args: {} },
  ]);
});

test('liste blanche : lecture limitée aux quatre listes, sans argument ni clé supplémentaire', () => {
  const allowed = service.isAdminOnlyCallAllowed;
  for (const list of ['persons', 'person_links', 'capability_grants', 'parameters']) {
    assert.equal(allowed('payables_read_v1', { p_list: list, p_args: {} }), true, list);
  }
  for (const list of ['positions', 'accounts', 'followup_lines', 'payments', 'forms', 'work_queue', 'invoice_overview', 'suppliers', '']) {
    assert.equal(allowed('payables_read_v1', { p_list: list, p_args: {} }), false, list);
  }
  assert.equal(allowed('payables_read_v1', { p_list: 'persons', p_args: { as_of: '2026-10-29' } }), false);
  assert.equal(allowed('payables_read_v1', { p_list: 'persons', p_args: [] }), false);
  assert.equal(allowed('payables_read_v1', { p_list: 'persons', p_args: null }), false);
  assert.equal(allowed('payables_read_v1', { p_list: 'persons' }), false);
  assert.equal(allowed('payables_read_v1', { p_list: 'persons', p_args: {}, p_extra: 1 }), false);
  assert.equal(allowed('payables_read_v1', { p_list: ['persons'], p_args: {} }), false);
  for (const name of ['payables_confirm_issuance_v1', 'payables_create_invoice_v1', 'payables_decide_bank_match_v1',
    'payables_propose_parameter_v1', 'payables_acquire_lock_v1', 'payables_read_v2', 'PAYABLES_MY_ACCESS_V1']) {
    assert.equal(allowed(name, {}), false, name);
  }
});

test('verdict incomplet ou incohérent : liste blanche appliquée (refus par défaut)', async () => {
  for (const verdict of [{ allowed: true, environment: 'local' }, { allowed: true, environment: 'staging', mode: 'other' },
    { allowed: true, environment: 'production', mode: 'full' }]) {
    reset(verdict);
    await assert.rejects(service.listForms(), { code: 'PAYABLES_ADMIN_ONLY_CALL_REFUSED' }, JSON.stringify(verdict));
    assert.deepEqual(harness.calls, []);
  }
  reset({ allowed: false, reason: 'Le module chèques reste interdit en production.' });
  await assert.rejects(service.listPersons(), { code: 'PAYABLES_TARGET_REJECTED' });
  assert.deepEqual(harness.calls, []);
});

test('non-régression du module complet : les appels métier partent comme avant', async () => {
  reset(FULL_LOCAL);
  await service.listForms();
  await service.readAccountPositions('2026-10-29');
  await service.createSupplier('k', 'Fournisseur fictif', 'Motif');
  assert.deepEqual(harness.calls.filter((c) => c.kind === 'rpc').map((c) => c.name),
    ['payables_read_v1', 'payables_read_v1', 'payables_create_supplier_v1']);
});

// --- Décision d'ouverture ------------------------------------------------------

const access = (over: Partial<Access>): Access => ({
  user_id: 'u', capabilities: [], person_id: null, business_writes_enabled: false, export_enabled: false,
  governance_model: 'SINGLE_ADMIN', admin_configured: true, is_admin: false, ...over,
});

test('administration seule : ouverte au seul administrateur reconnu par le serveur', () => {
  assert.deepEqual(moduleOpening('admin-only', access({ is_admin: true, capabilities: ['READ'] })), { open: true });
  const refused = moduleOpening('admin-only', access({ capabilities: ['READ', 'AUDIT', 'SUPPLIER_MANAGE', 'CHEQUE_CONFIRM_ISSUE'] }));
  assert.equal(refused.open, false, 'an accountant with every reading right stays outside');
  assert.match((refused as { reason: string }).reason, /réservé à l’administrateur désigné/);
  assert.equal(moduleOpening('admin-only', access({ admin_configured: false, is_admin: true })).open, false,
    'no administrator configured: nobody is recognized');
  assert.equal(moduleOpening('admin-only', access({ admin_configured: false })).open, false);
  // Booléens stricts : une valeur « vraie » d'un autre type ne suffit pas.
  for (const odd of ['true', 1, {}]) {
    assert.equal(moduleOpening('admin-only', access({ is_admin: odd as unknown as boolean })).open, false, JSON.stringify(odd));
    assert.equal(moduleOpening('admin-only', access({ is_admin: true, admin_configured: odd as unknown as boolean })).open, false);
  }
});

test('module complet : ouverture inchangée sur lecture ou audit', () => {
  assert.deepEqual(moduleOpening('full', access({ capabilities: ['READ'] })), { open: true });
  assert.deepEqual(moduleOpening('full', access({ capabilities: ['AUDIT'] })), { open: true });
  assert.equal(moduleOpening('full', access({ capabilities: ['SUPPLIER_MANAGE'] })).open, false);
});

// --- Page ----------------------------------------------------------------------

function renderPage(gate: unknown): string {
  harness.gate = gate;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}><PayablesCheques /></QueryClientProvider>);
}

test('page : administration seule sans onglet ni autre panneau ; module complet inchangé', () => {
  reset(ADMIN_ONLY);
  const admin = access({ is_admin: true, capabilities: ['READ'] });
  const adminOnly = renderPage({ status: 'allowed', access: admin, mode: 'admin-only' });
  assert.match(adminOnly, /Administration du module chèques/);
  assert.match(adminOnly, /Production : administration seule/);
  assert.match(adminOnly, /Créer la personne/);
  assert.doesNotMatch(adminOnly, /role="tab"|File de travail|Suivi bancaire|Reprise/);
  reset(FULL_LOCAL);
  const full = renderPage({ status: 'allowed', access: admin, mode: 'full' });
  for (const label of ['Position', 'File de travail', 'Factures', 'Chèques', 'Suivi bancaire', 'Exceptions', 'Reprise', 'Paramètres']) {
    assert.match(full, new RegExp(`role="tab"[^>]*>${label}<`), label);
  }
  assert.equal(renderPage({ status: 'blocked', reason: 'Réservé.' }), '');
  assert.equal(renderPage({ status: 'checking' }), '');
});
