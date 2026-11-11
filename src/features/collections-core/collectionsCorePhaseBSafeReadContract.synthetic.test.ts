import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('la migration expose une lecture bornée sans élargir la RLS Daily v2', async () => {
  const migration = await read('../../../supabase/migrations/20260806000000_collection_remittances_core_phase_b_safe_read.sql');
  assert.match(migration, /list_collection_match_candidates_v1/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /PILOT_ALLOWLIST_V1/);
  assert.match(migration, /u\.account_registry_id=v_item\.deposit_account_id/);
  assert.match(migration, /l\.currency=v_item\.currency/);
  assert.match(migration, /att\.source_file_name_redacted LIKE v_campaign_id/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*daily_statement_(?:lines|units)_canonical/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM) public\.daily_statement_/);
});

test('les contournements directs sont fermés et service_role reste exclu', async () => {
  const migration = await read('../../../supabase/migrations/20260806000000_collection_remittances_core_phase_b_safe_read.sql');
  assert.match(migration, /REVOKE SELECT ON TABLE public\.collection_match_proposals FROM authenticated,service_role/);
  assert.match(migration, /REVOKE SELECT ON TABLE public\.collection_bank_line_allocations FROM authenticated,service_role/);
  assert.match(migration, /REVOKE SELECT ON TABLE public\.collection_exception_status_v FROM authenticated,service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.propose_collection_match_v1/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.confirm_collection_match_v1/);
  assert.match(migration, /REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role/);
});

test('le snapshot de provenance est envoyé intégralement par le navigateur', async () => {
  const payload = await read('./collectionsCorePayloads.ts');
  for (const field of [
    'expected_canonical_unit_id', 'expected_daily_line_hash', 'expected_account_registry_id',
    'expected_accounting_date', 'expected_credit_amount', 'expected_currency',
    'expected_source_attempt_id', 'expected_source_raw_text_hash',
  ]) assert.match(payload, new RegExp(field));
});

test('la surface applicative reste explicable et sans frais séparés', async () => {
  const page = await read('../../pages/CollectionsCore.tsx');
  assert.match(page, /referenceSignal/);
  assert.match(page, /reasonCodes/);
  assert.match(page, /Aucune confirmation n’est automatique/);
  assert.match(page, /EXACT_CREDIT/);
  assert.match(page, /NET_OF_DISCOUNT/);
  assert.doesNotMatch(page, /value="FEES_SEPARATE"/);
});
