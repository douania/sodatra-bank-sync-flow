import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Doubles injectés au niveau du chargement des modules (hook de résolution
// Node), jamais par une option de l'API de production : le client Supabase et
// la cible d'exécution sont remplacés avant le premier import du service.
type Call = { kind: 'rpc' | 'from' | 'session' | 'range'; name: string; args?: Record<string, unknown>; range?: number[] };
type Result = { data: unknown; error: unknown; count?: number | null };
interface Harness {
  calls: Call[];
  verdict: { allowed: boolean; environment?: string; mode?: string; reason?: string };
  session: { data: { session: unknown }; error: unknown };
  rpcResult: (name: string, range: number[] | null) => Result;
  tableResult: (table: string, range: number[]) => Result;
}
const harness: Harness = {
  calls: [],
  verdict: { allowed: true, environment: 'local', mode: 'full' },
  session: { data: { session: { user: { id: 'u' } } }, error: null },
  rpcResult: () => ({ data: { ok: true }, error: null }),
  tableResult: () => ({ data: [], error: null, count: 0 }),
};
(globalThis as unknown as { __payablesHarness: Harness }).__payablesHarness = harness;

const supabaseStub = 'data:text/javascript,' + encodeURIComponent(`
  const h = globalThis.__payablesHarness;
  export const supabase = {
    auth: { getSession: async () => { h.calls.push({ kind: 'session', name: 'getSession' }); return h.session; } },
    rpc: (name, args) => {
      h.calls.push({ kind: 'rpc', name, args });
      return {
        then: (resolve, reject) => Promise.resolve(h.rpcResult(name, null)).then(resolve, reject),
        range: async (from, to) => { h.calls.push({ kind: 'range', name, range: [from, to] }); return h.rpcResult(name, [from, to]); },
      };
    },
    from: (table) => {
      h.calls.push({ kind: 'from', name: table });
      const chain = {
        select: () => chain,
        order: () => chain,
        range: async (from, to) => { h.calls.push({ kind: 'range', name: table, range: [from, to] }); return h.tableResult(table, [from, to]); },
      };
      return chain;
    },
  };`);
const targetStub = 'data:text/javascript,' + encodeURIComponent(`
  export function currentPayablesRuntimeVerdict() { return globalThis.__payablesHarness.verdict; }
  export function isRuntimeRefused(v) { return v.allowed === false; }`);
register('data:text/javascript,' + encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === '@/integrations/supabase/client') return { shortCircuit: true, url: ${JSON.stringify(supabaseStub)} };
    if (specifier === './payablesRuntimeTarget' && context.parentURL && context.parentURL.includes('payablesChequesService')) {
      return { shortCircuit: true, url: ${JSON.stringify(targetStub)} };
    }
    return nextResolve(specifier, context);
  }`));

const service = await import('./payablesChequesService');

function reset() {
  harness.calls.length = 0;
  harness.verdict = { allowed: true, environment: 'local', mode: 'full' };
  harness.session = { data: { session: { user: { id: 'u' } } }, error: null };
  harness.rpcResult = () => ({ data: { ok: true }, error: null });
  harness.tableResult = () => ({ data: [], error: null, count: 0 });
}

function rowsFor(range: number[], total: number): Array<{ id: number }> {
  const rows: Array<{ id: number }> = [];
  for (let i = range[0]; i <= Math.min(range[1], total - 1); i += 1) rows.push({ id: i });
  return rows;
}

test('cible refusée : aucune session lue, aucun appel réseau', async () => {
  reset();
  harness.verdict = { allowed: false, reason: 'Le module chèques reste interdit en production.' };
  await assert.rejects(service.readMyAccess(), { code: 'PAYABLES_TARGET_REJECTED' });
  await assert.rejects(service.createSupplier('k-1', 'Fournisseur', 'Motif'), { code: 'PAYABLES_TARGET_REJECTED' });
  await assert.rejects(service.listForms(), { code: 'PAYABLES_TARGET_REJECTED' });
  assert.deepEqual(harness.calls, []);
});

test('sans session : refus avant tout RPC', async () => {
  reset();
  harness.session = { data: { session: null }, error: null };
  await assert.rejects(service.confirmIssuance('k-2', 'f', 3, '2026-10-25', false), { code: 'PAYABLES_AUTH_REQUIRED' });
  assert.deepEqual(harness.calls.map((c) => c.kind), ['session']);
});

test('les appels atteignent exactement la RPC prévue avec ses paramètres', async () => {
  reset();
  await service.createChequeRequest('k-3', {
    invoiceId: 'i', accountId: 'a', category: 'ALL_PAYMENTS', amount: 999, partial: false, beneficiary: 'B', reason: 'R',
  });
  await service.declareTransfer('k-4', {
    invoiceId: 'i', accountId: 'a', category: 'ALL_PAYMENTS', amount: 10, bankReference: 'V', status: 'COMMITTED',
    executedOn: '2026-10-01', evidenceRef: 'E', reason: 'R',
  });
  const rpcs = harness.calls.filter((c) => c.kind === 'rpc');
  assert.equal(rpcs.length, 2);
  assert.equal(rpcs[0].name, 'payables_create_cheque_request_v1');
  assert.equal(rpcs[0].args?.p_amount, null, 'default single payment never sends a client amount');
  assert.equal(rpcs[0].args?.p_partial, false);
  assert.equal(rpcs[1].name, 'payables_declare_transfer_v1');
  assert.equal(rpcs[1].args?.p_executed_on, null, 'a committed transfer carries no execution date');
});

test('l’intention d’impression n’enregistre jamais de résultat à la place du comptable', async () => {
  reset();
  await service.recordPrintIntent('k-5', 'f', 2, 'c', 'Impression');
  const rpcs = harness.calls.filter((c) => c.kind === 'rpc').map((c) => c.name);
  assert.deepEqual(rpcs, ['payables_record_print_intent_v1']);
});

test('refus serveur : vocabulaire fermé, aucune donnée sentinelle restituée', async () => {
  reset();
  harness.rpcResult = () => ({ data: null, error: { message: 'PAYABLES_INVOICE_BLOCKED SENTINELLE-FOURNISSEUR 123456789' } });
  await assert.rejects(service.createInvoice('k-6', {
    supplierId: 's', reference: 'SENTINELLE', amount: 123456789, invoiceDate: null, dueDate: null, evidenceRef: 'E',
  }), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'PAYABLES_INVOICE_BLOCKED');
    assert.doesNotMatch(error.message, /SENTINELLE|123456789/);
    return true;
  });
  harness.rpcResult = () => ({ data: null, error: { message: 'connection reset SENTINELLE' } });
  await assert.rejects(service.readWorkQueue(), (error: Error) => {
    assert.doesNotMatch(error.message, /SENTINELLE/);
    return true;
  });
});

test('une liste = un seul appel serveur, un seul instantané (aucune pagination)', async () => {
  reset();
  // Deux états successifs du serveur, à nombre de lignes constant : entre les
  // deux, une ligne a changé de place (échéance) et un montant a changé.
  const before = [
    { invoice_id: 'a', due_date: '2026-11-01', amount: 1000, remaining_amount: 1000, currency: 'XOF', blocked: false },
    { invoice_id: 'b', due_date: '2026-11-15', amount: 2000, remaining_amount: 2000, currency: 'XOF', blocked: false },
    { invoice_id: 'c', due_date: '2026-12-01', amount: 3000, remaining_amount: 3000, currency: 'XOF', blocked: false },
  ];
  const after = [before[1], { ...before[0], due_date: '2026-12-15', amount: 1500, remaining_amount: 1500 }, before[2]];
  let call = 0;
  harness.rpcResult = (name) => {
    assert.equal(name, 'payables_read_v1');
    call += 1;
    return { data: call === 1 ? before : after, error: null };
  };
  const first = await service.readInvoiceOverview();
  assert.equal(harness.calls.filter((c) => c.kind === 'rpc').length, 1, 'exactly one server call per list');
  assert.equal(harness.calls.filter((c) => c.kind === 'range').length, 0, 'no pagination');
  assert.deepEqual(first, before, 'the list is exactly one server snapshot');
  assert.deepEqual(new Set(first.map((r) => r.invoice_id)).size, first.length, 'no row repeated');
  assert.equal(first.reduce((sum, r) => sum + r.amount, 0), 6000, 'totals come from that single snapshot');
  const second = await service.readInvoiceOverview();
  assert.deepEqual(second, after, 'the next read is the next snapshot, never a mix');
  assert.equal(second.reduce((sum, r) => sum + r.amount, 0), 6500);
});

test('lecture : liste et arguments transmis au serveur, réponse non conforme refusée', async () => {
  reset();
  harness.rpcResult = () => ({ data: [], error: null });
  await service.listForms();
  await service.readAccountPositions('2026-10-02');
  await service.readBankFollowupLines('acc', '2026-10-01', '2026-10-05');
  assert.deepEqual(harness.calls.filter((c) => c.kind === 'rpc').map((c) => c.args), [
    { p_list: 'forms', p_args: {} },
    { p_list: 'positions', p_args: { as_of: '2026-10-02' } },
    { p_list: 'followup_lines', p_args: { account_id: 'acc', from: '2026-10-01', to: '2026-10-05' } },
  ]);
  reset();
  harness.rpcResult = () => ({ data: { rows: [] }, error: null });
  await assert.rejects(service.listExceptions(), { code: 'PAYABLES_READ_INCOMPLETE' });
  reset();
  harness.rpcResult = () => ({ data: null, error: { message: 'PAYABLES_READ_LIMIT_EXCEEDED' } });
  await assert.rejects(service.listExceptions(), { code: 'PAYABLES_READ_LIMIT_EXCEEDED' });
});

test('les clés de commande sont uniques par intention', () => {
  const a = service.newCommandKey('scope');
  const b = service.newCommandKey('scope');
  assert.notEqual(a, b);
  assert.match(a, /^scope:[0-9a-f-]{36}$/);
});

test('administration : RPC exactes, aucune identité ni autorité transmise par le client', async () => {
  reset();
  await service.adminSetCapability('k-7', 'u-target', 'CHEQUE_PREPARE_PRINT', true, 'Rôle opérationnel');
  await service.adminCreatePerson('k-8', 'Comptable fictif', 'Création');
  await service.adminSetPersonLink('k-9', 'p', 'u-target', false, 'Retrait');
  await service.adminSetParameter('k-10', {
    kind: 'CATEGORY', subjectKey: 'ALL_PAYMENTS', validFrom: '2026-11-01', payload: { code: 'ALL_PAYMENTS' }, evidenceRef: null,
    expectedVersionNo: 3, reason: 'Nouvelle version',
  });
  await service.adminRejectLegacyProposal('k-11', 'PARAMETER', 'v', 'Proposition héritée close');
  const rpcs = harness.calls.filter((c) => c.kind === 'rpc');
  assert.deepEqual(rpcs.map((c) => c.name), [
    'payables_admin_set_capability_v1', 'payables_admin_create_person_v1', 'payables_admin_set_person_link_v1',
    'payables_admin_set_parameter_v1', 'payables_admin_reject_legacy_proposal_v1',
  ]);
  assert.deepEqual(rpcs[0].args, {
    p_command_key: 'k-7', p_user_id: 'u-target', p_capability: 'CHEQUE_PREPARE_PRINT', p_grant: true, p_reason: 'Rôle opérationnel',
  });
  assert.equal(rpcs[2].args?.p_link, false);
  assert.equal(rpcs[3].args?.p_expected_version_no, 3, 'the known version travels with every parameter change');
  for (const call of rpcs) {
    for (const key of Object.keys(call.args ?? {})) {
      assert.doesNotMatch(key, /actor|admin|role|email|claim|metadata|session/, `${call.name} sends no caller identity (${key})`);
    }
  }
  // Session lue avant chaque appel : l'autorité est déterminée par le serveur.
  assert.equal(harness.calls.filter((c) => c.kind === 'session').length, 5);
});

test('administration : cible refusée ou session absente, aucun appel réseau', async () => {
  reset();
  harness.verdict = { allowed: false, reason: 'Le module chèques reste interdit en production.' };
  await assert.rejects(service.adminSetCapability('k-12', 'u', 'READ', true, 'Motif'), { code: 'PAYABLES_TARGET_REJECTED' });
  assert.deepEqual(harness.calls, []);
  reset();
  harness.session = { data: { session: null }, error: null };
  await assert.rejects(service.adminCreatePerson('k-13', 'Personne', 'Motif'), { code: 'PAYABLES_AUTH_REQUIRED' });
  assert.deepEqual(harness.calls.map((c) => c.kind), ['session']);
});

test('administration : refus serveur traduit en vocabulaire fermé', async () => {
  reset();
  harness.rpcResult = () => ({ data: null, error: { message: 'PAYABLES_ADMIN_REQUIRED détail interne SENTINELLE' } });
  await assert.rejects(service.adminSetCapability('k-14', 'u', 'READ', true, 'Motif'), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'PAYABLES_ADMIN_REQUIRED');
    assert.equal(error.message, 'Seul l’administrateur du module peut faire cette modification.');
    return true;
  });
});

test('l’ancienne gouvernance à deux acteurs n’est plus appelée par le client', () => {
  for (const legacy of ['proposeCapability', 'decideCapability', 'proposePerson', 'decidePerson', 'proposePersonLink',
    'decidePersonLink', 'proposeParameter', 'decideParameter']) {
    assert.equal((service as Record<string, unknown>)[legacy], undefined, `${legacy} removed`);
  }
});
