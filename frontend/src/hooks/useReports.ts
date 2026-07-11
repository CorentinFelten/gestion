/**
 * Shared spending reports grouped by category / member / month / currency.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ReportGroup, ReportResponse } from '@/types';

export function useReport(householdId: string | undefined, group: ReportGroup) {
  return useQuery({
    queryKey: ['reports', householdId, group],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await api.get<ReportResponse>(`/households/${householdId}/reports`, {
        params: { group },
      });
      return data;
    },
  });
}
