import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import type { SavedFilter, SavedFilterInput } from '@/types';
import { meKeys } from './useAccounts';

/**
 * Saved personal-transaction filters (`/me/saved-filters`), owner-only. Each row
 * persists a named filter set (search + amount range + facets) the user can
 * re-apply from the transaction browser.
 */

export function useSavedFilters() {
  return useQuery({
    queryKey: meKeys.savedFilters,
    queryFn: async () => {
      const { data } = await api.get<SavedFilter[]>('/me/saved-filters');
      return data;
    },
  });
}

export function useCreateSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SavedFilterInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<SavedFilter>('/me/saved-filters', input, { headers });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meKeys.savedFilters });
    },
  });
}

export function useDeleteSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const headers = await csrfHeaders();
      await api.delete(`/me/saved-filters/${id}`, { headers });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meKeys.savedFilters });
    },
  });
}
