import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Document Understanding analyse localement sans importer ni appeler la persistance', () => {
  const component = readFileSync('src/components/UniversalBankParser.tsx', 'utf8');
  assert.doesNotMatch(component, /bankingUniversalService|saveReport\s*\(/);
  assert.match(component, /validateBdkUniversalReadOnlyResult\(content, bdkData\)/);
  assert.match(component, /Analyse locale en lecture seule/);
  assert.match(component, /aucune donnée n’est sauvegardée/);
});

test('la défense en profondeur refuse saveReport avant tout accès Supabase', () => {
  const service = readFileSync('src/services/bankingUniversalService.ts', 'utf8');
  const start = service.indexOf('async saveReport');
  const end = service.indexOf('async getReports', start);
  assert.ok(start >= 0 && end > start, 'La méthode saveReport doit rester explicitement présente et gardée.');
  const method = service.slice(start, end);
  assert.match(method, /success:\s*false/);
  assert.match(method, /strictement en lecture seule/);
  assert.doesNotMatch(method, /supabase\s*\.|\.from\s*\(/);
});
