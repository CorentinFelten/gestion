import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { NetWorth } from '@/types';
import { meKeys } from './useAccounts';

/**
 * Net worth (`/me/net-worth`): total in the profile currency using the latest
 * available rate (PLAN §3.4 / §5.5), with a per-account native + converted
 * breakdown. This is the one place we intentionally use a live rate.
 */
export function useNetWorth() {
  return useQuery({
    queryKey: meKeys.netWorth,
    queryFn: async () => {
      const { data } = await api.get<NetWorth>('/me/net-worth');
      return data;
    },
  });
}
