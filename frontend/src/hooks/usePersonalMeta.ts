import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Category, FxRate, Household, Transaction } from '@/types';

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

/** Live FX preview for foreign-currency entry (PLAN §3.1, debug/preview route). */
export function useFxRate(from: string, to: string, date: string) {
  const enabled = !!from && !!to && !!date && from !== to;
  return useQuery({
    queryKey: ['fx', 'rate', from, to, date],
    enabled,
    retry: false,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data } = await api.get<FxRate>('/fx/rate', {
        params: { from, to, date },
      });
      return data;
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
        const { data: household } = await api.get<Household>('/household');
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
