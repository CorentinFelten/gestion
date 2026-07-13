import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import type {
  CreatePersonalTransactionInput,
  PersonalTransaction,
  PersonalTxnType,
} from '@/types';
import { meKeys } from './useAccounts';

/**
 * Personal transactions (`/me/transactions`), income / expense / transfer,
 * private to the authenticated user.
 */

export interface PersonalTxFilters {
  accountId?: string;
  type?: PersonalTxnType;
  categoryId?: string;
  from?: string;
  to?: string;
  search?: string;
}

function toParams(filters: PersonalTxFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.accountId) params.accountId = filters.accountId;
  if (filters.type) params.type = filters.type;
  if (filters.categoryId) params.categoryId = filters.categoryId;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.search) params.search = filters.search;
  return params;
}

export function usePersonalTransactions(filters: PersonalTxFilters = {}) {
  return useQuery({
    queryKey: meKeys.transactions(filters),
    queryFn: async () => {
      const { data } = await api.get<PersonalTransaction[]>('/me/transactions', {
        params: toParams(filters),
      });
      return data;
    },
  });
}

export function useCreatePersonalTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePersonalTransactionInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<PersonalTransaction>('/me/transactions', input, { headers });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useDeletePersonalTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const headers = await csrfHeaders();
      await api.delete(`/me/transactions/${id}`, { headers });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
