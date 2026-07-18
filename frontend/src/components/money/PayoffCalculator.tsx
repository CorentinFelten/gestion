import { useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { usePayoff } from '@/hooks/useAccounts';
import { MoneyAmount } from '@/components/money/MoneyAmount';
import { PayoffBalanceChart } from '@/components/money/charts';
import { errorMessage, Field, TextInput } from '@/components/money/ui';
import type { Account } from '@/types';

/**
 * Credit-card payoff calculator. The monthly payment defaults to the account's
 * recorded minimum; the backend amortizes the current balance and returns
 * months-to-payoff, interest, and a balance schedule we preview as a mini chart.
 */
export function PayoffCalculator({ account }: { account: Account }) {
  const { t, plural } = useT();
  const [monthlyPayment, setMonthlyPayment] = useState(account.minPayment ?? '');
  const payoff = usePayoff(account.id, monthlyPayment);

  const positive = Number(monthlyPayment) > 0;
  const data = payoff.data;
  const nothingOwed = data ? Number(data.startingBalance) <= 0 : false;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-950/40">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        {t('accounts.payoffTitle')}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-48">
          <Field
            label={t('accounts.monthlyPayment')}
            htmlFor={`payoff-pay-${account.id}`}
            hint={account.minPayment ? t('accounts.payoffMinHint') : undefined}
          >
            <TextInput
              id={`payoff-pay-${account.id}`}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={monthlyPayment}
              onChange={(e) => setMonthlyPayment(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>
      </div>

      {!positive ? (
        <p className="mt-3 text-xs text-gray-400">{t('accounts.payoffEnterPayment')}</p>
      ) : payoff.isLoading ? (
        <p className="mt-3 text-xs text-gray-400">{t('accounts.payoffCalculating')}</p>
      ) : payoff.isError ? (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {errorMessage(payoff.error)}
        </p>
      ) : data ? (
        nothingOwed ? (
          <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
            {t('accounts.payoffNothingOwed')}
          </p>
        ) : data.neverPaysOff ? (
          <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {t('accounts.payoffNeverClears')}
          </p>
        ) : (
          <div className="mt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <PayoffStat label={t('accounts.payoffMonths')}>
                {plural(data.months, {
                  one: t('accounts.payoffMonthsCountOne'),
                  other: t('accounts.payoffMonthsCountOther'),
                })}
              </PayoffStat>
              <PayoffStat label={t('accounts.payoffTotalInterest')}>
                <MoneyAmount
                  value={data.totalInterest}
                  currency={data.currency}
                  size="sm"
                  flow="expense"
                  className="font-semibold"
                />
              </PayoffStat>
              <PayoffStat label={t('accounts.payoffTotalPaid')}>
                <MoneyAmount
                  value={data.totalPaid}
                  currency={data.currency}
                  size="sm"
                  className="font-semibold"
                />
              </PayoffStat>
            </div>
            {data.schedule.length > 1 ? (
              <div className="mt-4">
                <PayoffBalanceChart
                  schedule={data.schedule}
                  currency={data.currency}
                  monthLabel={(n) => t('accounts.payoffMonthLabel', { n })}
                />
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

function PayoffStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{children}</div>
    </div>
  );
}
