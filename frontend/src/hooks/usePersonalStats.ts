import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { StatsPeriod, StatsResponse, StatsSummary, StatsView } from '@/types';
import { meKeys } from './useAccounts';

/**
 * Personal statistics (`/me/stats*`). `useStatsSummary` powers the overview's
 * this-month income / spending / savings-rate tiles; `useStats` powers the
 * charts on the Statistics page.
 */

export function useStatsSummary() {
  return useQuery({
    queryKey: meKeys.statsSummary,
    queryFn: async () => {
      const { data } = await api.get<StatsSummary>('/me/stats/summary');
      return data;
    },
  });
}

export function useStats(view: StatsView, period: StatsPeriod = 'month') {
  return useQuery({
    queryKey: meKeys.stats(view, period),
    queryFn: async () => {
      const { data } = await api.get<StatsResponse>('/me/stats', {
        params: { view, period },
      });
      return data;
    },
  });
}
