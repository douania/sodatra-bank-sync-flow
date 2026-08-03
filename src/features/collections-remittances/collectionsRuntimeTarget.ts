export type CollectionsCapability = 'read' | 'mutate';

export interface CollectionsRuntimeTargetInput {
  supabaseUrl?: string;
  localEnabled?: string;
}

export type CollectionsRuntimeTargetVerdict =
  | { allowed: true; target: 'local' }
  | { allowed: false; reason: string };

export function validateCollectionsRuntimeTarget(
  input: CollectionsRuntimeTargetInput,
  capability: CollectionsCapability,
): CollectionsRuntimeTargetVerdict {
  if (capability !== 'read' && capability !== 'mutate') {
    return { allowed: false, reason: 'Capacité Collections inconnue.' };
  }
  if (input.localEnabled?.trim().toLowerCase() !== 'true') {
    return { allowed: false, reason: 'Le candidat Collections 0Z1B local n’est pas activé.' };
  }

  try {
    const url = new URL(input.supabaseUrl?.trim() ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      return { allowed: false, reason: 'Collections 0Z1B est limité à une cible locale.' };
    }
  } catch {
    return { allowed: false, reason: 'La cible locale Collections est invalide.' };
  }

  return { allowed: true, target: 'local' };
}

export function currentCollectionsRuntimeTargetVerdict(
  capability: CollectionsCapability,
): CollectionsRuntimeTargetVerdict {
  return validateCollectionsRuntimeTarget(
    {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      localEnabled: import.meta.env.VITE_COLLECTIONS_0Z1B_LOCAL_ENABLED,
    },
    capability,
  );
}

export function currentCollectionsCapabilities(): Record<CollectionsCapability, boolean> {
  return {
    read: currentCollectionsRuntimeTargetVerdict('read').allowed,
    mutate: currentCollectionsRuntimeTargetVerdict('mutate').allowed,
  };
}
