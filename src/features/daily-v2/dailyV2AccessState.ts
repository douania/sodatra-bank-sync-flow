import type { DailyV2RuntimeTargetVerdict } from './dailyV2RuntimeTarget';

export type DailyV2AccessBlockReason =
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
  targetVerdict: DailyV2RuntimeTargetVerdict;
  rolesPending: boolean;
  rolesError: boolean;
  canAccessPage: boolean;
}

export function classifyDailyV2AccessState({
  targetVerdict,
  rolesPending,
  rolesError,
  canAccessPage,
}: ClassifyDailyV2AccessInput): DailyV2AccessState {
  if ('reason' in targetVerdict) {
    return {
      status: 'blocked',
      reason: 'runtime_target_rejected',
      safeDetail: targetVerdict.reason,
    };
  }

  if (rolesPending) {
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
