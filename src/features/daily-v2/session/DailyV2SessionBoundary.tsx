import React, { useLayoutEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createDailyV2SessionScope, DailyV2SessionContext } from './dailyV2SessionScope';

/**
 * Parent must unmount on access uncertainty and key by user/role identity.
 * Mutations are user-event driven only: never start one from a child's mount
 * layout effect (the boundary lifetime is not active until its layout effect).
 */
export function DailyV2SessionBoundary({ children }: { children: React.ReactNode }) {
  const [scope] = useState(createDailyV2SessionScope);
  useLayoutEffect(() => {
    scope.lifetime.activate();
    return () => {
      scope.lifetime.dispose();
      // clear() cancels queries and removes local query/mutation cache entries.
      // It cannot abort a financial operation already sent to the server.
      scope.client.clear();
    };
  }, [scope]);
  return <DailyV2SessionContext.Provider value={scope}>
    <QueryClientProvider client={scope.client}>{children}</QueryClientProvider>
  </DailyV2SessionContext.Provider>;
}
