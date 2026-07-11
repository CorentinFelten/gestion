import { z } from 'zod';

/**
 * Runtime validation for user-created categories (household shared + personal).
 * Custom categories are always a spending/earning *bucket*: a name, a flow
 * (expense|income) and optional presentation (emoji icon + hex colour). Scope is
 * decided by the endpoint (shared vs personal), never trusted from the client.
 */

// A single emoji / short glyph. Kept short so it renders as an icon, not text.
const iconField = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .optional();

// #rgb or #rrggbb hex colour.
const colorField = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour (#rgb or #rrggbb)')
  .optional();

export const CreateCategorySchema = z.object({
  name: z.string().trim().min(1).max(40),
  // User-created categories are expense or income only (never the internal `any`).
  flow: z.enum(['expense', 'income']).default('expense'),
  icon: iconField,
  color: colorField,
});

export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;
