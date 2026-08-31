import type { DailyV2RuntimeTargetVerdict } from './dailyV2RuntimeTarget';

export type DailyV2AccessBlockReason =
  | 'session_required'
  | 'runtime_target_rejected'
  | 'role_lookup_failed'
  | 'insufficient_role';

export type DailyV2AccessState =
  | { status: 'checking' }
  | { status: 'allowed' }
  | {
      status: 'blocked';
      reason: DailyV2AccessBlockReason;
      safeDetail?: string;
    };

export interface ClassifyDailyV2AccessInput {
  sessionPresent?: boolean;
  sessionLoading?: boolean;
  rolesFetching?: boolean;
  targetVerdict: DailyV2RuntimeTargetVerdict;
  rolesPending: boolean;
  rolesError: boolean;
  canAccessPage: boolean;
}

export function classifyDailyV2AccessState({
  sessionPresent = true,
  sessionLoading = false,
  rolesFetching = false,
  targetVerdict,
  rolesPending,
  rolesError,
  canAccessPage,
}: ClassifyDailyV2AccessInput): DailyV2AccessState {
  if (sessionLoading) return { status: 'checking' };
  if (!sessionPresent) return { status: 'blocked', reason: 'session_required' };
  if ('reason' in targetVerdict) {
    return {
      status: 'blocked',
      reason: 'runtime_target_rejected',
      safeDetail: targetVerdict.reason,
    };
  }

  if (rolesPending || rolesFetching) {
    return { status: 'checking' };
  }

  if (rolesError) {
    return { status: 'blocked', reason: 'role_lookup_failed' };
  }

  if (!canAccessPage) {
    return { status: 'blocked', reason: 'insufficient_role' };
  }

  return { status: 'allowed' };
}
