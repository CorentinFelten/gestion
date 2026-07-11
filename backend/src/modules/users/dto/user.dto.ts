import { z } from 'zod';
import { isValidCurrency } from '../../../common/currency';

const currencySchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine(isValidCurrency, { message: 'Unknown currency code (ISO-4217 expected)' });

/** Maximum number of currencies a user may pin. */
export const MAX_PINNED_CURRENCIES = 12;

/**
 * Pinned currencies: an array of ISO-4217 codes, uppercased, de-duplicated and
 * capped. Each entry must be a recognized currency; the (deduped) list drives
 * the "pinned first" ordering in every currency picker for that user.
 */
const pinnedCurrenciesSchema = z
  .array(z.string().trim().min(1).transform((s) => s.toUpperCase()))
  .max(MAX_PINNED_CURRENCIES, {
    message: `Too many pinned currencies (max ${MAX_PINNED_CURRENCIES})`,
  })
  .refine((arr) => arr.every(isValidCurrency), {
    message: 'Unknown currency code in pinnedCurrencies (ISO-4217 expected)',
  })
  .transform((arr) => Array.from(new Set(arr)));

export const UpdateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
    preferredCurrency: currencySchema.optional(),
    pinnedCurrencies: pinnedCurrenciesSchema.optional(),
    locale: z.string().trim().min(2).max(35).optional(),
  })
  .strict();

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
