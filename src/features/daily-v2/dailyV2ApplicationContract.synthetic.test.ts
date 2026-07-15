import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const access = readFileSync('src/features/daily-v2/dailyV2Access.ts', 'utf8');
const browserPipeline = readFileSync('src/features/daily-v2/dailyV2BrowserPipeline.ts', 'utf8');
const service = readFileSync('src/features/daily-v2/dailyV2SupabaseService.ts', 'utf8');
const types = readFileSync('src/features/daily-v2/dailyV2Types.ts', 'utf8');
const page = readFileSync('src/pages/DailyStatementV2.tsx', 'utf8');
const tables = readFileSync('src/features/daily-v2/DailyV2Tables.tsx', 'utf8');
const migration0U = readFileSync(
  'supabase/migrations/20260715000000_daily_v2_account_registry_review_visibility.sql',
  'utf8',
);
const e2eRunner = readFileSync('supabase/tests/daily_statement_units_v2/run_e2e_0r.sh', 'utf8');

test('uses the exact Daily v2 RPC names and no direct table mutation', () => {
  for (const rpc of [
    'pre_ingest_daily_statement_units',
    'promote_daily_statement_unit',
    'supersede_daily_statement_unit',
    'provision_daily_statement_account',
    'deactivate_daily_statement_account',
    'issue_daily_statement_backfill_grant',
    'revoke_daily_statement_backfill_grant',
  ]) {
    assert.match(service, new RegExp(`\\.rpc\\(['"]${rpc}['"]`));
    assert.match(types, new RegExp(`${rpc}:`));
  }

  assert.doesNotMatch(service, /\.(insert|update|delete|upsert)\s*\(/);
  assert.equal(service.includes('createClient('), false);
  assert.equal(service.includes('service_role'), false);
});

test('keeps the six historical Daily v2 tables and adds the 0U control tables', () => {
  for (const table of [
    'daily_statement_export_attempts',
    'daily_statement_units_staging',
    'daily_statement_lines_staging',
    'daily_statement_units_canonical',
    'daily_statement_lines_canonical',
    'daily_statement_import_events',
    'daily_statement_account_registry',
    'daily_statement_backfill_grants',
    'daily_statement_account_events',
  ]) {
    assert.match(types, new RegExp(`${table}:`));
  }
});

test('keeps the 0U migration additive and makes the historical ingest core internal', () => {
  for (const table of [
    'daily_statement_account_registry',
    'daily_statement_backfill_grants',
    'daily_statement_account_events',
  ]) {
    assert.match(migration0U, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(migration0U, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration0U, /RENAME TO daily_stmt_pre_ingest_legacy_core_0u/);
  assert.match(
    migration0U,
    /REVOKE ALL ON FUNCTION public\.daily_stmt_pre_ingest_legacy_core_0u\(jsonb,jsonb,jsonb,jsonb\)/,
  );
  assert.doesNotMatch(migration0U, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.match(e2eRunner, /MIGRATION_0U=/);
  assert.match(e2eRunner, /--single-transaction < "\$MIGRATION_0U"/);
});

test('keeps role-gated UI decisions fail closed', () => {
  assert.match(page, /const isAdmin = roles\.includes\('admin'\)/);
  assert.match(page, /const canDeposit = isAdmin \|\| roles\.includes\('manager'\)/);
  assert.match(page, /const canReadCanonical = isAdmin \|\| roles\.includes\('auditor'\)/);
  assert.match(tables, /unit\.status === 'staged'/);
  assert.match(tables, /unit\.status === 'conflict'/);
  assert.match(page, /\{isAdmin && bank === 'BIS' && <SelectItem value="backfill"/);
  assert.match(page, /requestedMode === 'backfill' && !isAdmin/);
  assert.match(browserPipeline, /backfillGrantId is mandatory in backfill mode/);
  assert.match(browserPipeline, /accountRegistryId must identify a provisioned account/);
  assert.match(page, /Compte pré-provisionné/);
  assert.doesNotMatch(page, /Account fingerprint pré-provisionné/);
  assert.match(page, /Motifs à examiner avant décision/);
  assert.match(browserPipeline, /Backfill mode is supported only for the characterized BIS profile in 0Q/);
  assert.match(browserPipeline, /MAX_BACKFILL_PERIOD_DAYS = 4_000/);
});

test('exposes only the characterized structured bank/file matrix', () => {
  for (const bank of ['BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE']) {
    assert.match(page, new RegExp(`<SelectItem value="${bank}"`));
  }
  assert.match(page, /'text\/csv': \['\.csv'\]/);
  assert.match(page, /'application\/vnd\.ms-excel': \['\.xls'\]/);
  assert.match(page, /spreadsheetml\.sheet': \['\.xlsx'\]/);
});

test('blocks the Daily v2 page and navigation for the user-only role', () => {
  const accessRoles = access.match(/new Set\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(accessRoles, 'Daily v2 page access roles must be declared explicitly');
  assert.match(accessRoles, /'admin'/);
  assert.match(accessRoles, /'manager'/);
  assert.match(accessRoles, /'auditor'/);
  assert.doesNotMatch(accessRoles, /'user'/);

  assert.match(access, /enabled: Boolean\(user\?\.id\) && targetAllowed/);
  assert.match(access, /canAccessPage: targetAllowed && canAccessDailyV2Page\(roles\)/);
  assert.match(app, /rolesQuery\.isError \|\| !canAccessPage/);
  assert.match(app, /<Navigate to="\/dashboard" replace \/>/);
  assert.match(
    layout,
    /\.filter\(\(item\) => item\.href !== '\/daily-statements' \|\| canAccessPage\)/,
  );
});
