import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createDailyV2SessionLifetime } from './dailyV2SessionLifetime';
import { createDailyV2SessionScope } from './dailyV2SessionScope';
import { dailyV2RuntimeLockPresentation, dailyV2SessionLabel } from './dailyV2SessionPresentation';
import { classifyDailyV2AccessState } from '../dailyV2AccessState';

test('session label distinguishes initial loading, connected and disconnected without identities', () => {
  assert.equal(dailyV2SessionLabel(true, true), 'Session : vérification…');
  assert.equal(dailyV2SessionLabel(false, true), 'Session : connectée');
  assert.equal(dailyV2SessionLabel(false, false), 'Session : connexion requise');
});

test('page access ignores retained roles during loading, refresh, error or logout', () => {
  const base = { targetVerdict: { allowed: true as const, projectRef: 'gbbsqcscryygqlmqncyv' as const },
    rolesPending: false, rolesError: false, canAccessPage: true, sessionPresent: true };
  assert.equal(classifyDailyV2AccessState(base).status, 'allowed');
  for (const override of [{ sessionLoading: true }, { rolesFetching: true }, { rolesError: true },
    { sessionPresent: false }, { canAccessPage: false }]) {
    assert.notEqual(classifyDailyV2AccessState({ ...base, ...override }).status, 'allowed');
  }
  assert.deepEqual(classifyDailyV2AccessState({ ...base, sessionPresent: false, rolesPending: true }),
    { status: 'blocked', reason: 'session_required' });
});

test('lock status never presents a stale true as an authorization during refetch or failure', () => {
  const base = { staticReadOnly: false, productionPilot: true, pending: false, fetching: false, error: false, value: true };
  assert.match(dailyV2RuntimeLockPresentation(base).label, /droits et scopes serveur requis/);
  assert.match(dailyV2RuntimeLockPresentation({ ...base, fetching: true }).label, /suspendues/);
  assert.match(dailyV2RuntimeLockPresentation({ ...base, error: true }).label, /indisponible/);
  assert.match(dailyV2RuntimeLockPresentation({ ...base, value: undefined }).label, /indisponible/);
  assert.equal(dailyV2RuntimeLockPresentation({ ...base, value: false }).title, 'Pilote production verrouillé');
  assert.equal(dailyV2RuntimeLockPresentation({ ...base, value: false, productionPilot: false }).title, 'Environnement en lecture seule');
  assert.match(dailyV2RuntimeLockPresentation({ ...base, staticReadOnly: true }).label, /imposée/);
});

test('expired lifetime invalidates both success and rejection tickets, including StrictMode reactivation', () => {
  const lifetime = createDailyV2SessionLifetime();
  assert.throws(() => lifetime.assertActive(), /VIEW_EXPIRED/);
  lifetime.activate();
  const ticket = lifetime.capture();
  assert.equal(lifetime.isCurrent(ticket), true);
  lifetime.dispose();
  assert.equal(lifetime.isCurrent(ticket), false);
  lifetime.activate();
  assert.equal(lifetime.isCurrent(ticket), false);
  assert.equal(lifetime.isCurrent(lifetime.capture()), true);
});

test('financial query cache is private to each mounted view and clears without touching other scopes', async () => {
  const a = createDailyV2SessionScope(), b = createDailyV2SessionScope();
  const key = ['daily-v2', 'canonical'];
  a.client.setQueryData(key, ['synthetic-A']);
  b.client.setQueryData(key, ['synthetic-B']);
  assert.deepEqual(a.client.getQueryData(key), ['synthetic-A']);
  assert.deepEqual(b.client.getQueryData(key), ['synthetic-B']);
  a.client.clear();
  assert.equal(a.client.getQueryData(key), undefined);
  assert.deepEqual(b.client.getQueryData(key), ['synthetic-B']);
  b.client.clear();
});

test('late query completion cannot recreate data in a cleared view cache', async () => {
  const scope = createDailyV2SessionScope();
  let resolve: (data: string[]) => void;
  const pending = scope.client.fetchQuery({ queryKey: ['daily-v2', 'canonical'],
    queryFn: () => new Promise<string[]>((done) => { resolve = done; }) });
  const observed = pending.catch(() => undefined);
  scope.client.clear();
  resolve!(['synthetic-late']);
  await observed;
  assert.equal(scope.client.getQueryCache().getAll().length, 0);
});

test('page uses isolated boundary and guarded mutations without changing the RPC service', () => {
  const page = readFileSync('src/pages/DailyStatementV2.tsx', 'utf8');
  assert.match(page, /DailyV2SessionBoundary key=\{JSON.stringify\(\[user.id,/);
  assert.match(page, /accessState.status !== 'allowed'/);
  assert.match(page, /useDailyV2ScopedMutation as useMutation/);
  assert.doesNotMatch(page, /<Badge[^>]*>Session requise/);
  assert.match(page, /rolesFetching|runtimeLockQuery.isFetching/);
  assert.match(page, /epoch !== preparationEpoch.current/);
  const reporting = readFileSync('src/features/daily-v2/DailyV2Reporting.tsx', 'utf8');
  assert.match(reporting, /useDailyV2ScopedMutation as useMutation/);
  assert.match(reporting, /ticket !== generation.current/);
  assert.doesNotMatch(reporting, /localStorage|sessionStorage|console\./);
});
