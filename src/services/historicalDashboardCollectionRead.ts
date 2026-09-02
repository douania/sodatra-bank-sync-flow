import type { CollectionReport } from '@/types/banking';

export const HISTORICAL_DASHBOARD_COLLECTION_SAMPLE_LIMIT = 1_000;
export const HISTORICAL_DASHBOARD_COLLECTION_READ_FAILED =
  'HISTORICAL_DASHBOARD_COLLECTION_READ_FAILED';
export const HISTORICAL_DASHBOARD_COLLECTION_USER_ERROR_MESSAGE =
  'Impossible de charger les données Collection Report historiques. Réessayez dans quelques instants.';

export interface HistoricalDashboardCollectionSnapshot {
  reports: CollectionReport[];
  totalCount: number;
  loadedCount: number;
  isPartial: boolean;
}

export function getHistoricalDashboardCollectionUserErrorMessage(error: unknown): string | null {
  return error instanceof Error && error.message === HISTORICAL_DASHBOARD_COLLECTION_READ_FAILED
    ? HISTORICAL_DASHBOARD_COLLECTION_USER_ERROR_MESSAGE
    : null;
}

export function buildHistoricalDashboardCollectionSnapshot(
  reports: CollectionReport[],
  totalCount: number | null,
): HistoricalDashboardCollectionSnapshot {
  if (
    totalCount === null
    || !Number.isSafeInteger(totalCount)
    || totalCount < 0
    || totalCount < reports.length
  ) {
    throw new Error('HISTORICAL_DASHBOARD_COLLECTION_COUNT_INVALID');
  }

  return {
    reports,
    totalCount,
    loadedCount: reports.length,
    isPartial: reports.length < totalCount,
  };
}
