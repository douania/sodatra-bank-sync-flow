import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF,
  DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
  DAILY_V2_CAPABILITIES,
  validateDailyV2RuntimeTarget,
  type DailyV2Capability,
} from './dailyV2RuntimeTarget';

const STAGING_URL = `https://${DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION_URL = `https://${DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF}.supabase.co`;
const MUTATIONS: DailyV2Capability[] = ['deposit', 'promote', 'admin'];

test('staging allows the four capabilities', () => {
  for (const capability of DAILY_V2_CAPABILITIES) {
    assert.deepEqual(
      validateDailyV2RuntimeTarget(
        { supabaseUrl: STAGING_URL, projectId: DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF },
        capability,
      ),
      { allowed: true, projectRef: DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF },
    );
  }
});

test('production allows read only', () => {
  assert.deepEqual(
    validateDailyV2RuntimeTarget(
      { supabaseUrl: PRODUCTION_URL, projectId: DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF },
      'read',
    ),
    { allowed: true, projectRef: DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF },
  );
  for (const capability of MUTATIONS) {
    const result = validateDailyV2RuntimeTarget({ supabaseUrl: PRODUCTION_URL }, capability);
    assert.equal(result.allowed, false, `production must refuse ${capability}`);
    assert.match(
      'reason' in result ? result.reason : '',
      new RegExp(`capability "${capability}" is not authorized`),
    );
  }
});

test('an unknown target fails closed for every capability', () => {
  for (const capability of DAILY_V2_CAPABILITIES) {
    assert.equal(
      validateDailyV2RuntimeTarget(
        { supabaseUrl: 'https://another-project-ref.supabase.co' },
        capability,
      ).allowed,
      false,
    );
  }
});

test('a missing, invalid or non-Supabase URL fails closed for every capability', () => {
  for (const capability of DAILY_V2_CAPABILITIES) {
    assert.equal(validateDailyV2RuntimeTarget({}, capability).allowed, false);
    assert.equal(validateDailyV2RuntimeTarget({ supabaseUrl: '   ' }, capability).allowed, false);
    assert.equal(
      validateDailyV2RuntimeTarget({ supabaseUrl: 'https://example.com' }, capability).allowed,
      false,
    );
    assert.equal(
      validateDailyV2RuntimeTarget({ supabaseUrl: 'not-an-url' }, capability).allowed,
      false,
    );
  }
});

test('a contradicting project id fails closed on staging and on production', () => {
  for (const supabaseUrl of [STAGING_URL, PRODUCTION_URL]) {
    for (const capability of DAILY_V2_CAPABILITIES) {
      const result = validateDailyV2RuntimeTarget(
        { supabaseUrl, projectId: 'another-project-ref' },
        capability,
      );
      assert.equal(result.allowed, false);
      assert.match('reason' in result ? result.reason : '', /contradicts the target project URL/);
    }
  }
  // Croiser les deux références autorisées reste une contradiction.
  assert.equal(
    validateDailyV2RuntimeTarget(
      { supabaseUrl: PRODUCTION_URL, projectId: DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF },
      'read',
    ).allowed,
    false,
  );
});

test('an unknown capability fails closed even on staging', () => {
  assert.equal(
    validateDailyV2RuntimeTarget(
      { supabaseUrl: STAGING_URL },
      'superadmin' as unknown as DailyV2Capability,
    ).allowed,
    false,
  );
});
