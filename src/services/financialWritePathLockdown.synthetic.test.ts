import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import test from 'node:test';

const financialTables = [
  'bank_reports',
  'bank_facilities',
  'deposits_not_cleared',
  'impayes',
  'fund_position',
  'fund_position_detail',
  'fund_position_hold',
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

test('aucun consommateur src ne contourne les RPC par une écriture directe', () => {
  const src = new URL('../', import.meta.url);
  const violations: string[] = [];

  for (const file of sourceFiles(src.pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)))) {
    if (file.endsWith('financialWritePathLockdown.synthetic.test.ts')) continue;
    const content = readFileSync(file, 'utf8');
    for (const table of financialTables) {
      const directWrite = new RegExp(
        String.raw`\.from\(\s*['"]${table}['"]\s*\)[\s\S]{0,240}?\.(?:insert|update|upsert|delete)\s*\(`,
        'g',
      );
      if (directWrite.test(content)) violations.push(`${file}:${table}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('la migration retire toutes les surfaces DML authenticated et préserve les RPC', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260813000000_ops_core_4_financial_write_path_lockdown.sql', import.meta.url),
    'utf8',
  );

  for (const table of financialTables) assert.match(migration, new RegExp(`public\\.${table}|['"]${table}['"]`));
  assert.match(migration, /cmd IN \('ALL', 'INSERT', 'UPDATE', 'DELETE'\)/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
  assert.match(migration, /FROM authenticated/);
  assert.doesNotMatch(migration, /REVOKE\s+SELECT/i);
  assert.doesNotMatch(migration, /FROM\s+service_role/i);
  assert.match(migration, /save_bank_report_atomic_v1/);
  assert.match(migration, /save_fund_position_atomic_v1/);
});
