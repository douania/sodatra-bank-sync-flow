import {
  currentDailyV2RuntimeTargetVerdict,
  validateDailyV2RuntimeTarget,
  type DailyV2RuntimeTargetInput,
  type DailyV2RuntimeTargetVerdict,
} from '@/features/daily-v2/dailyV2RuntimeTarget';

export const COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE =
  "La cible Collection Report n'est pas autorisée. La préparation et la promotion restent bloquées.";

export type CollectionImportCapability = 'review' | 'promote';

/**
 * Static UI eligibility only. Both controlled targets may prepare/review and
 * expose the promotion action. The PostgreSQL scope remains authoritative for
 * every mutation and must return explicit true before the UI can call the RPC.
 */
export function validateCollectionImportTarget(
  input: DailyV2RuntimeTargetInput,
  capability: CollectionImportCapability,
): DailyV2RuntimeTargetVerdict {
  if (capability !== 'review' && capability !== 'promote') {
    return { allowed: false, reason: COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE };
  }
  const target = validateDailyV2RuntimeTarget(input, 'read');
  return target.allowed
    ? target
    : { allowed: false, reason: COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE };
}

export function currentCollectionImportTargetVerdict(
  capability: CollectionImportCapability,
): DailyV2RuntimeTargetVerdict {
  try {
    if (capability !== 'review' && capability !== 'promote') {
      return { allowed: false, reason: COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE };
    }
    const target = currentDailyV2RuntimeTargetVerdict('read');
    return target.allowed
      ? target
      : { allowed: false, reason: COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE };
  } catch {
    return { allowed: false, reason: COLLECTION_IMPORT_TARGET_BLOCKED_MESSAGE };
  }
}

export function isCollectionImportTargetAllowed(capability: CollectionImportCapability): boolean {
  return currentCollectionImportTargetVerdict(capability).allowed;
}
