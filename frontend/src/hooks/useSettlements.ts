/**
 * Reimbursements (category-scoped settlements) + the "Reset tally" prefill.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import type { CreateSettlementInput, Settlement, SettleUpPrefill } from '@/types';

export function useSettlements(
  householdId: string | undefined,
  filter: { categoryId?: string; memberId?: string } = {},
) {
  const params: Record<string, string> = {};
  if (filter.categoryId) params.categoryId = filter.categoryId;
  if (filter.memberId) params.memberId = filter.memberId;
  return useQuery({
    queryKey: ['settlements', householdId, params],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await api.get<Settlement[]>(`/households/${householdId}/settlements`, {
        params,
      });
      return data;
    },
  });
}

/** Exact outstanding + prefill for a from→to reset within a category. */
export function useSettleUpPrefill(
  householdId: string | undefined,
  categoryId: string | null,
  fromUserId: string,
  toUserId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['settle-prefill', householdId, categoryId, fromUserId, toUserId],
    enabled: enabled && !!householdId && !!categoryId && !!fromUserId && !!toUserId,
    queryFn: async () => {
      const { data } = await api.get<SettleUpPrefill>(
        `/households/${householdId}/categories/${categoryId}/settle-up`,
        { params: { from: fromUserId, to: toUserId } },
      );
      return data;
    },
  });
}

export function useCreateSettlement(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSettlementInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Settlement>(
        `/households/${householdId}/settlements`,
        input,
        { headers },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlements', householdId] });
      qc.invalidateQueries({ queryKey: ['tally', householdId] });
      qc.invalidateQueries({ queryKey: ['settle-up', householdId] });
      qc.invalidateQueries({ queryKey: ['settle-prefill', householdId] });
    },
  });
}
