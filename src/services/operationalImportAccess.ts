export type OperationalImportRole = 'admin' | 'manager' | 'auditor' | 'user';

export interface OperationalImportAccessInput {
  targetAllowsMutation: boolean;
  roles: readonly OperationalImportRole[];
  rolesPending: boolean;
  rolesError: boolean;
}

export type OperationalImportAccessVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'target_read_only' | 'roles_pending' | 'role_lookup_failed' | 'insufficient_role';
    };

export function canOperateImports(roles: readonly OperationalImportRole[]): boolean {
  return roles.includes('admin') || roles.includes('manager');
}

/** Garde UI fail-closed. La sécurité réelle reste assurée côté serveur. */
export function evaluateOperationalImportAccess({
  targetAllowsMutation,
  roles,
  rolesPending,
  rolesError,
}: OperationalImportAccessInput): OperationalImportAccessVerdict {
  if (!targetAllowsMutation) return { allowed: false, reason: 'target_read_only' };
  if (rolesPending) return { allowed: false, reason: 'roles_pending' };
  if (rolesError) return { allowed: false, reason: 'role_lookup_failed' };
  if (!canOperateImports(roles)) return { allowed: false, reason: 'insufficient_role' };
  return { allowed: true };
}
