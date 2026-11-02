import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TREASURY_PRODUCTION_REFUSED,
  validateTreasuryRuntimeTarget,
} from './treasuryRuntimeTarget';

const PROD_URL = 'https://leakcdbbawzysfqyqsnr.supabase.co';
const PROD_ID = 'leakcdbbawzysfqyqsnr';
const STAGING_URL = 'https://gbbsqcscryygqlmqncyv.supabase.co';
const STAGING_ID = 'gbbsqcscryygqlmqncyv';

test('production toujours refusée, quels que soient les drapeaux', () => {
  const variants = [
    { supabaseUrl: PROD_URL, projectId: PROD_ID },
    { supabaseUrl: PROD_URL, projectId: PROD_ID, localEnabled: 'true', stagingEnabled: 'true' },
    // Le mode « administration seule » des chèques ne concerne pas la trésorerie.
    { supabaseUrl: PROD_URL, projectId: PROD_ID, productionAdminOnly: 'true' } as Record<string, string>,
    { supabaseUrl: `${PROD_URL}/`, projectId: PROD_ID },
    { supabaseUrl: 'https://LEAKCDBBAWZYSFQYQSNR.supabase.co', projectId: PROD_ID },
    { supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co.', projectId: '' },
    { supabaseUrl: PROD_URL },
    { supabaseUrl: STAGING_URL, projectId: PROD_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'http://localhost:54321', projectId: PROD_ID, localEnabled: 'true' },
    { supabaseUrl: 'not a url', projectId: PROD_ID },
  ];
  for (const input of variants) {
    assert.deepEqual(validateTreasuryRuntimeTarget(input), { allowed: false, reason: TREASURY_PRODUCTION_REFUSED },
      JSON.stringify(input));
  }
});

test('local : drapeau explicite exigé, cible contradictoire refusée', () => {
  assert.deepEqual(validateTreasuryRuntimeTarget({ supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true' }),
    { allowed: true, environment: 'local' });
  assert.deepEqual(validateTreasuryRuntimeTarget({ supabaseUrl: 'http://localhost:54321', localEnabled: 'true' }),
    { allowed: true, environment: 'local' });
  assert.equal(validateTreasuryRuntimeTarget({ supabaseUrl: 'http://127.0.0.1:54321' }).allowed, false);
  assert.equal(validateTreasuryRuntimeTarget({ supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'TRUE' }).allowed, false);
  assert.equal(validateTreasuryRuntimeTarget({ supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true', projectId: STAGING_ID }).allowed, false);
});

test('staging : origine, project ID et drapeau exacts', () => {
  assert.deepEqual(validateTreasuryRuntimeTarget({ supabaseUrl: STAGING_URL, projectId: STAGING_ID, stagingEnabled: 'true' }),
    { allowed: true, environment: 'staging' });
  for (const input of [
    { supabaseUrl: STAGING_URL, projectId: STAGING_ID },
    { supabaseUrl: STAGING_URL, projectId: STAGING_ID, stagingEnabled: 'yes' },
    { supabaseUrl: STAGING_URL, stagingEnabled: 'true' },
    { supabaseUrl: `${STAGING_URL}/rest/v1`, projectId: STAGING_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'https://gbbsqcscryygqlmqncyv.supabase.co:8443', projectId: STAGING_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'http://gbbsqcscryygqlmqncyv.supabase.co', projectId: STAGING_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'https://example.supabase.co', projectId: STAGING_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'not a url', projectId: STAGING_ID, stagingEnabled: 'true' },
  ]) {
    assert.equal(validateTreasuryRuntimeTarget(input).allowed, false, JSON.stringify(input));
  }
});
