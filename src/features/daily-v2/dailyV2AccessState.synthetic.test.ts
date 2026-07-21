import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDailyV2AccessState } from './dailyV2AccessState';
const allowedTarget = {
  allowed: true as const,
  projectRef: 'gbbsqcscryygqlmqncyv' as const,
};
test('reports runtime rejection before inspecting the disabled roles query', () => {
  const result = classifyDailyV2AccessState({
    targetVerdict: { allowed: false, reason: 'Runtime target is unavailable.' },
    rolesPending: true,
    rolesError: false,
    canAccessPage: false,
  });
  assert.deepEqual(result, {
    status: 'blocked',
    reason: 'runtime_target_rejected',
    safeDetail: 'Runtime target is unavailable.',
  });
});
test('distinguishes pending, lookup failure, insufficient role and allowed access', () => {
  const cases = [
    [true, false, false, { status: 'checking' }],
    [false, true, false, { status: 'blocked', reason: 'role_lookup_failed' }],
    [false, false, false, { status: 'blocked', reason: 'insufficient_role' }],
    [false, false, true, { status: 'allowed' }],
  ] as const;

  for (const [rolesPending, rolesError, canAccessPage, expected] of cases) {
    assert.deepEqual(
      classifyDailyV2AccessState({
        targetVerdict: allowedTarget,
        rolesPending,
        rolesError,
        canAccessPage,
      }),
      expected,
    );
  }
});
