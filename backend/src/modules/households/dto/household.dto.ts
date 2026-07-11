import { z } from 'zod';
import type { InviteStatus, Role } from '@prisma/client';
import { isValidCurrency } from '../../../common/currency';

const currencySchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine(isValidCurrency, { message: 'Unknown currency code (ISO-4217 expected)' });

// Invites/members can be assigned admin or member (never a second owner).
const assignableRoleSchema = z.enum(['admin', 'member']);

export const CreateHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseCurrency: currencySchema,
});

export const UpdateHouseholdSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** Heavy op, admin-gated recompute from stored originals (PLAN.md §6). */
    baseCurrency: currencySchema.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.baseCurrency !== undefined, {
    message: 'Nothing to update',
  });

// In-app invite: target an existing registered user by id, with an optional role.
export const CreateInviteSchema = z.object({
  invitedUserId: z.string().trim().min(1).max(64),
  role: assignableRoleSchema.optional(),
});

export type CreateHouseholdDto = z.infer<typeof CreateHouseholdSchema>;
export type UpdateHouseholdDto = z.infer<typeof UpdateHouseholdSchema>;
export type CreateInviteDto = z.infer<typeof CreateInviteSchema>;

export interface HouseholdDto {
  id: string;
  name: string;
  baseCurrency: string;
  createdById: string;
  createdAt: string;
  role: Role; // requesting user's role in this household
}

export interface MemberDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

/** Sent-invite view (owner/admin managing invites for their household). */
export interface InviteDto {
  id: string;
  invitedUser: { id: string; displayName: string; email: string };
  role: Role;
  status: InviteStatus;
  createdAt: string;
}

/** Received-invite view (the current user's own pending invites). */
export interface ReceivedInviteDto {
  id: string;
  household: { id: string; name: string };
  invitedByName: string;
  role: Role;
  createdAt: string;
}

/** A user the sender may invite (no household, no pending invite here). */
export interface InvitableUserDto {
  id: string;
  displayName: string;
  email: string;
}
