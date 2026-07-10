import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/features/daily-v2/dailyV2SupabaseService.ts', 'utf8');
const types = readFileSync('src/features/daily-v2/dailyV2Types.ts', 'utf8');
const page = readFileSync('src/pages/DailyStatementV2.tsx', 'utf8');
const tables = readFileSync('src/features/daily-v2/DailyV2Tables.tsx', 'utf8');

test('uses the three exact Daily v2 RPC names and no direct table mutation', () => {
  for (const rpc of [
    'pre_ingest_daily_statement_units',
    'promote_daily_statement_unit',
    'supersede_daily_statement_unit',
  ]) {
    assert.match(service, new RegExp(`\\.rpc\\(['"]${rpc}['"]`));
    assert.match(types, new RegExp(`${rpc}:`));
  }

  assert.doesNotMatch(service, /\.(insert|update|delete|upsert)\s*\(/);
  assert.equal(service.includes('createClient('), false);
  assert.equal(service.includes('service_role'), false);
});

test('declares only the six frozen Daily v2 tables in the local contract', () => {
  for (const table of [
    'daily_statement_export_attempts',
    'daily_statement_units_staging',
    'daily_statement_lines_staging',
    'daily_statement_units_canonical',
    'daily_statement_lines_canonical',
    'daily_statement_import_events',
  ]) {
    assert.match(types, new RegExp(`${table}:`));
  }
});

test('keeps role-gated UI decisions fail closed', () => {
  assert.match(page, /const isAdmin = roles\.includes\('admin'\)/);
  assert.match(page, /const canDeposit = isAdmin \|\| roles\.includes\('manager'\)/);
  assert.match(page, /const canReadCanonical = isAdmin \|\| roles\.includes\('auditor'\)/);
  assert.match(tables, /unit\.status === 'staged'/);
  assert.match(tables, /unit\.status === 'conflict'/);
});
