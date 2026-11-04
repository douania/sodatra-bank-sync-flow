import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Doubles injectés au niveau du chargement des modules (hook de résolution
// Node), jamais par une option de production : le client Supabase enregistre
// chaque appel ; la cible vue par le service, la route et le menu est fournie
// par le test, et calculée par la VRAIE garde (importée sans double).
type Call = { kind: 'rpc' | 'from' | 'session'; name: string; args?: Record<string, unknown> };
interface Harness {
  calls: Call[];
  verdict: unknown;
  rpcResult: (name: string) => { data: unknown; error: unknown };
  auth: { user: { id: string } | null; loading: boolean };
}
const harness: Harness = {
  calls: [],
  verdict: { allowed: false, reason: 'non initialisé' },
  rpcResult: () => ({ data: null, error: null }),
  auth: { user: null, loading: false },
};
(globalThis as unknown as { __treasuryHarness: Harness }).__treasuryHarness = harness;

const supabaseStub = 'data:text/javascript,' + encodeURIComponent(`
  const h = globalThis.__treasuryHarness;
  export const supabase = {
    auth: { getSession: async () => { h.calls.push({ kind: 'session', name: 'getSession' }); return { data: { session: null }, error: null }; } },
    rpc: (name, args) => { h.calls.push({ kind: 'rpc', name, args }); return Promise.resolve(h.rpcResult(name)); },
    from: (table) => { h.calls.push({ kind: 'from', name: table }); throw new Error('table access forbidden in treasury'); },
  };`);
const targetStub = 'data:text/javascript,' + encodeURIComponent(`
  export function currentTreasuryRuntimeVerdict() { return globalThis.__treasuryHarness.verdict; }
  export function isTreasuryRuntimeRefused(v) { return v.allowed === false; }`);
const authStub = 'data:text/javascript,' + encodeURIComponent(`
  export function useAuth() { return globalThis.__treasuryHarness.auth; }`);
register('data:text/javascript,' + encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === '@/integrations/supabase/client') return { shortCircuit: true, url: ${JSON.stringify(supabaseStub)} };
    if (specifier === '@/contexts/AuthContext') return { shortCircuit: true, url: ${JSON.stringify(authStub)} };
    if (specifier === './treasuryRuntimeTarget' && context.parentURL
      && ['/treasuryService.ts', '/TreasuryRoute.tsx', '/treasuryMenu.ts'].some((suffix) => context.parentURL.split('?')[0].endsWith(suffix))) {
      return { shortCircuit: true, url: ${JSON.stringify(targetStub)} };
    }
    return nextResolve(specifier, context);
  }`));

(globalThis as unknown as { React: typeof React }).React = React;
const { validateTreasuryRuntimeTarget } = await import('./treasuryRuntimeTarget');
const service = await import('./treasuryService');
const { TreasuryRoute } = await import('./TreasuryRoute');
const { isTreasuryMenuVisible } = await import('./treasuryMenu');
const { parseTreasuryBalances, TreasuryError } = await import('./treasuryModel');
const { TreasuryVerifiedStartAdmin } = await import('./TreasuryVerifiedStartAdmin');

const PROD = { supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co', projectId: 'leakcdbbawzysfqyqsnr' };
const LOCAL = { supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true' };

function reset(target: Record<string, string>) {
  harness.calls.length = 0;
  harness.verdict = validateTreasuryRuntimeTarget(target);
  harness.rpcResult = () => ({ data: null, error: null });
  harness.auth = { user: { id: '10000000-0000-4000-8000-00000000000a' }, loading: false };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof TreasuryError && error.code === code);
}

test('production : lecture et administration refusées avant tout appel réseau', async () => {
  for (const target of [PROD, { ...PROD, localEnabled: 'true', stagingEnabled: 'true' }, { ...PROD, productionAdminOnly: 'true' }]) {
    reset(target);
    await rejectsWith(service.fetchTreasuryBalances('2026-10-07'), 'TREASURY_RUNTIME_REFUSED');
    const key = service.newTreasuryCommandKey();
    await rejectsWith(service.attestInventory(key, 'a'.repeat(64), 'Motif synthétique'), 'TREASURY_RUNTIME_REFUSED');
    await rejectsWith(service.addRegistryAccountToInventory(key, '20000000-0000-4000-8000-000000000001', 'Motif synthétique'),
      'TREASURY_RUNTIME_REFUSED');
    await rejectsWith(service.addUnregisteredAccountToInventory(key, { bank: 'NSIA', currency: 'XOF', alias: 'NSIA', reason: 'Motif synthétique' }),
      'TREASURY_RUNTIME_REFUSED');
    await rejectsWith(service.linkExpectedAccount(key, 'a', 'b', 'Motif synthétique'), 'TREASURY_RUNTIME_REFUSED');
    await rejectsWith(service.retireExpectedAccount(key, 'a', 'Motif synthétique'), 'TREASURY_RUNTIME_REFUSED');
    await rejectsWith(service.setVerifiedStart(key, { registryAccountId: 'a', day: '2026-10-07',
      unit: { canonicalUnitId: 'b', contentHash: 'c' }, verifiedOpening: '1300', evidenceRef: 'PIECE', reason: 'Motif synthétique' }),
    'TREASURY_RUNTIME_REFUSED');
    await rejectsWith(service.revokeVerifiedStart(key, 'a', 'Motif synthétique'), 'TREASURY_RUNTIME_REFUSED');
    assert.deepEqual(harness.calls, [], JSON.stringify(target));
  }
});

test('production : la route affiche le refus sans monter la page, le menu est masqué', () => {
  reset(PROD);
  const client = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><TreasuryRoute /></QueryClientProvider>);
  assert.match(html, /Soldes à date non disponibles/);
  assert.match(html, /n’est pas ouverte en production/);
  assert.doesNotMatch(html, /Date comptable D/);
  assert.equal(isTreasuryMenuVisible(), false);
  assert.deepEqual(harness.calls, []);
});

test('local autorisé : la route monte la page et le menu est visible', () => {
  reset(LOCAL);
  const client = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><TreasuryRoute /></QueryClientProvider>);
  assert.match(html, /Soldes à date/);
  assert.match(html, /Date comptable D/);
  assert.equal(isTreasuryMenuVisible(), true);
});

test('local sans session : la page s’affiche sans aucune lecture', async () => {
  reset(LOCAL);
  harness.auth = { user: null, loading: false };
  const client = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><TreasuryRoute /></QueryClientProvider>);
  assert.match(html, /Date comptable D/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(harness.calls, []);
  assert.equal(client.getQueryCache().getAll().every((entry) => entry.state.data === undefined), true);
  client.clear();
});

test('lecture : un seul appel, à la fonction de trésorerie, avec la date D', async () => {
  reset(LOCAL);
  harness.rpcResult = () => ({ data: { contract: 'autre' }, error: null });
  await rejectsWith(service.fetchTreasuryBalances('2026-10-07'), 'TREASURY_RESPONSE_INVALID');
  assert.deepEqual(harness.calls, [{ kind: 'rpc', name: 'treasury_balances_at_v1', args: { p_as_of: '2026-10-07' } }]);
});

test('date invalide refusée avant tout appel', async () => {
  reset(LOCAL);
  for (const bad of ['', '07/10/2026', '2026-10-7', '2026-10-07T00:00:00Z']) {
    await rejectsWith(service.fetchTreasuryBalances(bad), 'TREASURY_AS_OF_REQUIRED');
  }
  assert.deepEqual(harness.calls, []);
});

test('erreurs serveur : codes fermés, aucun message brut', async () => {
  reset(LOCAL);
  harness.rpcResult = () => ({ data: null, error: { message: 'PAYABLES_CAPABILITY_REQUIRED:BANK_READ' } });
  await assert.rejects(service.fetchTreasuryBalances('2026-10-07'), (error: unknown) =>
    error instanceof TreasuryError && error.code === 'PAYABLES_CAPABILITY_REQUIRED:BANK_READ'
    && /BANK_READ/.test(error.message));
  harness.rpcResult = () => ({ data: null, error: { message: 'relation "treasury_private.x" does not exist' } });
  await assert.rejects(service.fetchTreasuryBalances('2026-10-07'), (error: unknown) =>
    error instanceof TreasuryError && error.code === 'TREASURY_REQUEST_FAILED' && !/treasury_private/.test(error.message));
});

test('administration : une clé par décision, rejouée à l’identique sur double envoi, aucune table lue', async () => {
  reset(LOCAL);
  harness.rpcResult = () => ({ data: { ok: true }, error: null });
  const keeper = service.createCommandKeyKeeper();
  const attest = JSON.stringify(['attest', 'b'.repeat(64), 'Motif synthétique']);
  // Double clic : deux envois de la même décision avant son succès.
  const first = keeper.keyFor(attest);
  const second = keeper.keyFor(attest);
  await Promise.all([first, second].map((key) => service.attestInventory(key, 'b'.repeat(64), 'Motif synthétique')));
  keeper.succeeded(first);
  // Décision suivante, même contenu : nouvelle décision, nouvelle clé.
  const third = keeper.keyFor(attest);
  // Une autre décision envoyée entre-temps (réponse perdue) ne fait pas oublier
  // la clé de la décision encore en attente.
  const other = keeper.keyFor(JSON.stringify(['add-unregistered', 'NSIA', 'XOF', 'NSIA principal', 'Motif synthétique']));
  await service.addUnregisteredAccountToInventory(other,
    { bank: 'NSIA', currency: 'XOF', alias: 'NSIA principal', reason: 'Motif synthétique' });
  assert.equal(keeper.keyFor(attest), third);
  keeper.succeeded(other);
  assert.equal(keeper.keyFor(attest), third);
  const keys = harness.calls.map((call) => call.args?.p_command_key as string);
  assert.deepEqual(keys, [first, first, other]);
  assert.notEqual(third, first);
  assert.notEqual(other, third);
  for (const key of [first, third, other]) assert.match(key, /^treasury:[0-9a-f-]{36}$/);
  // La page garde ses décisions en attente au niveau du module (panneau masqué puis réaffiché).
  assert.equal(service.inventoryCommandKeys.keyFor(attest), service.inventoryCommandKeys.keyFor(attest));
  assert.deepEqual(harness.calls.map((call) => call.name), [
    'treasury_admin_attest_inventory_v1', 'treasury_admin_attest_inventory_v1', 'treasury_admin_add_expected_account_v1',
  ]);
  assert.ok(harness.calls.every((call) => call.kind === 'rpc'));
});

test('lecture liée à la session : utilisateur dans la clé, aucun cache conservé, rien sans session', async () => {
  reset(LOCAL);
  const a = service.treasuryBalancesQuery('10000000-0000-4000-8000-00000000000a', '2026-10-07');
  const b = service.treasuryBalancesQuery('10000000-0000-4000-8000-00000000000b', '2026-10-07');
  assert.notDeepEqual(a.queryKey, b.queryKey);
  assert.deepEqual(a.queryKey, ['treasury-balances', '10000000-0000-4000-8000-00000000000a', '2026-10-07']);
  assert.equal(a.gcTime, 0);
  assert.equal(a.staleTime, 0);
  assert.equal(a.enabled, true);
  const anonymous = service.treasuryBalancesQuery(null, '2026-10-07');
  assert.equal(anonymous.enabled, false);
  assert.deepEqual(harness.calls, []);
});

test('points de départ : appel RPC seul, unité et empreinte affichées transmises, aucune table lue', async () => {
  reset(LOCAL);
  harness.rpcResult = () => ({ data: { verified_start_id: '60000000-0000-4000-8000-000000000001' }, error: null });
  const key = service.verifiedStartCommandKeys.keyFor(JSON.stringify(['set-verified-start', 'synthétique']));
  await service.setVerifiedStart(key, {
    registryAccountId: '20000000-0000-4000-8000-000000000001', day: '2026-10-07',
    unit: { canonicalUnitId: '40000000-0000-4000-8000-000000000007', contentHash: 'c'.repeat(64) },
    verifiedOpening: '1300', evidenceRef: 'PIECE-SYNTH-1', reason: 'Motif synthétique',
  });
  await service.revokeVerifiedStart(key, '60000000-0000-4000-8000-000000000001', 'Motif synthétique');
  assert.deepEqual(harness.calls, [
    { kind: 'rpc', name: 'treasury_admin_set_verified_start_v1', args: {
      p_command_key: key, p_registry_account_id: '20000000-0000-4000-8000-000000000001', p_day: '2026-10-07',
      p_canonical_unit_id: '40000000-0000-4000-8000-000000000007', p_content_hash: 'c'.repeat(64),
      p_verified_opening: '1300', p_evidence_ref: 'PIECE-SYNTH-1', p_reason: 'Motif synthétique' } },
    { kind: 'rpc', name: 'treasury_admin_revoke_verified_start_v1', args: {
      p_command_key: key, p_verified_start_id: '60000000-0000-4000-8000-000000000001', p_reason: 'Motif synthétique' } },
  ]);
  harness.rpcResult = () => ({ data: null, error: { message: 'TREASURY_VERIFIED_START_NOT_EFFECTIVE' } });
  await assert.rejects(service.revokeVerifiedStart(key, 'x', 'Motif synthétique'), (error: unknown) =>
    error instanceof TreasuryError && error.code === 'TREASURY_VERIFIED_START_NOT_EFFECTIVE'
    && /rien n’a été enregistré/.test(error.message));
});

test('panneau des points de départ : unité de la date lue seulement, ouverture jamais affichée ni préremplie', () => {
  reset(LOCAL);
  const unitSource = (unit: string, day: string, hash: string) => ({ kind: 'CANONICAL_UNIT', role: 'CLOSING', unit_id: unit,
    export_id: '50000000-0000-4000-8000-000000000001', day, ingested_at: null, export_ingested_at: null,
    source_format: 'structured_bank_statement_csv', content_hash: hash });
  const base = {
    bank: 'ORA', currency: 'XOF', status: 'NOT_COVERED', reasons: ['CHAIN_UNPROVEN'], balance_at_date: null,
    observed_balance: { balance: '987654.00', date: '2026-10-07' }, source_format: 'structured_bank_statement_csv',
    qualification: 'QUALIFIED', qualification_evidence: null,
    dates: { bank_date_covered: null, age_days: null, bank_date_observed: '2026-10-07', balance_source_day: '2026-10-07' },
    verified_starts: [], findings: [], counters: { rejected_deliveries: 0, refuted_versions: 0 },
    value_dates: { total_lines: 0, lines_with_value_date: 0 },
  };
  const retained = (unit: string, hash: string) => ({ unit_id: unit, content_hash: hash });
  const parsed = parseTreasuryBalances({
    contract: 'treasury_balances_at_v1', as_of: '2026-10-07', today: '2026-11-03', read_at: '2026-11-03T10:00:00+00:00',
    timezone: 'Africa/Dakar', basis: 'ACCOUNTING_DATE', value_date_window_days: 90,
    inventory: { fingerprint: 'a'.repeat(64), active_accounts: 2, attested: true, attested_at: null, unlisted_registry_accounts: [] },
    accounts: [
      { ...base, expected_account_id: '30000000-0000-4000-8000-000000000001',
        registry_account_id: '20000000-0000-4000-8000-000000000001', alias: 'ORA principal',
        sources: [unitSource('40000000-0000-4000-8000-000000000007', '2026-10-07', 'c'.repeat(64))],
        retained_unit_at_date: retained('40000000-0000-4000-8000-000000000007', 'c'.repeat(64)) },
      { ...base, expected_account_id: '30000000-0000-4000-8000-000000000002',
        registry_account_id: '20000000-0000-4000-8000-000000000002', alias: 'ORA second',
        sources: [unitSource('40000000-0000-4000-8000-000000000005', '2026-10-05', 'd'.repeat(64))],
        retained_unit_at_date: null },
    ],
    consolidation: { currency: 'XOF', status: 'PARTIAL', amount: null, accounts_expected: 2, accounts_available: 0,
      accounts_not_covered: 2, accounts_blocked: 0, accounts_out_of_scope: 0, registry_accounts_outside_inventory: 0,
      reasons: ['ACCOUNTS_NOT_COVERED'] },
  });
  const html = renderToStaticMarkup(<TreasuryVerifiedStartAdmin result={parsed} onChanged={() => undefined} />);
  assert.match(html, /Poser un point de départ au 2026-10-07/);
  assert.match(html, /ORA principal/);
  assert.doesNotMatch(html, /ORA second/, 'journée source antérieure à D : compte non proposé');
  assert.doesNotMatch(html, /987654|987 654/, 'aucun solde affiché ni prérempli');
  assert.match(html, /placeholder="Ouverture lue sur la pièce, francs XOF entiers" value=""/);
  assert.deepEqual(harness.calls, [], 'aucun appel au rendu');
});
