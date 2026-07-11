import { BadRequestException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { SplitType } from '@prisma/client';

/**
 * Money helpers for the shared ledger. All amounts are decimal.js, never
 * floats. Monetary precision is 6 decimal places (matches NUMERIC(20,6)).
 */

export const MONEY_DP = 6;
/** Smallest representable money unit at 6 dp: 0.000001. */
export const MONEY_EPSILON = new Decimal(10).pow(-MONEY_DP);

/** Round a Decimal to the money scale (6 dp, half-up). */
export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

export interface ResolvedSplit {
  userId: string;
  splitType: SplitType;
  shareValue: Decimal;
  amountBase: Decimal;
}

interface SplitWeightInput {
  userId: string;
  splitType: SplitType;
  shareValue: Decimal;
}

/**
 * Resolve each split's owed `amount_base` from the transaction total using the
 * requested split method, then distribute any rounding remainder with the
 * **largest-remainder method** so the invariant holds EXACTLY:
 *
 *   Σ splits.amountBase === amountBase   (to the 6th decimal)
 *
 * All split types reduce to proportional weights over `amountBase`:
 *   equal   → weight 1 each
 *   shares  → weight = shareValue
 *   percent → weight = shareValue   (must sum to 100)
 *   exact   → weight = shareValue   (must sum to amountOriginal; proportional
 *             on the frozen total keeps the base invariant exact)
 */
export function resolveSplits(
  amountBase: Decimal,
  amountOriginal: Decimal,
  splits: SplitWeightInput[],
): ResolvedSplit[] {
  if (splits.length === 0) {
    throw new BadRequestException('At least one split is required');
  }

  const types = new Set(splits.map((s) => s.splitType));
  if (types.size > 1) {
    throw new BadRequestException('All splits must use the same split_type');
  }
  const splitType = splits[0].splitType;

  // Duplicate participant guard.
  const seen = new Set<string>();
  for (const s of splits) {
    if (seen.has(s.userId)) {
      throw new BadRequestException(`Duplicate split for user ${s.userId}`);
    }
    seen.add(s.userId);
  }

  // Derive the per-split weight and validate method-specific totals.
  const weights: Decimal[] = splits.map((s) => {
    switch (splitType) {
      case 'equal':
        return new Decimal(1);
      case 'shares':
      case 'percent':
      case 'exact':
        if (s.shareValue.lt(0)) {
          throw new BadRequestException('Split share value cannot be negative');
        }
        return s.shareValue;
      default:
        throw new BadRequestException(`Unknown split_type: ${String(splitType)}`);
    }
  });

  const totalWeight = weights.reduce((a, w) => a.plus(w), new Decimal(0));
  if (totalWeight.lte(0)) {
    throw new BadRequestException('Split weights must sum to a positive value');
  }

  if (splitType === 'percent' && !totalWeight.equals(100)) {
    throw new BadRequestException(
      `percent splits must sum to 100 (got ${totalWeight.toString()})`,
    );
  }
  if (splitType === 'exact' && !roundMoney(totalWeight).equals(roundMoney(amountOriginal))) {
    throw new BadRequestException(
      `exact splits must sum to the original amount ${roundMoney(amountOriginal).toString()} (got ${roundMoney(totalWeight).toString()})`,
    );
  }

  // Ideal (unrounded) base amount per split.
  const ideals = weights.map((w) => amountBase.times(w).div(totalWeight));

  // Floor each to the money scale, track the fractional remainder.
  const floors = ideals.map((v) => v.toDecimalPlaces(MONEY_DP, Decimal.ROUND_DOWN));
  const remainders = ideals.map((v, i) => v.minus(floors[i]));

  const allocated = floors.reduce((a, v) => a.plus(v), new Decimal(0));
  // Number of smallest-units still to distribute so the sum hits amountBase.
  const deficit = amountBase.minus(allocated);
  const units = Number(deficit.div(MONEY_EPSILON).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString());

  const result: ResolvedSplit[] = splits.map((s, i) => ({
    userId: s.userId,
    splitType,
    shareValue: s.shareValue,
    amountBase: floors[i],
  }));

  if (units !== 0) {
    // Largest-remainder: hand the leftover units to the biggest remainders
    // first (deterministic tie-break by index).
    const order = remainders
      .map((r, i) => ({ i, r }))
      .sort((a, b) => (b.r.equals(a.r) ? a.i - b.i : b.r.comparedTo(a.r)));

    const step = units > 0 ? MONEY_EPSILON : MONEY_EPSILON.neg();
    let remaining = Math.abs(units);
    let k = 0;
    while (remaining > 0) {
      const idx = order[k % order.length].i;
      result[idx].amountBase = result[idx].amountBase.plus(step);
      remaining -= 1;
      k += 1;
    }
  }

  // Final safety assertion, the invariant must hold exactly.
  const sum = result.reduce((a, r) => a.plus(r.amountBase), new Decimal(0));
  if (!sum.equals(amountBase)) {
    throw new Error(
      `Split invariant violated: Σ=${sum.toString()} != amountBase=${amountBase.toString()}`,
    );
  }

  return result;
}
