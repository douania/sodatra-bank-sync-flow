import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { currentDailyV2RuntimeTargetVerdict } from './dailyV2RuntimeTarget';
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
  const { user } = useAuth();
  const targetVerdict = currentDailyV2RuntimeTargetVerdict();
  const targetAllowed = targetVerdict.allowed;
  const rolesQuery = useQuery<DailyV2AppRole[]>({
    queryKey: ['daily-v2', 'roles', user?.id],
    queryFn: getCurrentUserDailyV2Roles,
    enabled: Boolean(user?.id) && targetAllowed,
    staleTime: 5 * 60 * 1000,
  });
  const roles = rolesQuery.data ?? [];
  const canAccessPage = targetAllowed && canAccessDailyV2Page(roles);
  const accessState = classifyDailyV2AccessState({
    targetVerdict,
    rolesPending: rolesQuery.isPending,
    rolesError: rolesQuery.isError,
    canAccessPage,
  });

  return {
    roles,
    rolesQuery,
    targetAllowed,
    canAccessPage,
    accessState,
  };
}
