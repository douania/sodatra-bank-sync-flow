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
  verdict: { allowed: boolean; environment?: string; reason?: string };
  session: { data: { session: unknown }; error: unknown };
  rpcResult: (name: string, range: number[] | null) => Result;
  tableResult: (table: string, range: number[]) => Result;
}
const harness: Harness = {
  calls: [],
  verdict: { allowed: true, environment: 'local' },
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
  harness.verdict = { allowed: true, environment: 'local' };
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

test('lectures paginées jusqu’à la totalité, sans troncature silencieuse', async () => {
  reset();
  harness.tableResult = (_table, range) => ({ data: rowsFor(range, 2500), error: null, count: 2500 });
  const forms = await service.listForms();
  assert.equal(forms.length, 2500);
  assert.deepEqual(harness.calls.filter((c) => c.kind === 'range').map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  reset();
  harness.rpcResult = (_name, range) => (range ? { data: rowsFor(range, 1500), error: null, count: 1500 } : { data: [], error: null });
  assert.equal((await service.readWorkQueue()).length, 1500, 'RPC lists are paginated too');
});

test('lecture incomplète explicite : compte absent, modifié, excessif ou page vide', async () => {
  reset();
  harness.tableResult = (_t, range) => ({ data: rowsFor(range, 1500), error: null, count: null });
  await assert.rejects(service.listExceptions(), { code: 'PAYABLES_READ_INCOMPLETE' });
  reset();
  let calls = 0;
  harness.tableResult = (_t, range) => ({ data: rowsFor(range, 1500), error: null, count: calls++ === 0 ? 1500 : 1501 });
  await assert.rejects(service.listExceptions(), { code: 'PAYABLES_READ_INCOMPLETE' }, 'data changed during the read');
  reset();
  harness.tableResult = (_t, range) => ({ data: rowsFor(range, 60_000), error: null, count: 60_000 });
  await assert.rejects(service.listExceptions(), { code: 'PAYABLES_READ_INCOMPLETE' });
  assert.equal(harness.calls.filter((c) => c.kind === 'range').length, 1, 'stops at the first page when over the bound');
  reset();
  harness.tableResult = (_t, range) => ({ data: range[0] === 0 ? rowsFor(range, 1500) : [], error: null, count: 1500 });
  await assert.rejects(service.listExceptions(), { code: 'PAYABLES_READ_INCOMPLETE' }, 'premature empty page');
});

test('les clés de commande sont uniques par intention', () => {
  const a = service.newCommandKey('scope');
  const b = service.newCommandKey('scope');
  assert.notEqual(a, b);
  assert.match(a, /^scope:[0-9a-f-]{36}$/);
});
