import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import type { NetWorth, NetWorthHistory, NetWorthPoint } from '@/types';
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

/**
 * Captured net-worth history (`/me/net-worth/history`), oldest-first, used to
 * plot the patrimoine-net trend. Snapshots accrue one row per day.
 */
export function useNetWorthHistory(days = 365) {
  return useQuery({
    queryKey: meKeys.netWorthHistory(days),
    queryFn: async () => {
      const { data } = await api.get<NetWorthHistory>('/me/net-worth/history', {
        params: { days },
      });
      return data;
    },
  });
}

/**
 * Capture today's net worth (`POST /me/net-worth/snapshot`). Idempotent, one row
 * per day, so it's safe to call on mount to guarantee the trend has a point.
 */
export function useCaptureSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const headers = await csrfHeaders();
      const { data } = await api.post<NetWorthPoint>(
        '/me/net-worth/snapshot',
        {},
        { headers },
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'net-worth'] });
    },
  });
}
