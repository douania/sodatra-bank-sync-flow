import { DailyV2ServiceError } from '../dailyV2ReportingReadCore';
import type { DailyV2ReportingReadFilters } from '../dailyV2ReportingReadCore';
import { buildDashboardSnapshot, planDashboardRead, type DashboardInput } from './dailyV2DashboardModel';

export function canReadDashboard(roles: readonly string[]): boolean {
  return roles.includes('admin') || roles.includes('auditor');
}
export function resolveDashboardAccess(input: {
  session: boolean; loading: boolean; targetAllowed: boolean;
  pending: boolean; fetching: boolean; error: boolean; roles: readonly string[];
}): 'checking' | 'allowed' | 'blocked' {
  if (input.loading || (input.session && input.targetAllowed && (input.pending || input.fetching))) return 'checking';
  return input.session && input.targetAllowed && !input.error && canReadDashboard(input.roles) ? 'allowed' : 'blocked';
}
export interface DashboardReader {
  roles(): Promise<readonly string[]>;
  read(filters: DailyV2ReportingReadFilters): Promise<{ rows: unknown; totalCount: number }>;
}
/** Pure orchestration seam: production provides only the existing guarded reader. */
export async function readDashboard(input: DashboardInput, reader: DashboardReader) {
  const plan = planDashboardRead(input);
  if (!canReadDashboard(await reader.roles())) {
    throw new DailyV2ServiceError('Vue réservée aux rôles admin et auditor.', 'DASHBOARD_ACCESS_DENIED');
  }
  const { rows, totalCount } = await reader.read(plan.read);
  return buildDashboardSnapshot(input, rows, totalCount, new Date().toISOString());
}
