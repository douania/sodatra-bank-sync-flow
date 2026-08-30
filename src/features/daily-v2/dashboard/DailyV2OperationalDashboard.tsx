import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDailyV2Access } from '../dailyV2Access';
import { resolveDashboardAccess } from './dailyV2DashboardRead';
import type { DashboardInput } from './dailyV2DashboardModel';
import { DailyV2DashboardAccessGate } from './DailyV2DashboardView';
import { DailyV2DashboardPanel } from './DailyV2DashboardPanel';
import { generateDailyV2Dashboard } from './dailyV2DashboardService';

export default function DailyV2OperationalDashboard() {
  const { user, loading } = useAuth();
  const { targetAllowed, rolesQuery, roles } = useDailyV2Access();
  // Preserve submitted parameters during role refetch, never a draft or a financial snapshot.
  const [savedInput, setSavedInput] = useState<{ userId: string; value: DashboardInput } | null>(null);
  const now = Date.now();
  const status = resolveDashboardAccess({ session: Boolean(user), loading, targetAllowed,
    pending: rolesQuery.isPending, fetching: rolesQuery.isFetching, error: rolesQuery.isError, roles });
  return <DailyV2DashboardAccessGate status={status} renderAuthorized={() => (
    <DailyV2DashboardPanel
      key={user!.id}
      initialInput={savedInput?.userId === user!.id ? savedInput.value : {
        asOfDate: new Date(now).toISOString().slice(0, 10),
        flowStartDate: new Date(now - 29 * 86_400_000).toISOString().slice(0, 10),
      }}
      onInputSubmit={(value) => setSavedInput({ userId: user!.id, value })}
      generate={generateDailyV2Dashboard}
    />
  )} />;
}
