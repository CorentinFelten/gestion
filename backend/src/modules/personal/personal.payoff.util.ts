import { Decimal } from 'decimal.js';
import type { PayoffMonthDto, PayoffScheduleDto } from './dto/personal.dto';

/**
 * Simulation cap so a pathological input can't loop forever (#9). A payment that
 * doesn't cover the first month's interest is caught up front (`neverPaysOff`),
 * so a converging schedule never approaches this bound in practice.
 */
const PAYOFF_MAX_MONTHS = 1200;

/** Inputs for a credit-card payoff projection, already in the account's native currency. */
export interface PayoffInput {
  accountId: string;
  currency: string;
  /** Amount currently owed (>= 0). A credit account with spend has `owed = -balance`. */
  owed: Decimal;
  /** Annual percentage rate, e.g. `19.99`. */
  apr: Decimal;
  /** Fixed payment applied each month. */
  monthlyPayment: Decimal;
}

/**
 * Credit-card payoff projection (#9): amortize `owed` at `apr`, paying
 * `monthlyPayment` each month (interest first, then principal). All math is
 * decimal.js; interest and principal are rounded to 2 dp per month like a real
 * statement.
 *
 * If the payment doesn't cover the first month's interest the balance never
 * shrinks (`neverPaysOff`); the loop is also capped at PAYOFF_MAX_MONTHS.
 *
 * Pure and side-effect free — the owning service resolves the account balance,
 * APR, and payment, then delegates the amortization here.
 */
export function computePayoffSchedule(input: PayoffInput): PayoffScheduleDto {
  const { accountId, currency, owed, apr, monthlyPayment } = input;
  const monthlyRate = apr.div(100).div(12);

  const base = {
    accountId,
    currency,
    startingBalance: owed.toDecimalPlaces(2).toString(),
    monthlyPayment: monthlyPayment.toDecimalPlaces(2).toString(),
    interestRate: apr.toString(),
  };

  if (owed.lte(0)) {
    return { ...base, months: 0, totalInterest: '0', totalPaid: '0', neverPaysOff: false, schedule: [] };
  }
  if (monthlyPayment.lte(owed.mul(monthlyRate))) {
    // Payment never even covers the interest → the debt can't be cleared.
    return { ...base, months: 0, totalInterest: '0', totalPaid: '0', neverPaysOff: true, schedule: [] };
  }

  const schedule: PayoffMonthDto[] = [];
  let balance = owed;
  let totalInterest = new Decimal(0);
  let totalPaid = new Decimal(0);
  let month = 0;
  while (balance.gt(0) && month < PAYOFF_MAX_MONTHS) {
    month += 1;
    const interest = balance.mul(monthlyRate).toDecimalPlaces(2);
    const due = balance.plus(interest);
    let payment = monthlyPayment;
    let principal: Decimal;
    if (payment.gte(due)) {
      payment = due; // final (partial) payment
      principal = balance;
      balance = new Decimal(0);
    } else {
      principal = payment.minus(interest);
      balance = balance.minus(principal);
    }
    totalInterest = totalInterest.plus(interest);
    totalPaid = totalPaid.plus(payment);
    schedule.push({
      month,
      interest: interest.toString(),
      principal: principal.toDecimalPlaces(2).toString(),
      balance: balance.toDecimalPlaces(2).toString(),
    });
  }
  const neverPaysOff = balance.gt(0);
  return {
    ...base,
    months: neverPaysOff ? 0 : month,
    totalInterest: totalInterest.toDecimalPlaces(2).toString(),
    totalPaid: totalPaid.toDecimalPlaces(2).toString(),
    neverPaysOff,
    schedule: neverPaysOff ? [] : schedule,
  };
}
