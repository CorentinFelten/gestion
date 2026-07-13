/**
 * Profile + household administration mutations (Settings page).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { csrfHeaders } from '@/components/household/csrf';
import type { Household, User } from '@/types';

export interface ProfileUpdate {
  displayName?: string;
  avatarUrl?: string | null;
  preferredCurrency?: string;
  pinnedCurrencies?: string[];
  locale?: string;
}

export function useUpdateProfile() {
  const { refresh } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileUpdate) => {
      const headers = await csrfHeaders();
      const { data } = await api.patch<User>('/users/me', input, { headers });
      return data;
    },
    onSuccess: () => {
      // Net worth and stats are computed server-side from preferredCurrency, so a
      // currency/locale change must refetch the personal ledger, not just auth.
      void qc.invalidateQueries({ queryKey: ['me'] });
      return refresh();
    },
  });
}

export function useUpdateHousehold(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name?: string; baseCurrency?: string }) => {
      const headers = await csrfHeaders();
      const { data } = await api.patch<Household>(`/households/${householdId}`, input, { headers });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['household'] });
      qc.invalidateQueries({ queryKey: ['tally', householdId] });
      qc.invalidateQueries({ queryKey: ['reports', householdId] });
    },
  });
}

export function useRemoveMember(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const headers = await csrfHeaders();
      await api.delete(`/households/${householdId}/members/${userId}`, { headers });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', householdId] }),
  });
}
