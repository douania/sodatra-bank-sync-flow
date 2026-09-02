import type { CollectionReport } from '@/types/banking';

export const HISTORICAL_DASHBOARD_COLLECTION_SAMPLE_LIMIT = 1_000;

export interface HistoricalDashboardCollectionSnapshot {
  reports: CollectionReport[];
  totalCount: number;
  loadedCount: number;
  isPartial: boolean;
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
