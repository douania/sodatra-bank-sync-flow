import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DailyStatementV2 from '../../src/pages/DailyStatementV2';
import DailyV2Reporting from '../../src/features/daily-v2/DailyV2Reporting';
import DailyV2OperationalDashboard from '../../src/features/daily-v2/dashboard/DailyV2OperationalDashboard';
import { DailyV2SessionBoundary } from '../../src/features/daily-v2/session/DailyV2SessionBoundary';
import { useDailyV2ScopedMutation } from '../../src/features/daily-v2/session/dailyV2SessionScope';
import { authChange, canonicalPage, state } from './fixtures';
import { buildDashboardSnapshot } from '../../src/features/daily-v2/dashboard/dailyV2DashboardModel';

const fixture = document.querySelector('#fixture')!;
const root = createRoot(fixture);
const results = document.querySelector('#results')!;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
const text = () => fixture.textContent ?? '';
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); }
async function settle() { await new Promise((resolve) => setTimeout(resolve, 60)); }
async function until(condition: () => boolean, label: string) {
  const deadline = Date.now() + 40_000;
  while (!condition() && Date.now() < deadline) await settle();
  check(condition(), label);
}
const render = (child: React.ReactNode) => flushSync(() => root.render(<React.StrictMode><QueryClientProvider client={client}>{child}</QueryClientProvider></React.StrictMode>));
function tab(name: string) {
  const target = [...fixture.querySelectorAll('[role=tab]')].find((node) => node.textContent === name)!;
  check(target, `Missing tab ${name}`);
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
}
function input(index: number, value: string) {
  const field = fixture.querySelectorAll('input')[index];
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function click(label: string) {
  const button = [...fixture.querySelectorAll('button')].find((node) => node.textContent?.includes(label));
  check(button && !button.disabled, `Missing/enabled button ${label}`); button!.click();
}
const completed: string[] = [];
const pass = (name: string) => { completed.push(name); results.textContent = completed.map((s) => `PASS ${s}`).join('\n'); };
let mutationResolve: (value: string) => void, mutationReject: (error: Error) => void;
let callbackCount = 0;
export function Probe() {
  const request = useDailyV2ScopedMutation({ mutationFn: () => new Promise<string>((resolve, reject) => { mutationResolve = resolve; mutationReject = reject; }),
    onSuccess: () => { callbackCount++; }, onError: () => { callbackCount++; } });
  return <button onClick={() => request.mutate()}>Deferred probe</button>;
}

async function run() {
  render(<DailyStatementV2 />); await settle(); await settle();
  check(text().includes('Session : connectée') && !text().includes('Session requise'), 'connected badge');
  check(text().includes('Mode parse-only') && text().includes('Verrou serveur : lecture seule'), 'lock closed, parse only');
  check(state.mutationCalls === 0, 'no mutation on mount'); pass('connected session / closed lock / zero mutations');

  tab('Canonical'); await settle();
  check(text().includes('synthetic-a'), 'canonical A must be shown');
  state.rolesDeferred = true;
  void client.invalidateQueries({ queryKey: ['daily-v2', 'roles'] }); await settle();
  check(!fixture.querySelector('table') && !text().includes('synthetic-a'), 'refetch clears all financial UI');
  state.rolesDeferred = false; state.roles = ['user'];
  state.roleResolvers.splice(0).forEach((done) => done(['user'])); await settle();
  check(!fixture.querySelector('table') && !fixture.querySelector('input'), 'denied role blocks page and file inputs');
  pass('role refetch and revocation remove data and inputs');

  state.roles = ['admin'];
  await client.invalidateQueries({ queryKey: ['daily-v2', 'roles'] }); await settle();
  check(text().includes('Mode parse-only'), 'restore access');
  state.canonicalDeferred = true;
  render(null); await settle(); render(<DailyStatementV2 />); await settle();
  tab('Canonical'); await settle();
  check(state.canonicalResolvers.length > 0, 'deferred A query started');
  client.setQueryData(['daily-v2', 'roles', 'synthetic-b'], ['admin']);
  state.canonicalDeferred = false;
  flushSync(() => authChange('synthetic-b')); await settle();
  check(!text().includes('synthetic-a'), 'A not shown after B switch');
  tab('Canonical'); await settle();
  state.canonicalResolvers.splice(0).forEach((done) => done(canonicalPage('synthetic-late-a'))); await settle();
  check(text().includes('synthetic-b') && !text().includes('synthetic-late-a'), 'late A cannot populate B');
  pass('user change isolates query cache, ignores late A response');

  state.rolesFail = true;
  await client.invalidateQueries({ queryKey: ['daily-v2', 'roles'] }); await settle();
  check(!fixture.querySelector('table') && !fixture.querySelector('input'), 'retained admin data after failed role lookup must not authorize');
  state.rolesFail = false;
  await client.invalidateQueries({ queryKey: ['daily-v2', 'roles'] }); await settle();
  flushSync(() => authChange(null)); await settle();
  check(text().toLowerCase().includes('connexion requise') && !fixture.querySelector('table'), 'logout clears UI');
  flushSync(() => authChange('synthetic-b', true)); await settle();
  check(text().toLowerCase().includes('vérification') && !fixture.querySelector('input'), 'session loading has no inputs');
  flushSync(() => authChange('synthetic-b')); await settle();
  pass('lookup error / logout / auth loading fail closed');

  render(null); await settle(); state.lockDeferred = true;
  render(<DailyStatementV2 />); await settle(); await settle();
  check(text().includes('écritures suspendues') && text().includes('Mode parse-only'), 'pending lock leaves only local preparation');
  state.lockDeferred = false; state.lock = true;
  state.lockResolvers.splice(0).forEach((done) => done(true)); await settle();
  check(text().includes('verrou maître ouvert') && text().includes('scopes serveur requis'), 'master lock not advertised as sufficient authorization');
  const aliasField = fixture.querySelector<HTMLInputElement>('input[placeholder="Ex. Compte exploitation Dakar"]')!;
  check(aliasField, 'admin form mounted');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(aliasField, 'Synthetic alias');
  aliasField.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  aliasField.focus(); aliasField.setSelectionRange(3, 3);
  state.lockDeferred = true;
  results.textContent += '\nRUN real 30s lock polling / focused admin input';
  await until(() => state.lockResolvers.length > 0 && text().includes('écritures suspendues'), 'real background lock refetch started');
  check(aliasField.isConnected && document.activeElement === aliasField && aliasField.selectionStart === 3 && aliasField.value === 'Synthetic alias', 'polling preserves input node, focus, caret and draft');
  const provision = [...fixture.querySelectorAll('button')].find((node) => node.textContent?.includes('Provisionner pour'))!;
  check(provision.disabled, 'admin action disabled during refetch');
  state.lockDeferred = false; state.lockResolvers.splice(0).forEach((done) => done(true)); await settle();
  check(document.activeElement === aliasField && !provision.disabled, 'refetch completion preserves focus and restores action');
  pass('real background lock polling preserves focused input and fails closed');
  render(null); await settle(); state.lockFail = true;
  render(<DailyStatementV2 />); await settle(); await settle();
  check(text().includes('indisponible') && text().includes('Mode parse-only'), 'lock failure fails closed');
  state.lockFail = false; state.lock = false;
  pass('pending / open / unavailable lock distinguished from server scopes');

  render(<DailyV2SessionBoundary key="probe-a"><Probe /></DailyV2SessionBoundary>); await settle();
  click('Deferred probe'); await settle();
  render(<DailyV2SessionBoundary key="probe-b"><Probe /></DailyV2SessionBoundary>); await settle();
  mutationResolve!('late success'); await settle();
  check(callbackCount === 0, 'late success callback suppressed');
  click('Deferred probe'); await settle(); render(null); await settle();
  mutationReject!(new Error('late error')); await settle();
  check(callbackCount === 0, 'late error callback suppressed');
  pass('mutation callbacks cannot cross disposed view lifetimes (StrictMode)');

  render(<DailyV2SessionBoundary key="report"><DailyV2Reporting /></DailyV2SessionBoundary>); await settle();
  input(0, '2026-01-01'); input(1, '2026-01-03'); await settle();
  click('Générer le rapport'); await settle();
  const toastCount = state.toasts.length;
  input(2, 'BDK'); await settle();
  state.reportResolvers.splice(0).forEach((done) => done({ filters: { startDate: '2026-01-01', endDate: '2026-01-03' }, groups: [], currencySummaries: [], sourceUnitCount: 0, generatedAt: 'synthetic-stale-report' })); await settle();
  check(!text().includes('synthetic-stale-report') && state.toasts.length === toastCount, 'old report and toast refused after filter edit');
  click('Générer le rapport'); await settle();
  state.reportResolvers.splice(0).forEach((done) => done({ filters: { startDate: '2026-01-01', endDate: '2026-01-03', bank: 'BDK' }, groups: [], currencySummaries: [], sourceUnitCount: 0, generatedAt: 'synthetic-current-report' })); await settle();
  check(text().includes('synthetic-current-report'), 'current report rendered');
  input(3, 'EUR'); await settle(); check(!text().includes('synthetic-current-report'), 'edit immediately clears current report');
  pass('report filter edits clear results and suppress stale completions');

  render(<DailyV2OperationalDashboard />); await settle(); await settle();
  check(text().includes('Trésorerie'), 'actual dashboard mounted');
  state.rolesDeferred = true; void client.invalidateQueries({ queryKey: ['daily-v2', 'roles'] }); await settle();
  check(!fixture.querySelector('section[aria-label="Dashboard Daily v2"]'), 'dashboard unmounts on refetch');
  state.dashboardDeferred = true; state.rolesDeferred = false;
  state.roleResolvers.splice(0).forEach((done) => done(['admin'])); await settle();
  check(state.dashboardResolvers.length > 0, 'dashboard deferred read');
  flushSync(() => authChange(null)); await settle();
  const empty = await buildDashboardSnapshot({ asOfDate: '2026-01-03', flowStartDate: '2026-01-01' }, [], 0, '2026-01-03T00:00:00Z');
  state.dashboardResolvers.splice(0).forEach((done) => done(empty)); await settle();
  check(text().includes('Connexion requise') && !fixture.querySelector('section[aria-label="Dashboard Daily v2"]') && !fixture.querySelector('table'), 'dashboard no stale results after logout');
  pass('real dashboard refetch/logout destroys its pending result');

  check(state.mutationCalls === 0, 'no data mutations or exports executed');
  render(null); client.clear(); pass('cleanup / zero external operations');
  results.textContent += `\nALL PASS (${completed.length} scenarios)`;
}
document.querySelector<HTMLButtonElement>('#run')!.onclick = () => {
  document.querySelector<HTMLButtonElement>('#run')!.disabled = true;
  run().catch((error) => { results.textContent += `\nFAIL: ${error.message}`; });
};
