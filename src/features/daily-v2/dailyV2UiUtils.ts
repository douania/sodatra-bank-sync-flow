import type { QueryClient } from '@tanstack/react-query';

export async function invalidateDailyV2(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['daily-v2', 'staging'] }),
    queryClient.invalidateQueries({ queryKey: ['daily-v2', 'canonical'] }),
    queryClient.invalidateQueries({ queryKey: ['daily-v2', 'audit'] }),
  ]);
}

export function shortId(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}
