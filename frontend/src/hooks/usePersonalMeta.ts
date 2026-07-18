import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import { useFxPreview } from '@/hooks/useTransactions';
import type { Category, CreateCategoryInput, Household, Transaction } from '@/types';

/**
 * Live FX preview for foreign-currency entry (PLAN §3.1). Re-exported from the
 * shared-ledger hook so the personal and household ledgers share one `/fx/rate`
 * cache key (`['fx','rate',from,to,date]`) instead of double-fetching.
 */
export const useFxRate = useFxPreview;

/**
 * Supporting lookups for the Add-transaction form. Each is best-effort: the
 * personal ledger is fully usable even if these endpoints are unavailable, so
 * failures resolve to empty data rather than blocking the form.
 */

/** Personal (+ shared/global) categories usable on personal transactions. */
export function usePersonalCategories() {
  return useQuery({
    queryKey: ['me', 'categories'],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const { data } = await api.get<Category[]>('/categories');
        return data.filter((c) => c.scope === 'personal' || c.scope === 'both');
      } catch {
        return [] as Category[];
      }
    },
  });
}

/**
 * Create a private personal category (`POST /categories`, owner-scoped). Used by
 * the Add-transaction form so a missing category can be created inline without
 * leaving the flow. Invalidates the personal-category cache on success.
 */
export function useCreatePersonalCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCategoryInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Category>('/categories', input, { headers });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'categories'] });
    },
  });
}

/**
 * Recent shared expenses the user could link a personal transaction to.
 * Resolves the single household (§12 single-household simplification) then its
 * transactions; returns [] on any failure so the toggle degrades gracefully.
 */
export function useLinkableSharedTransactions(enabled: boolean) {
  return useQuery({
    queryKey: ['me', 'linkable-shared'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        // Single-household v1: `GET /households` returns an array; take the first
        // (mirrors useHousehold). The singular `/household` route does not exist,
        // so this list previously came back empty.
        const { data: households } = await api.get<Household[]>('/households');
        const household = households[0];
        if (!household) return [] as Transaction[];
        const { data } = await api.get<Transaction[]>(
          `/households/${household.id}/transactions`,
        );
        return data;
      } catch {
        return [] as Transaction[];
      }
    },
  });
}
