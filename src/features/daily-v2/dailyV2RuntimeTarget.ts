export const DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv';

export interface DailyV2RuntimeTargetInput {
  supabaseUrl?: string;
  projectId?: string;
}

export type DailyV2RuntimeTargetVerdict =
  | { allowed: true; projectRef: typeof DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF }
  | { allowed: false; reason: string };

export function validateDailyV2RuntimeTarget(
  input: DailyV2RuntimeTargetInput,
): DailyV2RuntimeTargetVerdict {
  const supabaseUrl = input.supabaseUrl?.trim() ?? '';
  const projectId = input.projectId?.trim() ?? '';

  if (supabaseUrl === '') {
    return { allowed: false, reason: 'VITE_SUPABASE_URL is required for Daily v2.' };
  }

  let projectRefFromUrl: string;
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase();
    if (!hostname.endsWith('.supabase.co')) {
      return { allowed: false, reason: 'Daily v2 requires a standard Supabase project URL.' };
    }
    projectRefFromUrl = hostname.slice(0, -'.supabase.co'.length);
  } catch {
    return { allowed: false, reason: 'VITE_SUPABASE_URL is invalid.' };
  }

  if (projectRefFromUrl !== DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF) {
    return { allowed: false, reason: 'Daily v2 target is not the authorized staging project.' };
  }
  if (projectId !== '' && projectId !== DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF) {
    return { allowed: false, reason: 'VITE_SUPABASE_PROJECT_ID contradicts the authorized staging target.' };
  }

  return { allowed: true, projectRef: DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF };
}

export function currentDailyV2RuntimeTargetVerdict(): DailyV2RuntimeTargetVerdict {
  return validateDailyV2RuntimeTarget({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID,
  });
}
