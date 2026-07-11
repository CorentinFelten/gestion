// Auth DTO contracts. Input DTOs are validated with zod via ZodValidationPipe;
// the response shapes below are the contract other layers rely on.

import { z } from 'zod';
import { isValidCurrency } from '../../../common/currency';

const currencySchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine(isValidCurrency, { message: 'Unknown currency code (ISO-4217 expected)' });

export const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  displayName: z.string().trim().min(1).max(100),
  preferredCurrency: currencySchema.optional(),
  locale: z.string().trim().min(2).max(35).optional(),
});

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;

export interface AuthUserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  preferredCurrency: string;
  pinnedCurrencies: string[];
  locale: string;
}

/** Returned by register/login; the session id is delivered as an httpOnly cookie. */
export interface AuthResultDto {
  user: AuthUserDto;
  sessionId: string;
  expiresAt: string;
}
