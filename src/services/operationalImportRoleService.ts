import { supabase } from '@/integrations/supabase/client';
import type { OperationalImportRole } from './operationalImportAccess';

const OPERATIONAL_IMPORT_ROLES: readonly OperationalImportRole[] = [
  'admin',
  'manager',
  'auditor',
  'user',
];

function isOperationalImportRole(value: string): value is OperationalImportRole {
  return OPERATIONAL_IMPORT_ROLES.includes(value as OperationalImportRole);
}

export async function getCurrentUserOperationalImportRoles(): Promise<OperationalImportRole[]> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (sessionError || !user) throw new Error('Une session authentifiée est requise.');

  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (error) throw new Error('Lecture des rôles impossible.');

  return Array.from(new Set(
    (data ?? [])
      .map(entry => entry.role)
      .filter((role): role is OperationalImportRole => isOperationalImportRole(role)),
  ));
}
