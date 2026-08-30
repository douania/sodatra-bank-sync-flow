import { getCurrentUserDailyV2Roles, listDailyV2CanonicalUnitsForReporting } from '../dailyV2SupabaseService';
import { readDashboard } from './dailyV2DashboardRead';
import type { DashboardInput } from './dailyV2DashboardModel';

// No injectable client/adapter at the public UI boundary. Existing target,
// Auth, RLS, bounded pagination and canonical-epoch guards remain authoritative.
export function generateDailyV2Dashboard(input: DashboardInput) {
  return readDashboard(input, {
    roles: getCurrentUserDailyV2Roles,
    read: listDailyV2CanonicalUnitsForReporting,
  });
}
