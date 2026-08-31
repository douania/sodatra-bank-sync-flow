/** UI lifetime only: never cancels/rolls back an RPC already accepted by the server. */
export class DailyV2ExpiredViewError extends Error {
  constructor() { super('DAILY_V2_VIEW_EXPIRED'); }
}

export function createDailyV2SessionLifetime() {
  let generation = 0;
  let active = false;
  return {
    activate() { generation++; active = true; },
    dispose() { generation++; active = false; },
    isActive: () => active,
    capture: () => generation,
    isCurrent: (ticket: number) => active && ticket === generation,
    assertActive() { if (!active) throw new DailyV2ExpiredViewError(); },
  };
}
