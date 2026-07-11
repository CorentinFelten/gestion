/**
 * Shared-ledger transactions: list (with filters), create, update, delete, and a
 * live base-currency conversion preview via the FX rate endpoint.
 */
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import type {
  CreateTransactionInput,
  FxRate,
  Transaction,
} from '@/types';

export interface TransactionFilters {
  from?: string;
  to?: string;
  memberId?: string;
  categoryId?: string;
  currency?: string;
  search?: string;
}

/** Drop empty filter values so the query key & request stay clean. */
function cleanFilters(f: TransactionFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k] = v;
  return out;
}

export function useTransactions(householdId: string | undefined, filters: TransactionFilters) {
  const params = cleanFilters(filters);
  return useQuery({
    queryKey: ['transactions', householdId, params],
    enabled: !!householdId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get<Transaction[]>(`/households/${householdId}/transactions`, {
        params,
      });
      return data;
    },
  });
}

function invalidateLedger(qc: ReturnType<typeof useQueryClient>, householdId?: string) {
  qc.invalidateQueries({ queryKey: ['transactions', householdId] });
  qc.invalidateQueries({ queryKey: ['tally', householdId] });
  qc.invalidateQueries({ queryKey: ['settle-up', householdId] });
  qc.invalidateQueries({ queryKey: ['reports', householdId] });
}

export function useCreateTransaction(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTransactionInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Transaction>(
        `/households/${householdId}/transactions`,
        input,
        { headers },
      );
      return data;
    },
    onSuccess: () => invalidateLedger(qc, householdId),
  });
}

export function useUpdateTransaction(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<CreateTransactionInput> }) => {
      const headers = await csrfHeaders();
      const { data } = await api.patch<Transaction>(`/transactions/${id}`, input, { headers });
      return data;
    },
    onSuccess: () => invalidateLedger(qc, householdId),
  });
}

export function useDeleteTransaction(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const headers = await csrfHeaders();
      await api.delete(`/transactions/${id}`, { headers });
    },
    onSuccess: () => invalidateLedger(qc, householdId),
  });
}

/**
 * Live FX preview: rate to convert `from`→`to` on `date`. Disabled when the two
 * currencies match. Returns the frozen-style snapshot the server would store.
 *
 * This is the single shared FX-rate hook for the whole app (the personal ledger
 * re-exports it as `useFxRate`) so both call sites hit the same `/fx/rate`
 * endpoint under one cache key and never double-fetch.
 */
export function useFxPreview(from: string, to: string, date: string) {
  return useQuery({
    queryKey: ['fx', 'rate', from, to, date],
    enabled: !!from && !!to && !!date && from !== to,
    staleTime: 1000 * 60 * 60,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get<FxRate>('/fx/rate', { params: { from, to, date } });
      return data;
    },
  });
}
