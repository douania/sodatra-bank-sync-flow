import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DailyV2AdminControlsGate } from './DailyV2AdminControlsGate';
import {
  applyDailyV2RuntimeMutationLock,
  DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF,
  DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF,
  validateDailyV2RuntimeTarget,
  type DailyV2Capability,
} from './dailyV2RuntimeTarget';

type RuntimeLockCase =
  | { name: 'enabled'; value: true; queryError: false }
  | { name: 'disabled'; value: false; queryError: false }
  | { name: 'absent'; value: undefined; queryError: false }
  | { name: 'error'; value: true; queryError: true };

const lockCases: readonly RuntimeLockCase[] = [
  { name: 'enabled', value: true, queryError: false },
  { name: 'disabled', value: false, queryError: false },
  { name: 'absent', value: undefined, queryError: false },
  { name: 'error', value: true, queryError: true },
];

const roleCases = ['admin', 'manager', 'auditor', 'user'] as const;

function targetCapabilities(projectRef: string): Record<DailyV2Capability, boolean> {
  const input = {
    supabaseUrl: `https://${projectRef}.supabase.co`,
    projectId: projectRef,
  };
  return {
    read: validateDailyV2RuntimeTarget(input, 'read').allowed,
    deposit: validateDailyV2RuntimeTarget(input, 'deposit').allowed,
    promote: validateDailyV2RuntimeTarget(input, 'promote').allowed,
    admin: validateDailyV2RuntimeTarget(input, 'admin').allowed,
  };
}

function renderAdminSurface(allowed: boolean, onRender: () => void): string {
  function ServiceBackedAdminControls() {
    onRender();
    return (
      <section>
        <button>Provisionner un compte</button>
        <button>Créer un grant backfill</button>
      </section>
    );
  }

  return renderToStaticMarkup(
    <DailyV2AdminControlsGate
      allowed={allowed}
      renderControls={() => <ServiceBackedAdminControls />}
    />,
  );
}

test('never renders or evaluates admin/backfill controls in the production pilot matrix', () => {
  const staticCapabilities = targetCapabilities(DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF);
  assert.deepEqual(staticCapabilities, {
    read: true,
    deposit: true,
    promote: true,
    admin: false,
  });

  for (const lockCase of lockCases) {
    for (const role of roleCases) {
      const effectiveCapabilities = applyDailyV2RuntimeMutationLock(
        staticCapabilities,
        lockCase.queryError ? false : lockCase.value,
      );
      const canAdminister = role === 'admin' && effectiveCapabilities.admin;
      let serviceBackedControlRenderCount = 0;
      const markup = renderAdminSurface(
        canAdminister,
        () => { serviceBackedControlRenderCount += 1; },
      );

      assert.equal(canAdminister, false, `${lockCase.name}/${role} must stay closed`);
      assert.equal(markup, '', `${lockCase.name}/${role} must expose no privileged markup`);
      assert.equal(
        serviceBackedControlRenderCount,
        0,
        `${lockCase.name}/${role} must not evaluate service-backed controls`,
      );
      assert.doesNotMatch(markup, /Provisionner|grant backfill/i);
    }
  }
});

test('renders the same gate only for staging admin with an explicit true lock', () => {
  const staticCapabilities = targetCapabilities(DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF);
  const effectiveCapabilities = applyDailyV2RuntimeMutationLock(staticCapabilities, true);
  let serviceBackedControlRenderCount = 0;
  const markup = renderAdminSurface(
    effectiveCapabilities.admin,
    () => { serviceBackedControlRenderCount += 1; },
  );

  assert.match(markup, /Provisionner un compte/);
  assert.match(markup, /Créer un grant backfill/);
  assert.equal(serviceBackedControlRenderCount, 1);
});
