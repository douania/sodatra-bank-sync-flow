import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
  validateDailyV2RuntimeTarget,
} from './dailyV2RuntimeTarget';

test('allows only the authorized staging project reference', () => {
  const result = validateDailyV2RuntimeTarget({
    supabaseUrl: `https://${DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF}.supabase.co`,
    projectId: DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
  });
  assert.deepEqual(result, {
    allowed: true,
    projectRef: DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
  });
});

test('fails closed for another Supabase project', () => {
  const result = validateDailyV2RuntimeTarget({
    supabaseUrl: 'https://another-project-ref.supabase.co',
  });
  assert.equal(result.allowed, false);
});

test('fails closed when project id contradicts the URL', () => {
  const result = validateDailyV2RuntimeTarget({
    supabaseUrl: `https://${DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF}.supabase.co`,
    projectId: 'another-project-ref',
  });
  assert.equal(result.allowed, false);
});

test('fails closed for a missing or non-standard URL', () => {
  assert.equal(validateDailyV2RuntimeTarget({}).allowed, false);
  assert.equal(validateDailyV2RuntimeTarget({ supabaseUrl: 'https://example.com' }).allowed, false);
});
