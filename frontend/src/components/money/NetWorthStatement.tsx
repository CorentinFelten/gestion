import type { NetWorth } from '@/types';
import { accountTypeLabel, isLiabilityAccount, useFormat, useT } from '@/i18n';
import { ACCOUNT_TYPE_ICON, isNegative } from './format';
import { MoneyAmount } from './MoneyAmount';
import { Eyebrow, tabular } from './ui';

/**
 * Signature element of the My Money area: a private *passbook statement*.
 * An "AS OF" eyebrow, the net-worth total as a large tabular figure, then a
 * ruled ledger of every account with native balance and its converted value
 * aligned in right-hand columns, the way a real statement reads.
 */
export function NetWorthStatement({ data }: { data: NetWorth }) {
  const { t, plural } = useT();
  const f = useFormat();
  const negativeTotal = isNegative(data.total);
  const multiCurrency = new Set(data.accounts.map((a) => a.nativeCurrency)).size > 1;

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Statement head */}
      <div className="relative border-b border-gray-200 px-6 py-7 dark:border-gray-800 sm:px-8">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-500/0 via-amber-500 to-amber-500/0" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>
              {t('money.netWorth')} · {t('money.asOf')} {f.date(data.asOf)}
            </Eyebrow>
            <div className="mt-3">
              <MoneyAmount
                value={data.total}
                currency={data.profileCurrency}
                size="hero"
                flow={negativeTotal ? 'expense' : 'neutral'}
              />
            </div>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {plural(data.accounts.length, {
                one: t('money.accountCountOne'),
                other: t('money.accountCountOther'),
              })}{' '}
              · {t('money.valuedIn', { currency: data.profileCurrency })}
              {multiCurrency ? ` ${t('money.atLatestRate')}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Ledger */}
      <div className="px-2 py-2 sm:px-4">
        <div className="hidden px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 sm:flex">
          <span className="flex-1">{t('money.account')}</span>
          <span className="w-40 text-right">{t('money.nativeBalance')}</span>
          <span className="w-40 text-right">
            {t('money.inCurrency', { currency: data.profileCurrency })}
          </span>
        </div>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {data.accounts.map((acc) => {
            const converted = multiCurrency && acc.nativeCurrency !== data.profileCurrency;
            return (
              <li
                key={acc.accountId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:flex-nowrap"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                    aria-hidden
                  >
                    {ACCOUNT_TYPE_ICON[acc.type]}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {acc.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {accountTypeLabel(acc.type)}
                      {isLiabilityAccount(acc.type) ? ` · ${t('money.liability')}` : ''} ·{' '}
                      {acc.nativeCurrency}
                    </p>
                  </div>
                </div>
                <div className="w-32 text-right sm:w-40">
                  <MoneyAmount
                    value={acc.nativeBalance}
                    currency={acc.nativeCurrency}
                    size="sm"
                    className="font-medium"
                  />
                </div>
                <div className="w-32 text-right sm:w-40">
                  {converted ? (
                    <span className={tabular('text-sm text-gray-500 dark:text-gray-400')}>
                      {f.money(acc.convertedBalance, data.profileCurrency)}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-300 dark:text-gray-600">-</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
