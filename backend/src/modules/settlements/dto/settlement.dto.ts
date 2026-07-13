import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD');
const currencyCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code')
  .transform((s) => s.toUpperCase());
const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal number string');

export const CreateSettlementSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  categoryId: z.string().min(1).nullish(), // null = the uncategorized bucket (not a cross-category reset)
  amountOriginal: positiveDecimalString,
  currencyOriginal: currencyCode,
  paymentDate: isoDate,
  note: z.string().nullish(),
  linkToAccountId: z.string().nullish(),
});

export type CreateSettlementDto = z.infer<typeof CreateSettlementSchema>;

export interface SettlementDto {
  id: string;
  householdId: string;
  fromUserId: string;
  toUserId: string;
  categoryId: string | null;
  amountOriginal: string;
  currencyOriginal: string;
  paymentDate: string;
  fxRate: string;
  fxRateDate: string;
  fxSource: string;
  amountBase: string;
  isFullReset: boolean;
  note: string | null;
  createdById: string;
  createdAt: string;
  /** Outstanding net_pair(from,to,category) BEFORE this settlement (base ccy). */
  outstandingBefore?: string;
  /** True when `from` was not the debtor, a reverse debt was created. */
  directionWarning?: boolean;
}

/** Query-string validation for the settlements list endpoint. */
export const SettlementFilterSchema = z.object({
  categoryId: z.string().min(1).optional(),
  memberId: z.string().min(1).optional(),
});

export type SettlementFilter = z.infer<typeof SettlementFilterSchema>;

/** Prefill payload for the "Reset tally" one-click (exact outstanding). */
export interface SettleUpPrefillDto {
  fromUserId: string;
  toUserId: string;
  categoryId: string;
  outstandingBase: string; // exact net_pair(from,to,category) in base currency
  baseCurrency: string;
  isFullReset: true;
}
