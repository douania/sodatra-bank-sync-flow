import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF,
  DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
  DAILY_V2_CAPABILITIES,
  applyDailyV2RuntimeMutationLock,
  isDailyV2ProductionPilotProject,
  resolveDailyV2ImportPermissions,
  validateDailyV2RuntimeTarget,
  type DailyV2Capability,
} from './dailyV2RuntimeTarget';

const STAGING_URL = `https://${DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION_URL = `https://${DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF}.supabase.co`;
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

test('production pilot allows deposit and promotion but excludes administration', () => {
  for (const capability of ['read', 'deposit', 'promote'] as const) {
    assert.deepEqual(
      validateDailyV2RuntimeTarget(
        { supabaseUrl: PRODUCTION_URL, projectId: DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF },
        capability,
      ),
      { allowed: true, projectRef: DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF },
    );
  }
  const adminVerdict = validateDailyV2RuntimeTarget(
    { supabaseUrl: PRODUCTION_URL, projectId: DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF },
    'admin',
  );
  assert.equal(adminVerdict.allowed, false);
  assert.match('reason' in adminVerdict ? adminVerdict.reason : '', /capability "admin" is not authorized/);
  assert.equal(isDailyV2ProductionPilotProject(DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF), true);
  assert.equal(isDailyV2ProductionPilotProject(DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF), false);
  assert.equal(isDailyV2ProductionPilotProject(undefined), false);
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

test('the server runtime lock closes every mutation capability but preserves read', () => {
  const stagingCapabilities = {
    read: true,
    deposit: true,
    promote: true,
    admin: true,
  };

  assert.deepEqual(applyDailyV2RuntimeMutationLock(stagingCapabilities, false), {
    read: true,
    deposit: false,
    promote: false,
    admin: false,
  });
  for (const unavailable of [undefined, null]) {
    assert.deepEqual(applyDailyV2RuntimeMutationLock(stagingCapabilities, unavailable), {
      read: true,
      deposit: false,
      promote: false,
      admin: false,
    });
  }
  assert.deepEqual(
    applyDailyV2RuntimeMutationLock(stagingCapabilities, true),
    stagingCapabilities,
  );
});

test('the server lock keeps every production pilot mutation closed until explicitly enabled', () => {
  const productionCapabilities = {
    read: true,
    deposit: true,
    promote: true,
    admin: false,
  };
  assert.deepEqual(
    applyDailyV2RuntimeMutationLock(productionCapabilities, false),
    { read: true, deposit: false, promote: false, admin: false },
  );
  assert.deepEqual(
    applyDailyV2RuntimeMutationLock(productionCapabilities, undefined),
    { read: true, deposit: false, promote: false, admin: false },
  );
  assert.deepEqual(
    applyDailyV2RuntimeMutationLock(productionCapabilities, true),
    productionCapabilities,
  );
});

test('staging read-only mode permits local preparation but never persistence', () => {
  const targetCapabilities = {
    read: true,
    deposit: true,
    promote: true,
    admin: true,
  };
  const lockedCapabilities = applyDailyV2RuntimeMutationLock(targetCapabilities, false);

  assert.deepEqual(
    resolveDailyV2ImportPermissions(true, targetCapabilities, lockedCapabilities),
    { canPrepareLocally: true, canPersist: false },
  );
  assert.deepEqual(
    resolveDailyV2ImportPermissions(true, targetCapabilities, targetCapabilities),
    { canPrepareLocally: true, canPersist: true },
  );
});

test('local preparation stays closed without the role or on an unknown static target', () => {
  const stagingCapabilities = {
    read: true,
    deposit: true,
    promote: true,
    admin: true,
  };
  const unknownCapabilities = {
    read: false,
    deposit: false,
    promote: false,
    admin: false,
  };

  assert.deepEqual(
    resolveDailyV2ImportPermissions(false, stagingCapabilities, stagingCapabilities),
    { canPrepareLocally: false, canPersist: false },
  );
  assert.deepEqual(
    resolveDailyV2ImportPermissions(true, unknownCapabilities, unknownCapabilities),
    { canPrepareLocally: false, canPersist: false },
  );
});
