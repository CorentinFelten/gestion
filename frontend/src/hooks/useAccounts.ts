import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { csrfHeaders } from '@/components/household/csrf';
import type {
  Account,
  AccountBalance,
  AccountType,
  Country,
  PayoffSchedule,
} from '@/types';

/**
 * Personal accounts (`/me/accounts`), owner-only (PLAN §6 personal ledger).
 * Kept under a `me` query-key namespace so it never collides with the
 * household-UI agent's caches.
 */

export const meKeys = {
  accounts: ['me', 'accounts'] as const,
  accountBalance: (id: string) => ['me', 'accounts', id, 'balance'] as const,
  netWorth: ['me', 'net-worth'] as const,
  netWorthHistory: (days: number) => ['me', 'net-worth', 'history', days] as const,
  payoff: (id: string, monthlyPayment: string) =>
    ['me', 'accounts', id, 'payoff', monthlyPayment] as const,
  savedFilters: ['me', 'saved-filters'] as const,
  transactions: (filters?: unknown) => ['me', 'transactions', filters ?? null] as const,
  statsSummary: ['me', 'stats', 'summary'] as const,
  stats: (view: string, period: string) => ['me', 'stats', view, period] as const,
};

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: string;
  /** Country the account belongs to; defaults its currency (FR→EUR, CA→CAD). */
  country?: Country;
  /** Credit-card fields (decimal strings). Only meaningful for `credit_card`. */
  interestRate?: string | null;
  creditLimit?: string | null;
  minPayment?: string | null;
}

export interface UpdateAccountInput {
  name?: string;
  /** `false` archives (soft-closes) the account; `true` restores it. */
  isActive?: boolean;
  sortOrder?: number;
  country?: Country;
  /** Credit-card fields; pass `null` to clear. Only meaningful for `credit_card`. */
  interestRate?: string | null;
  creditLimit?: string | null;
  minPayment?: string | null;
}

export function useAccounts() {
  return useQuery({
    queryKey: meKeys.accounts,
    queryFn: async () => {
      const { data } = await api.get<Account[]>('/me/accounts');
      return data;
    },
  });
}

export function useAccountBalance(accountId: string | undefined) {
  return useQuery({
    queryKey: accountId ? meKeys.accountBalance(accountId) : ['me', 'accounts', 'none', 'balance'],
    enabled: !!accountId,
    queryFn: async () => {
      const { data } = await api.get<AccountBalance>(`/me/accounts/${accountId}/balance`);
      return data;
    },
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAccountInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Account>('/me/accounts', input, { headers });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateAccountInput & { id: string }) => {
      const headers = await csrfHeaders();
      const { data } = await api.patch<Account>(`/me/accounts/${id}`, input, { headers });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/**
 * Credit-card payoff projection for `accountId` at a given monthly payment.
 * Enabled only for a set account id and a strictly-positive numeric payment,
 * so we never ask the backend to amortize a zero/blank payment.
 */
export function usePayoff(accountId: string | undefined, monthlyPayment: string) {
  const positive = Number(monthlyPayment) > 0;
  return useQuery({
    queryKey: meKeys.payoff(accountId ?? 'none', monthlyPayment),
    enabled: !!accountId && positive,
    queryFn: async () => {
      const { data } = await api.get<PayoffSchedule>(`/me/accounts/${accountId}/payoff`, {
        params: { monthlyPayment },
      });
      return data;
    },
  });
}
