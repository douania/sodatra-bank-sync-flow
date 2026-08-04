export interface CollectionsCoreRuntimeInput {
  enabled?: string;
  supabaseUrl?: string;
}

export type CollectionsCoreRuntimeVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function validateCollectionsCoreRuntimeTarget(
  input: CollectionsCoreRuntimeInput,
): CollectionsCoreRuntimeVerdict {
  if (input.enabled !== 'true') {
    return { allowed: false, reason: 'Le module Collections Core local n’est pas activé.' };
  }

  try {
    const hostname = new URL(input.supabaseUrl ?? '').hostname
      .toLowerCase()
      .replace(/^\[(.*)\]$/, '$1');
    if (!LOCAL_HOSTS.has(hostname)) {
      return { allowed: false, reason: 'Collections Core est limité à la pile locale.' };
    }
  } catch {
    return { allowed: false, reason: 'La cible Collections Core est invalide.' };
  }

  return { allowed: true };
}

export function currentCollectionsCoreRuntimeVerdict(): CollectionsCoreRuntimeVerdict {
  return validateCollectionsCoreRuntimeTarget({
    enabled: import.meta.env.VITE_COLLECTIONS_CORE_LOCAL_ENABLED,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  });
}
