import type { DashboardInput, DashboardSnapshot } from './dailyV2DashboardModel';
import { DailyV2ServiceError } from '../dailyV2ReportingReadCore';

export type DashboardFailure = 'filters' | 'volume' | 'access' | 'concurrent' | 'generic';
export function classifyDashboardFailure(error: unknown): DashboardFailure {
  if (!(error instanceof DailyV2ServiceError)) return 'generic';
  if (error.safeCode === 'DASHBOARD_FILTERS_INVALID') return 'filters';
  if (error.safeCode === 'REPORT_TOO_MANY_UNITS') return 'volume';
  if (error.safeCode === 'DASHBOARD_ACCESS_DENIED') return 'access';
  if (error.safeCode === 'REPORT_CONCURRENT_CANONICAL_MUTATION') return 'concurrent';
  return 'generic';
}

export type DashboardState =
  | { status: 'idle' | 'loading'; snapshot?: never }
  | { status: 'error'; failure?: DashboardFailure; snapshot?: never }
  | { status: 'ready'; snapshot: DashboardSnapshot };

/** Ignore stale resolutions/rejections after editing, refresh, access loss or unmount. */
export function createDashboardController(
  generate: (input: DashboardInput) => Promise<DashboardSnapshot>,
  publish: (state: DashboardState) => void,
) {
  let generation = 0;
  let disposed = false;
  return {
    invalidate() { generation++; if (!disposed) publish({ status: 'idle' }); },
    dispose() { generation++; disposed = true; },
    async load(input: DashboardInput) {
      if (disposed) return;
      const request = ++generation;
      publish({ status: 'loading' });
      try {
        const snapshot = await generate({ ...input });
        if (!disposed && request === generation) publish({ status: 'ready', snapshot });
      } catch (error) {
        // Never expose raw exception text, banking values or transport payloads.
        if (!disposed && request === generation) publish({ status: 'error', failure: classifyDashboardFailure(error) });
      }
    },
  };
}
