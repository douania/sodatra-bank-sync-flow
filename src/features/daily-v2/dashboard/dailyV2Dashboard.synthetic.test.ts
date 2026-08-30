import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildDashboardSnapshot, buildDashboardSnapshotWithAlias, planDashboardRead, DASHBOARD_POSITION_LOOKBACK_DAYS, type DashboardInput, type DashboardSnapshot } from './dailyV2DashboardModel';
import { canReadDashboard, readDashboard } from './dailyV2DashboardRead';
import { classifyDashboardFailure, createDashboardController, type DashboardState } from './dailyV2DashboardController';
import { DailyV2ServiceError, runDailyV2CanonicalReportingRead } from '../dailyV2ReportingReadCore';
import type { DailyV2ReportingUnitRow } from '../dailyV2Types';

const input: DashboardInput = { asOfDate: '2026-06-30', flowStartDate: '2026-06-01' };
const generatedAt = '2026-07-01T10:00:00Z';
function unit(index: number, patch: Partial<DailyV2ReportingUnitRow> = {}): DailyV2ReportingUnitRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    accounting_date: '2026-06-30', bank: 'BDK', currency: 'XOF',
    account_fingerprint: 'synthetic-account-alpha', line_count: 2,
    day_total_debits: 0.1, day_total_credits: 0.3,
    opening_balance_derived: 10, closing_balance_derived: 10.2,
    aggregates_status: 'derived', validation_status: 'valid',
    ingested_at: generatedAt, ...patch,
  };
}
const build = (rows: unknown[], filters = input) => buildDashboardSnapshot(filters, rows, rows.length, generatedAt);
const safeCode = (code: string) => (error: unknown) => error instanceof DailyV2ServiceError && error.safeCode === code;

test('bounds one read to exactly 400 days while preserving a separate flow period and filters', () => {
  const plan = planDashboardRead({ ...input, bank: ' bdk ', currency: ' xof ' });
  assert.equal((Date.parse(plan.read.endDate) - Date.parse(plan.read.startDate)) / 86_400_000 + 1, 400);
  assert.equal(DASHBOARD_POSITION_LOOKBACK_DAYS, 400);
  assert.equal(plan.periodDays, 30); assert.equal(plan.read.bank, 'BDK'); assert.equal(plan.read.currency, 'XOF');
});
test('refuses invalid calendars, reversed/oversized periods and unsafe filter syntax', () => {
  for (const patch of [
    { asOfDate: '2026-02-30' }, { asOfDate: '' }, { flowStartDate: '2026-07-01' },
    { flowStartDate: '2020-01-01' }, { bank: 'BDK,ORA' }, { currency: 'XOF%' },
  ]) assert.throws(() => planDashboardRead({ ...input, ...patch }), safeCode('DASHBOARD_FILTERS_INVALID'));
});
test('latest balance per account is selected, never sum of historical balances; flows stay in period', async () => {
  const result = await build([
    unit(1, { accounting_date: '2026-05-20', closing_balance_derived: 900, day_total_credits: 890.1 }),
    unit(2, { accounting_date: '2026-06-10', closing_balance_derived: 5 }),
    unit(3, { closing_balance_derived: 0 }),
  ]);
  const account = result.accounts[0];
  assert.equal(account.closingMinor, 0n); assert.equal(account.debitsMinor, 20n);
  assert.equal(account.creditsMinor, 60n); assert.equal(account.netMinor, 40n);
  assert.equal(account.lastStatementDate, '2026-06-30'); assert.equal(account.ageDays, 0);
  assert.equal(account.observedDays, 2); assert.equal(account.unobservedCalendarDays, 28);
  assert.ok(!('closingMinor' in result.currencies[0]));
});
test('keeps multiple accounts and currencies distinct with exact currency totals', async () => {
  const result = await build([
    unit(1), unit(2, { account_fingerprint: 'synthetic-account-beta', closing_balance_derived: -1.2 }),
    unit(3, { currency: 'USD', closing_balance_derived: 0.3 }),
  ]);
  assert.equal(result.accounts.length, 3); assert.equal(result.currencies.length, 2);
  assert.equal(result.accounts.find((row) => row.currency === 'USD')!.closingMinor, 30n);
  assert.equal(result.currencies.find((row) => row.currency === 'XOF')!.netMinor, 40n);
  assert.ok(result.currencies.every((row) => !('closingMinor' in row)));
  assert.ok(!('grandTotal' in result));
});
test('keeps position date and staleness even if no movement was observed in the flow window', async () => {
  const result = await build([unit(1, { accounting_date: '2026-05-31' })]);
  const account = result.accounts[0];
  assert.equal(account.lastStatementDate, '2026-05-31'); assert.equal(account.ageDays, 30);
  assert.equal(account.closingMinor, 1020n); assert.equal(account.observedDays, 0);
  assert.equal(account.debitsMinor, null); assert.equal(account.netMinor, null);
  assert.equal(result.currencies[0].debitsMinor, null); assert.equal(result.currencies[0].olderStatementCount, 1);
});
test('latest unavailable/needs-review/null balance never falls back to an earlier balance', async () => {
  for (const patch of [
    { closing_balance_derived: null }, { aggregates_status: 'unavailable' as const },
    { validation_status: 'needs_review' as const },
  ]) {
    const result = await build([unit(1, { accounting_date: '2026-06-10' }), unit(2, patch)]);
    assert.equal(result.accounts[0].closingMinor, null); assert.equal(result.accounts[0].lastStatementDate, input.asOfDate);
    assert.equal(result.currencies[0].knownPositionCount, 0);
  }
});
test('currency displays position coverage only, never an aggregated or partial balance', async () => {
  const result = await build([unit(1), unit(2, { account_fingerprint: 'synthetic-beta', closing_balance_derived: null })]);
  assert.ok(!('closingMinor' in result.currencies[0])); assert.equal(result.currencies[0].knownPositionCount, 1);
});
test('unreviewed or unavailable aggregates suppress observed flow sums for the affected scope', async () => {
  const result = await build([unit(1, { validation_status: 'needs_review', aggregates_status: 'unavailable' })]);
  assert.equal(result.accounts[0].reviewDays, 1); assert.equal(result.accounts[0].unavailableDays, 1);
  assert.equal(result.accounts[0].creditsMinor, null); assert.equal(result.currencies[0].netMinor, null);
});
test('zero observed amounts with a real source remain zero; empty source is not invented zero', async () => {
  const zero = await build([unit(1, { day_total_debits: 0, day_total_credits: 0, closing_balance_derived: 0 })]);
  assert.equal(zero.accounts[0].netMinor, 0n);
  const empty = await build([]); assert.deepEqual(empty.accounts, []); assert.deepEqual(empty.currencies, []);
});
test('invalid count, duplicate IDs or duplicate accounting days refuse the whole snapshot', async () => {
  await assert.rejects(() => buildDashboardSnapshot(input, [unit(1)], 2, generatedAt), safeCode('DASHBOARD_RESPONSE_INVALID'));
  await assert.rejects(() => build([unit(1), unit(1, { accounting_date: '2026-06-29' })]), safeCode('DASHBOARD_DUPLICATE_UNIT'));
  await assert.rejects(() => build([unit(1), unit(2)]), safeCode('DASHBOARD_DUPLICATE_UNIT'));
});
test('source rows outside the read boundary, invalid dates and incorrect filters are refused', async () => {
  for (const date of ['2026-07-01', '2020-01-01', '2026-02-30', '2026-06-20 ', ' 2026-06-20', '2026-06-20\n']) {
    await assert.rejects(() => build([unit(1, { accounting_date: date })]), safeCode('DASHBOARD_RESPONSE_INVALID'));
  }
  await assert.rejects(() => build([unit(1)], { ...input, bank: 'ORA' }), safeCode('DASHBOARD_RESPONSE_INVALID'));
  await assert.rejects(() => build([unit(1)], { ...input, currency: 'USD' }), safeCode('DASHBOARD_RESPONSE_INVALID'));
});
test('unsafe monetary precision fails closed even on an older row; no hidden rounding', async () => {
  await assert.rejects(() => build([unit(1, { accounting_date: '2026-05-01', closing_balance_derived: 0.001 })]), safeCode('DASHBOARD_AMOUNTS_UNSAFE'));
  await assert.rejects(() => build([unit(1, { day_total_credits: Infinity })]), safeCode('DASHBOARD_RESPONSE_INVALID'));
});
test('refuses oversized source and fields from staging/transaction projections', async () => {
  await assert.rejects(() => build(Array.from({ length: 5001 }, (_, index) => unit(index))), safeCode('DASHBOARD_RESPONSE_INVALID'));
  await assert.rejects(() => build([{ ...unit(1), status: 'staged' }]), safeCode('DASHBOARD_RESPONSE_INVALID'));
  await assert.rejects(() => build([{ ...unit(1), description: 'synthetic transaction' }]), safeCode('DASHBOARD_RESPONSE_INVALID'));
});
test('alias collision refuses whole result and no technical source field reaches the safe DTO', async () => {
  const rows = [unit(1), unit(2, { account_fingerprint: 'synthetic-beta' })];
  await assert.rejects(() => buildDashboardSnapshotWithAlias(input, rows, 2, generatedAt, async () => 'C-0000000000000000'), safeCode('DASHBOARD_ALIAS_COLLISION'));
  const text = JSON.stringify(await build(rows), (_, value) => typeof value === 'bigint' ? value.toString() : value);
  assert.doesNotMatch(text, /synthetic-account|synthetic-beta|account_fingerprint|ingested_at|00000000-0000|"id"/);
});
test('ordering does not change the result', async () => {
  const rows = [unit(1, { bank: 'ORA' }), unit(2, { currency: 'USD' }), unit(3, { accounting_date: '2026-06-12' })];
  assert.deepEqual(await build(rows), await build([...rows].reverse()));
});
test('access gate allows admin/auditor only, validates before any read and propagates denial', async () => {
  for (const roles of [[], ['manager'], ['user'], ['unknown']]) {
    let reads = 0;
    assert.equal(canReadDashboard(roles), false);
    await assert.rejects(() => readDashboard(input, { roles: async () => roles, read: async () => { reads++; return { rows: [], totalCount: 0 }; } }), safeCode('DASHBOARD_ACCESS_DENIED'));
    assert.equal(reads, 0);
  }
  for (const role of ['admin', 'auditor']) {
    let reads = 0;
    await readDashboard(input, { roles: async () => [role], read: async (filters) => { reads++; assert.deepEqual(filters, planDashboardRead(input).read); return { rows: [], totalCount: 0 }; } });
    assert.equal(reads, 1);
  }
  await assert.rejects(() => readDashboard({ ...input, asOfDate: '' }, { roles: async () => { throw Error('must not reach roles'); }, read: async () => { throw Error('must not read'); } }), safeCode('DASHBOARD_FILTERS_INVALID'));
});
test('reuses fail-closed epoch reader: concurrent mutation cannot produce a dashboard', async () => {
  let epoch = 0;
  await assert.rejects(() => readDashboard(input, {
    roles: async () => ['admin'],
    read: (filters) => runDailyV2CanonicalReportingRead({
      readEpochCount: async () => ++epoch,
      readAnchor: async () => ({ data: [], count: 0 }),
      readPage: async () => { throw Error('unexpected'); },
    }, filters),
  }), safeCode('REPORT_CONCURRENT_CANONICAL_MUTATION'));
});
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test('controller drops prior results immediately and ignores stale successes and errors', async () => {
  const pending = [deferred<DashboardSnapshot>(), deferred<DashboardSnapshot>()];
  let call = 0;
  const states: DashboardState[] = [];
  const controller = createDashboardController(() => pending[call++].promise, (state) => states.push(state));
  const first = controller.load(input); const second = controller.load(input);
  const result = await build([unit(1)]);
  pending[1].resolve(result); await second;
  pending[0].reject(Error('private-server-payload')); await first;
  assert.equal(states.length, 3); assert.deepEqual(states[2], { status: 'ready', snapshot: result });
  controller.invalidate(); assert.deepEqual(states.at(-1), { status: 'idle' });
});
test('filter edits and unmount/access loss prevent delayed results reappearing', async () => {
  for (const action of ['invalidate', 'dispose'] as const) {
    const waiting = deferred<DashboardSnapshot>(); const states: DashboardState[] = [];
    const controller = createDashboardController(() => waiting.promise, (state) => states.push(state));
    const request = controller.load(input); controller[action]();
    waiting.resolve(await build([unit(1)])); await request;
    assert.ok(states.every((state) => state.status !== 'ready'));
  }
});
test('refresh failure clears financial state and does not expose the error text', async () => {
  const states: DashboardState[] = []; let call = 0;
  const controller = createDashboardController(async () => {
    if (call++) throw Error('SENSITIVE-NOT-FOR-UI'); return build([unit(1)]);
  }, (state) => states.push(state));
  await controller.load(input); await controller.load(input);
  assert.deepEqual(states.at(-2), { status: 'loading' }); assert.deepEqual(states.at(-1), { status: 'error', failure: 'generic' });
});
test('runtime service uses only the existing guarded reader; dashboard is source-separated, not blended', () => {
  const service = readFileSync(new URL('./dailyV2DashboardService.ts', import.meta.url), 'utf8');
  assert.match(service, /roles: getCurrentUserDailyV2Roles/); assert.match(service, /read: listDailyV2CanonicalUnitsForReporting/);
  assert.doesNotMatch(service, /\.from\(|\.rpc\(|createClient|localStorage|console\./);
  const page = readFileSync(new URL('../../../pages/Dashboard.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('DailyV2OperationalDashboard')); assert.ok(page.includes('LegacyDashboard'));
  const gate = readFileSync(new URL('./DailyV2OperationalDashboard.tsx', import.meta.url), 'utf8');
  assert.match(gate, /key=\{user!\.id\}/); assert.match(gate, /rolesQuery\.isError/); assert.ok(gate.includes('resolveDashboardAccess'));
  assert.doesNotMatch(gate, /getDailyV2MutationsEnabled|applyDailyV2RuntimeMutationLock/);
});

test('two identities possibly belonging to one physical account never yield a currency balance total', async () => {
  const result = await build([
    unit(1, { accounting_date: '2026-01-01', account_fingerprint: 'synthetic-old-identity', closing_balance_derived: 100 }),
    unit(2, { account_fingerprint: 'synthetic-new-identity', closing_balance_derived: 200 }),
  ]);
  assert.equal(result.accounts.length, 2);
  assert.deepEqual(result.accounts.map((a) => a.closingMinor).sort(), [10000n, 20000n]);
  assert.ok(result.currencies.every((currency) => !('closingMinor' in currency)));
});
test('currency coverage counts observed account-days instead of implying full period coverage', async () => {
  const result = await build([
    unit(1), unit(2, { accounting_date: '2026-06-20' }),
    unit(3, { account_fingerprint: 'synthetic-beta' }),
  ]);
  assert.equal(result.currencies[0].observedAccountDays, 3);
  assert.equal(result.currencies[0].possibleAccountDays, 60);
});
test('exactly 5000 valid units retain all identities and only in-period flows', async () => {
  const rows = Array.from({ length: 5000 }, (_, i) => unit(i, {
    accounting_date: new Date(Date.parse('2026-06-30T00:00:00Z') - (i % 250) * 86_400_000).toISOString().slice(0, 10),
    account_fingerprint: `synthetic-boundary-${Math.floor(i / 250)}`,
  }));
  const result = await build(rows);
  assert.equal(result.sourceUnitCount, 5000); assert.equal(result.accounts.length, 20);
  assert.equal(result.currencies[0].netMinor, 12000n);
  assert.equal(result.currencies[0].observedAccountDays, 600);
  assert.equal(result.currencies[0].possibleAccountDays, 600);
  assert.ok(result.accounts.every((a) => a.closingMinor === 1020n && a.ageDays === 0));
});
test('safe errors are whitelisted into actionable classes without exposing arbitrary codes or payloads', async () => {
  for (const [code, failure] of [
    ['DASHBOARD_FILTERS_INVALID', 'filters'], ['REPORT_TOO_MANY_UNITS', 'volume'],
    ['DASHBOARD_ACCESS_DENIED', 'access'], ['REPORT_CONCURRENT_CANONICAL_MUTATION', 'concurrent'],
    ['PRIVATE-UNKNOWN-CODE', 'generic'],
  ]) {
    const error = new DailyV2ServiceError('PRIVATE-PAYLOAD', code);
    assert.equal(classifyDashboardFailure(error), failure);
    const states: DashboardState[] = [];
    await createDashboardController(async () => { throw error; }, (state) => states.push(state)).load(input);
    assert.deepEqual(states.at(-1), { status: 'error', failure });
    assert.doesNotMatch(JSON.stringify(states), /PRIVATE/);
  }
  assert.equal(classifyDashboardFailure({ safeCode: 'REPORT_TOO_MANY_UNITS', message: 'PRIVATE' }), 'generic');
});
test('invalid aliases and negative debit aggregates fail closed', async () => {
  await assert.rejects(() => buildDashboardSnapshotWithAlias(input, [unit(1)], 1, generatedAt, async () => 'PRIVATE-ALIAS'), safeCode('DASHBOARD_ALIAS_INVALID'));
  await assert.rejects(() => build([unit(1, { day_total_debits: -1 })]), safeCode('DASHBOARD_RESPONSE_INVALID'));
});
test('future as-of is an explicit query date, never a forecast or invented balance', async () => {
  const result = await build([unit(1)], { asOfDate: '2026-07-10', flowStartDate: '2026-06-01' });
  assert.equal(result.accounts[0].lastStatementDate, '2026-06-30');
  assert.equal(result.accounts[0].ageDays, 10); assert.equal(result.accounts[0].closingMinor, 1020n);
});
