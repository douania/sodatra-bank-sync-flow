import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

// Revue staging, filtre de compte (pack DAILY-V2-BDK-ORABANK-OPERATIONAL-READINESS, B).
// Le VRAI service et le VRAI client supabase-js construisent la requête ; seul le réseau est doublé :
// un fetch enregistreur répond comme PostgREST (lignes + Content-Range). On prouve ainsi, sur la requête
// HTTP réellement émise, que le compte est filtré côté serveur avec la pagination et le décompte exact.
// Doubles injectés au chargement (hook Node), jamais par une option de l'API de production. Données fictives.

interface RecordedRequest { url: URL; method: string; headers: Record<string, string> }
const recorded: RecordedRequest[] = [];
let nextResponse: { rows: unknown[]; total: number; offset: number } = { rows: [], total: 0, offset: 0 };

const syntheticFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => { headers[key.toLowerCase()] = value; });
  recorded.push({ url, method: init?.method ?? 'GET', headers });
  const { rows, total, offset } = nextResponse;
  const end = rows.length === 0 ? '*' : `${offset}-${offset + rows.length - 1}`;
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-range': rows.length === 0 ? `*/${total}` : `${end}/${total}` },
  });
};

const testGlobal = globalThis as unknown as Record<string, unknown>;
testGlobal.__dv2SyntheticSupabase = createClient('https://synthetic-project.supabase.co', 'synthetic-public-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: syntheticFetch },
});

const stub = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const replacements: Record<string, string> = {
  '@/integrations/supabase/client': stub('export const supabase = globalThis.__dv2SyntheticSupabase;'),
  './dailyV2RuntimeTarget': stub(
    'export function currentDailyV2RuntimeTargetVerdict() { return { allowed: true, projectRef: "synthetic-project" }; }'),
};
register(stub(`
  const replacements = ${JSON.stringify(replacements)};
  export function resolve(specifier, context, nextResolve) {
    if ((context.parentURL || '').includes('/src/features/daily-v2/dailyV2SupabaseService.ts')
      && Object.prototype.hasOwnProperty.call(replacements, specifier)) {
      return { shortCircuit: true, url: replacements[specifier] };
    }
    return nextResolve(specifier, context);
  }`));

const { listDailyV2StagingUnits, DailyV2ServiceError } = await import('./dailyV2SupabaseService');

const ACCOUNT_A = '20000000-0000-4000-8000-00000000000a';
const ACCOUNT_B = '20000000-0000-4000-8000-00000000000b';

function stagingRow(id: string, account: string | null) {
  return {
    id, attempt_id: `30000000-0000-4000-8000-${id.slice(-12)}`, day_unit_id: 'd'.repeat(64), bank: 'ORA',
    account_fingerprint: 'f'.repeat(64), account_registry_id: account, currency: 'XOF', accounting_date: '2026-10-05',
    day_content_hash: 'c'.repeat(64), line_count: 1, day_total_debits: 0, day_total_credits: 1,
    opening_balance_derived: null, closing_balance_derived: null, aggregates_status: 'derived',
    validation_status: 'valid', review_reason_codes: [], status: 'staged', created_at: '2026-11-09T10:00:00Z', created_by: null,
  };
}

function lastRequest(): RecordedRequest {
  const request = recorded.at(-1);
  assert.ok(request, 'une requête HTTP réellement émise');
  return request;
}

test('filters one registry account on the server, before pagination, with the exact filtered count (B)', async () => {
  recorded.length = 0;
  nextResponse = { rows: [stagingRow('10000000-0000-4000-8000-000000000021', ACCOUNT_A)], total: 21, offset: 20 };
  const page = await listDailyV2StagingUnits({ page: 1, pageSize: 20, status: 'staged', review: 'all', account: ACCOUNT_A });

  assert.equal(recorded.length, 1);
  const { url, method, headers } = lastRequest();
  assert.equal(method, 'GET');
  assert.equal(url.pathname, '/rest/v1/daily_statement_units_staging');
  assert.deepEqual(url.searchParams.getAll('account_registry_id'), [`eq.${ACCOUNT_A}`]);
  assert.deepEqual(url.searchParams.getAll('status'), ['eq.staged']);
  assert.equal(url.searchParams.get('offset'), '20');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.get('order'), 'accounting_date.desc,created_at.desc');
  assert.match(headers.prefer ?? '', /count=exact/);
  // Le décompte est celui du compte filtré (21), page 2 : la pagination porte sur l'ensemble filtré.
  assert.equal(page.count, 21);
  assert.equal(page.page, 1);
  assert.deepEqual(page.rows.map((row) => row.account_registry_id), [ACCOUNT_A]);
});

test('selects historical units without registry account with an IS NULL server filter (B)', async () => {
  recorded.length = 0;
  nextResponse = { rows: [stagingRow('10000000-0000-4000-8000-000000000001', null)], total: 1, offset: 0 };
  const page = await listDailyV2StagingUnits({ page: 0, pageSize: 20, account: 'unregistered' });
  assert.deepEqual(lastRequest().url.searchParams.getAll('account_registry_id'), ['is.null']);
  assert.equal(page.count, 1);
});

test('keeps the unfiltered review identical when every account is requested (B)', async () => {
  recorded.length = 0;
  nextResponse = {
    rows: [stagingRow('10000000-0000-4000-8000-000000000001', ACCOUNT_A), stagingRow('10000000-0000-4000-8000-000000000002', ACCOUNT_B)],
    total: 2, offset: 0,
  };
  for (const input of [{ page: 0, pageSize: 20 }, { page: 0, pageSize: 20, account: 'all' }]) {
    const page = await listDailyV2StagingUnits(input);
    const { url } = lastRequest();
    assert.equal(url.searchParams.has('account_registry_id'), false);
    assert.equal(url.searchParams.get('offset'), '0');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(page.count, 2);
  }
});

test('refuses a malformed account filter before any request, including filter-injection attempts (B)', async () => {
  recorded.length = 0;
  for (const account of ['x', `${ACCOUNT_A},status.eq.promoted`, `${ACCOUNT_A})`, 'null', ' ', `${ACCOUNT_A} `]) {
    await assert.rejects(
      () => listDailyV2StagingUnits({ page: 0, pageSize: 20, account }),
      (error: unknown) => error instanceof DailyV2ServiceError && error.safeCode === 'STAGING_ACCOUNT_FILTER_INVALID',
      account,
    );
  }
  assert.equal(recorded.length, 0, 'aucune requête émise pour un filtre refusé');
});
