import type { SplitType } from '@prisma/client';
import { z } from 'zod';

/**
 * API boundary DTOs. Money values are strings (decimal-safe JSON); convert to
 * decimal.js in the service. These mirror the frontend `src/types` contracts.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD');
const currencyCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code')
  .transform((s) => s.toUpperCase());
const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal number string');
const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal number string');
const splitTypeEnum = z.enum(['equal', 'exact', 'percent', 'shares']);

export const SplitInputSchema = z.object({
  userId: z.string().min(1),
  splitType: splitTypeEnum,
  shareValue: decimalString,
});

export const CreateTransactionSchema = z.object({
  payerUserId: z.string().min(1),
  description: z.string().min(1),
  categoryId: z.string().min(1), // category is required for shared expenses
  notes: z.string().nullish(),
  amountOriginal: positiveDecimalString,
  currencyOriginal: currencyCode,
  paymentDate: isoDate,
  splits: z.array(SplitInputSchema).min(1),
  linkToAccountId: z.string().nullish(),
});

export const UpdateTransactionSchema = CreateTransactionSchema.partial();

export type SplitInputDto = z.infer<typeof SplitInputSchema>;
export type CreateTransactionDto = z.infer<typeof CreateTransactionSchema>;
export type UpdateTransactionDto = z.infer<typeof UpdateTransactionSchema>;

export interface SplitDto {
  id: string;
  userId: string;
  splitType: SplitType;
  shareValue: string;
  amountBase: string;
}

export interface TransactionDto {
  id: string;
  householdId: string;
  payerUserId: string;
  description: string;
  categoryId: string | null;
  notes: string | null;
  amountOriginal: string;
  currencyOriginal: string;
  paymentDate: string;
  baseCurrency: string;
  fxRate: string;
  fxRateDate: string;
  fxSource: string;
  amountBase: string;
  splits: SplitDto[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionFilter {
  from?: string; // date range start (ISO)
  to?: string; // date range end (ISO)
  memberId?: string;
  categoryId?: string;
  currency?: string;
  search?: string;
}

export interface AttachmentDto {
  id: string;
  transactionId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}
