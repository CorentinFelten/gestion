/**
 * Login / register / logout mutations for the cookie-session auth flow.
 * On success we refresh the AuthContext and clear cached server state.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { csrfHeaders, resetCsrf } from '@/components/household/csrf';
import type { AuthResult, LoginInput, RegisterInput } from '@/types';

export function useLogin() {
  const { refresh } = useAuth();
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<AuthResult>('/auth/login', input, { headers });
      return data;
    },
    onSuccess: () => refresh(),
  });
}

export function useRegister() {
  const { refresh } = useAuth();
  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<AuthResult>('/auth/register', input, { headers });
      return data;
    },
    onSuccess: () => refresh(),
  });
}

export function useLogout() {
  const { setUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const headers = await csrfHeaders();
      await api.post('/auth/logout', {}, { headers });
    },
    onSuccess: () => {
      resetCsrf();
      setUser(null);
      qc.clear();
    },
  });
}
