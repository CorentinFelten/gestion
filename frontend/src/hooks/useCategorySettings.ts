/**
 * Create / delete custom categories, household (shared) + personal (private).
 * Mirrors the read hooks: household categories live under `['categories', id]`
 * (useHousehold), personal under `['me','categories']` (usePersonalMeta); each
 * mutation invalidates the matching query so lists refresh in place.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import type { Category } from '@/types';

export interface NewCategory {
  name: string;
  flow: 'expense' | 'income';
  icon?: string;
  color?: string;
}

export function useCreateHouseholdCategory(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewCategory) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Category>(
        `/households/${householdId}/categories`,
        input,
        { headers },
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', householdId] }),
  });
}

export function useDeleteHouseholdCategory(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      const headers = await csrfHeaders();
      await api.delete(`/households/${householdId}/categories/${categoryId}`, { headers });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', householdId] }),
  });
}

export function useCreatePersonalCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewCategory) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Category>('/categories', input, { headers });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'categories'] }),
  });
}

export function useDeletePersonalCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      const headers = await csrfHeaders();
      await api.delete(`/categories/${categoryId}`, { headers });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'categories'] }),
  });
}
