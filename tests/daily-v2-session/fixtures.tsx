import { useSyncExternalStore } from 'react';
import { buildDashboardSnapshot } from '../../src/features/daily-v2/dashboard/dailyV2DashboardModel';

export const state = {
  auth: { user: { id: 'synthetic-a' } as { id: string } | null, loading: false },
  roles: ['admin'], rolesFail: false, rolesDeferred: false, canonicalDeferred: false,
  lock: false, lockDeferred: false, lockFail: false,
  roleResolvers: [] as Array<(value: string[]) => void>,
  canonicalResolvers: [] as Array<(value: unknown) => void>,
  lockResolvers: [] as Array<(value: boolean) => void>,
  reportResolvers: [] as Array<(value: unknown) => void>,
  dashboardResolvers: [] as Array<(value: unknown) => void>,
  dashboardDeferred: false, canonicalCalls: 0, reads: 0, mutationCalls: 0,
  toasts: [] as string[],
};
const listeners = new Set<() => void>();
export const authChange = (user: string | null, loading = false) => {
  state.auth = { user: user ? { id: user } : null, loading }; listeners.forEach((notify) => notify());
};
export function useAuth() { return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => state.auth); }
export class DailyV2ServiceError extends Error { constructor(message: string, public safeCode?: string) { super(message); } }
export const toast = { success: (message: string) => state.toasts.push(message), error: (message: string) => state.toasts.push(message) };
export async function getCurrentUserDailyV2Roles() {
  if (state.rolesFail) throw new Error('synthetic-role-error');
  return state.rolesDeferred ? new Promise<string[]>((resolve) => state.roleResolvers.push(resolve)) : state.roles;
}
export async function getDailyV2MutationsEnabled() {
  if (state.lockFail) throw new Error('synthetic-lock-error');
  return state.lockDeferred ? new Promise<boolean>((resolve) => state.lockResolvers.push(resolve)) : state.lock;
}
export const currentDailyV2RuntimeTargetVerdict = () => ({ allowed: true, projectRef: 'synthetic-staging' });
export const currentDailyV2Capabilities = () => ({ read: true, deposit: true, promote: true, admin: true });
export const isDailyV2ProductionPilotProject = () => false;
export const applyDailyV2RuntimeMutationLock = (capabilities: ReturnType<typeof currentDailyV2Capabilities>, value: boolean) => ({ ...capabilities, deposit: capabilities.deposit && value === true, promote: capabilities.promote && value === true, admin: capabilities.admin && value === true });
export const resolveDailyV2ImportPermissions = (role: boolean, target: ReturnType<typeof currentDailyV2Capabilities>, effective: ReturnType<typeof currentDailyV2Capabilities>) => ({ canPrepareLocally: role && target.deposit, canPersist: role && target.deposit && effective.deposit });
export const canonicalPage = (name: string) => ({ count: 1, rows: [{ id: name, accounting_date: '2026-01-02', bank: name, currency: 'XOF', status: 'ingested', validation_status: 'valid', aggregates_status: 'derived', review_reason_codes: [], line_count: 1, day_total_debits: 1, day_total_credits: 2 }] });
export async function listDailyV2CanonicalUnits() {
  state.canonicalCalls++;
  return state.canonicalDeferred ? new Promise((resolve) => state.canonicalResolvers.push(resolve)) : canonicalPage(state.auth.user?.id ?? 'none');
}
const emptyPage = async () => { state.reads++; return { rows: [], count: 0 }; };
const empty = async () => [];
export const listDailyV2StagingUnits = emptyPage, listDailyV2AuditEvents = emptyPage, listDailyV2AccountEvents = emptyPage;
export const listDailyV2Accounts = empty, listDailyV2BackfillGrants = empty, listDailyV2CanonicalLines = empty, listDailyV2StagingLines = empty;
export const getDailyV2AccountOpaqueIdentity = () => 'synthetic-opaque';
const mutation = async () => { state.mutationCalls++; throw Error('No real mutation permitted'); };
export const prepareDailyV2BrowserDeposit = mutation, preIngestDailyV2WithIncrementalDelta = mutation,
  provisionDailyV2Account = mutation, deactivateDailyV2Account = mutation, issueDailyV2BackfillGrant = mutation,
  revokeDailyV2BackfillGrant = mutation, promoteDailyV2Unit = mutation, supersedeDailyV2Unit = mutation,
  getActiveDailyV2CanonicalUnit = mutation;
export const generateDailyV2Report = async () => new Promise((resolve) => state.reportResolvers.push(resolve));
export const downloadDailyV2SummaryCsv = mutation, downloadDailyV2SummaryXlsx = mutation;
export async function generateDailyV2Dashboard(input: Parameters<typeof buildDashboardSnapshot>[0]) {
  if (state.dashboardDeferred) return new Promise((resolve) => state.dashboardResolvers.push(resolve));
  return buildDashboardSnapshot(input, [], 0, '2026-01-03T00:00:00Z');
}
