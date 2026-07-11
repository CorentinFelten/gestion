/**
 * Pairwise, per-category tally board + settle-up positions (PLAN.md §5).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SettleUpResponse, TallyBoard } from '@/types';

/** `me` → subject positions vs each member; `categoryId` → single-category ledger. */
export function useTally(
  householdId: string | undefined,
  opts: { me?: boolean; categoryId?: string } = {},
) {
  const params: Record<string, string> = {};
  if (opts.me) params.me = '1';
  if (opts.categoryId) params.category = opts.categoryId;
  return useQuery({
    queryKey: ['tally', householdId, params],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await api.get<TallyBoard>(`/households/${householdId}/tally`, { params });
      return data;
    },
  });
}

export function useSettleUp(householdId: string | undefined, simplify: boolean) {
  return useQuery({
    queryKey: ['settle-up', householdId, simplify],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await api.get<SettleUpResponse>(`/households/${householdId}/settle-up`, {
        params: simplify ? { simplify: '1' } : {},
      });
      return data;
    },
  });
}
