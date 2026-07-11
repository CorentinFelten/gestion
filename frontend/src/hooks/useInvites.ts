/**
 * In-app invitations between registered users (no emails/tokens/links).
 * Received side: the current user's pending invites + accept/decline.
 * Sent side: an owner/admin picks an invitable user, sends, lists and revokes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { csrfHeaders } from '@/components/household/csrf';
import type { InvitableUser, Invite, ReceivedInvite, Role } from '@/types';

// ── Received side (any authenticated user) ─────────────────────────────────

/** The current user's pending received invites. */
export function useReceivedInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['receivedInvites'],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await api.get<ReceivedInvite[]>('/me/invites');
      return data;
    },
  });
}

/** Accept an invite → the user joins the household. */
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const headers = await csrfHeaders();
      const { data } = await api.post(`/invites/${inviteId}/accept`, {}, { headers });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['household'] });
      qc.invalidateQueries({ queryKey: ['receivedInvites'] });
    },
  });
}

/** Decline an invite. */
export function useDeclineInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const headers = await csrfHeaders();
      const { data } = await api.post(`/invites/${inviteId}/decline`, {}, { headers });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivedInvites'] });
    },
  });
}

// ── Sent side (owner/admin) ────────────────────────────────────────────────

/** Registered users who can be invited to this household. */
export function useInvitableUsers(householdId: string | undefined) {
  return useQuery({
    queryKey: ['invitableUsers', householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await api.get<InvitableUser[]>(`/households/${householdId}/invitable-users`);
      return data;
    },
  });
}

/** Pending invites sent for this household. */
export function useSentInvites(householdId: string | undefined) {
  return useQuery({
    queryKey: ['sentInvites', householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data } = await api.get<Invite[]>(`/households/${householdId}/invites`);
      return data;
    },
  });
}

/** Send an in-app invite to a registered user. */
export function useCreateInvite(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invitedUserId: string; role?: Role }) => {
      const headers = await csrfHeaders();
      const { data } = await api.post<Invite>(`/households/${householdId}/invites`, input, {
        headers,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sentInvites', householdId] });
      qc.invalidateQueries({ queryKey: ['invitableUsers', householdId] });
    },
  });
}

/** Revoke a pending invite. */
export function useRevokeInvite(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const headers = await csrfHeaders();
      await api.delete(`/households/${householdId}/invites/${inviteId}`, { headers });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sentInvites', householdId] });
      qc.invalidateQueries({ queryKey: ['invitableUsers', householdId] });
    },
  });
}
