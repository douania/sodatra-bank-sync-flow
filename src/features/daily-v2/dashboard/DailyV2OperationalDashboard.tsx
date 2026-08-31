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
  if (loading || !user) return <DailyV2DashboardAccessGate status={loading ? 'checking' : 'blocked'} reason="session" renderAuthorized={() => null} />;
  return <AuthenticatedDashboard key={user!.id} userId={user.id} />;
}

function AuthenticatedDashboard({ userId }: { userId: string }) {
  const { targetAllowed, rolesQuery, roles } = useDailyV2Access();
  // Preserve submitted parameters during role refetch, never a draft or a financial snapshot.
  const [savedInput, setSavedInput] = useState<{ userId: string; value: DashboardInput } | null>(null);
  const now = Date.now();
  const status = resolveDashboardAccess({ session: true, loading: false, targetAllowed,
    pending: rolesQuery.isPending, fetching: rolesQuery.isFetching, error: rolesQuery.isError, roles });
  return <DailyV2DashboardAccessGate status={status} reason={!targetAllowed ? 'target' : rolesQuery.isError ? 'lookup' : 'role'} renderAuthorized={() => (
    <DailyV2DashboardPanel
      key={userId}
      initialInput={savedInput?.userId === userId ? savedInput.value : {
        asOfDate: new Date(now).toISOString().slice(0, 10),
        flowStartDate: new Date(now - 29 * 86_400_000).toISOString().slice(0, 10),
      }}
      onInputSubmit={(value) => setSavedInput({ userId, value })}
      generate={generateDailyV2Dashboard}
    />
  )} />;
}
