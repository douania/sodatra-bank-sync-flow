import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  currentDailyV2Capabilities,
  currentDailyV2RuntimeTargetVerdict,
  type DailyV2Capability,
} from './dailyV2RuntimeTarget';
import { getCurrentUserDailyV2Roles } from './dailyV2SupabaseService';
import type { DailyV2AppRole } from './dailyV2Types';
import { classifyDailyV2AccessState } from './dailyV2AccessState';

const DAILY_V2_PAGE_ACCESS_ROLES: ReadonlySet<DailyV2AppRole> = new Set([
  'admin',
  'manager',
  'auditor',
]);

export function canAccessDailyV2Page(roles: readonly DailyV2AppRole[]): boolean {
  return roles.some((role) => DAILY_V2_PAGE_ACCESS_ROLES.has(role));
}

export function useDailyV2Access() {
  const { user, loading } = useAuth();
  // L'accès à la page et à la navigation relève de la seule capacité read.
  const targetVerdict = currentDailyV2RuntimeTargetVerdict('read');
  const targetAllowed = targetVerdict.allowed;
  const capabilities: Record<DailyV2Capability, boolean> = currentDailyV2Capabilities();
  const rolesQuery = useQuery<DailyV2AppRole[]>({
    queryKey: ['daily-v2', 'roles', user?.id],
    queryFn: getCurrentUserDailyV2Roles,
    enabled: Boolean(user?.id) && targetAllowed && !loading,
    staleTime: 5 * 60 * 1000,
    gcTime: 0,
  });
  const rolesReady = Boolean(user?.id) && !loading && !rolesQuery.isPending && !rolesQuery.isFetching && !rolesQuery.isError;
  const roles = rolesReady ? rolesQuery.data ?? [] : [];
  const canAccessPage = targetAllowed && canAccessDailyV2Page(roles);
  const accessState = classifyDailyV2AccessState({
    sessionPresent: Boolean(user?.id),
    sessionLoading: loading,
    rolesFetching: rolesQuery.isFetching,
    targetVerdict,
    rolesPending: rolesQuery.isPending,
    rolesError: rolesQuery.isError,
    canAccessPage,
  });

  return {
    roles,
    rolesQuery,
    targetAllowed,
    capabilities,
    canAccessPage,
    accessState,
  };
}
