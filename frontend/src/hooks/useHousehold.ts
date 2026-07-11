/**
 * Core household reference data + auth gating for the shared ledger.
 * v1 is single-household: `GET /households` returns an array; we take the first.
 */
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { Category, Household, Member } from '@/types';
import { COMMON_CURRENCIES } from '@/components/household/format';
import { csrfHeaders } from '@/components/household/csrf';

/** Redirect to /login once we know the user is unauthenticated. */
export function useRequireAuth(): { user: ReturnType<typeof useAuth>['user']; ready: boolean } {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true });
  }, [loading, user, navigate]);
  return { user, ready: !loading && !!user };
}

export function useHousehold() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['household'],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await api.get<Household[]>('/households');
      return data[0] ?? null;
    },
  });
}

/** Create the user's household (first-run onboarding). Single-household v1. */
export function useCreateHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; baseCurrency: string }) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Household>('/households', input, { headers });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['household'] });
    },
  });
}

export function useMembers(householdId: string | undefined) {
  return useQuery({
    queryKey: ['members', householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await api.get<Member[]>(`/households/${householdId}/members`);
      return data;
    },
  });
}

/**
 * Household categories. The reference endpoint may not be wired yet; on any
 * failure we return an empty list so the UI degrades to "uncategorised".
 */
export function useCategories(householdId: string | undefined) {
  return useQuery({
    queryKey: ['categories', householdId],
    enabled: !!householdId,
    queryFn: async () => {
      try {
        const { data } = await api.get<Category[]>(`/households/${householdId}/categories`);
        return data;
      } catch {
        return [] as Category[];
      }
    },
  });
}

/** Supported ISO currencies; falls back to a common set if `/currencies` is down. */
export function useCurrencies() {
  return useQuery({
    queryKey: ['currencies'],
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      try {
        const { data } = await api.get<string[]>('/currencies');
        return data.length ? data : COMMON_CURRENCIES;
      } catch {
        return COMMON_CURRENCIES;
      }
    },
  });
}

/** userId → display name lookup built from the member roster. */
export function useMemberMap(members: Member[] | undefined): Record<string, Member> {
  return useMemo(() => {
    const map: Record<string, Member> = {};
    for (const m of members ?? []) map[m.userId] = m;
    return map;
  }, [members]);
}
