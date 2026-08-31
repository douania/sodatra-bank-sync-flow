import { createContext, useContext } from 'react';
import { QueryClient, useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { createDailyV2SessionLifetime, DailyV2ExpiredViewError } from './dailyV2SessionLifetime';

export function createDailyV2SessionScope() {
  return {
    lifetime: createDailyV2SessionLifetime(),
    // No shared financial cache across access lifetimes, even for the same account.
    client: new QueryClient({ defaultOptions: {
      queries: { gcTime: 0, retry: false },
      mutations: { gcTime: 0, retry: false },
    } }),
  };
}

export const DailyV2SessionContext = createContext<ReturnType<typeof createDailyV2SessionScope> | null>(null);

export function useDailyV2SessionScope() {
  const scope = useContext(DailyV2SessionContext);
  if (!scope) throw new Error('DAILY_V2_SESSION_SCOPE_REQUIRED');
  return scope;
}

/** Blocks stale UI callbacks; backend authorization and atomicity remain authoritative. */
export function useDailyV2ScopedMutation<TData = unknown, TError = Error, TVariables = void>(
  options: UseMutationOptions<TData, TError, TVariables>,
) {
  const { lifetime } = useDailyV2SessionScope();
  return useMutation<TData, TError, TVariables>({
    ...options,
    mutationFn: async (...args) => {
      lifetime.assertActive();
      const ticket = lifetime.capture();
      try {
        const data = await options.mutationFn!(...args);
        if (!lifetime.isCurrent(ticket)) throw new DailyV2ExpiredViewError();
        return data;
      } catch (error) {
        if (!lifetime.isCurrent(ticket)) throw new DailyV2ExpiredViewError();
        throw error;
      }
    },
    onSuccess: (...args) => {
      if (lifetime.isActive()) return options.onSuccess?.(...args);
    },
    onError: (...args) => {
      if (lifetime.isActive() && !(args[0] instanceof DailyV2ExpiredViewError)) return options.onError?.(...args);
    },
    onSettled: (...args) => {
      if (lifetime.isActive() && !(args[1] instanceof DailyV2ExpiredViewError)) return options.onSettled?.(...args);
    },
  });
}
