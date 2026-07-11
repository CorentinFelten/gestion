import { z } from 'zod';
import { AccountType, PersonalTxnType } from '@prisma/client';

/**
 * Runtime validation for the personal ledger (PLAN.md §9, validate & sanitize
 * all input). Money is validated as decimal strings (never floats). Currencies
 * are normalised to upper-case ISO-4217-ish 3-letter codes.
 */

// A non-negative decimal with up to 6 fractional digits (NUMERIC(20,6)).
const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'must be a non-negative decimal with <= 6 dp');

// A signed decimal (opening balance may be negative for e.g. a credit card).
const signedDecimalString = z
  .string()
  .regex(/^-?\d+(\.\d{1,6})?$/, 'must be a decimal with <= 6 dp');

const currencyCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'must be a 3-letter currency code')
  .transform((s) => s.toUpperCase());

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');

// Per-account country (ISO-3166 alpha-2). App logic supports FR & CA today and
// derives the account's default currency from it (FR → EUR, CA → CAD).
const countryCode = z.enum(['FR', 'CA']);

// ── Accounts ────────────────────────────────────────────────────────────────
export const CreateAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.nativeEnum(AccountType),
  // Optional: when omitted, defaulted from `country` (FR → EUR, CA → CAD).
  currency: currencyCode.optional(),
  country: countryCode.default('FR'),
  openingBalance: signedDecimalString.optional(),
  sortOrder: z.number().int().optional(),
});

export const UpdateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    country: countryCode.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(), // false => archive
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'empty update' });

// ── Personal transactions ─────────────────────────────────────────────────────
const PersonalTransactionShape = {
  accountId: z.string().min(1),
  type: z.nativeEnum(PersonalTxnType),
  categoryId: z.string().min(1).nullish(),
  amount: positiveDecimalString,
  amountOriginal: positiveDecimalString.nullish(),
  currencyOriginal: currencyCode.nullish(),
  txnDate: isoDate,
  payeeSource: z.string().max(300).nullish(),
  notes: z.string().max(2000).nullish(),
  transferAccountId: z.string().min(1).nullish(),
  transferAmount: positiveDecimalString.nullish(),
  linkedTransactionId: z.string().min(1).nullish(),
  linkedSettlementId: z.string().min(1).nullish(),
};

export const CreatePersonalTransactionSchema = z
  .object(PersonalTransactionShape)
  .refine((d) => d.type !== 'transfer' || !!d.transferAccountId, {
    message: 'transfer requires transferAccountId',
    path: ['transferAccountId'],
  })
  .refine((d) => d.type !== 'transfer' || d.transferAccountId !== d.accountId, {
    message: 'cannot transfer to the same account',
    path: ['transferAccountId'],
  })
  .refine((d) => !(d.amountOriginal && !d.currencyOriginal), {
    message: 'currencyOriginal is required when amountOriginal is provided',
    path: ['currencyOriginal'],
  });

export const UpdatePersonalTransactionSchema = z
  .object(PersonalTransactionShape)
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'empty update' });

// ── List filter (query string) ────────────────────────────────────────────────
// Validated at the boundary so a malformed `?from=abc` returns 400 instead of
// reaching Prisma (Invalid Date) and surfacing as a generic 500.
export const PersonalTransactionFilterSchema = z.object({
  type: z.nativeEnum(PersonalTxnType).optional(),
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  payee: z.string().optional(),
  search: z.string().optional(),
});
