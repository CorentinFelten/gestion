import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  accountTypeLabel,
  categoryLabel,
  personalTxTypeLabel,
  useFormat,
  useT,
} from '@/i18n';
import { usePersonalTransactions } from '@/hooks/usePersonalTx';
import { useAccounts } from '@/hooks/useAccounts';
import { usePersonalCategories } from '@/hooks/usePersonalMeta';
import { MoneyAmount } from './MoneyAmount';
import { TXN_TYPE_ICON, signedAmountForType } from './format';
import { Button, EmptyBlock, ErrorBlock, LoadingBlock, errorMessage } from './ui';

/**
 * A scrollable list of every personal transaction in the current calendar
 * month, across all accounts. Income / expense / transfer, most-recent first,
 * each shown in its own account's native currency. Read-only overview, editing
 * lives in the per-account ledger (`/money/accounts`).
 */

function currentMonthRange(): { from: string; to: string; monthKey: string } {
  // Use UTC so the range matches the backend's month summary (which buckets in
  // UTC); local time would disagree near month boundaries in UTC-offset zones.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const monthKey = `${y}-${pad(m + 1)}`;
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${pad(lastDay)}`,
    monthKey,
  };
}

export function MonthTransactions() {
  const { t, plural } = useT();
  const f = useFormat();

  const { from, to } = useMemo(currentMonthRange, []);
  const txs = usePersonalTransactions({ from, to });
  const accounts = useAccounts();
  const categories = usePersonalCategories();

  const accountsById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );
  const categoryNameById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name] as const)),
    [categories.data],
  );

  if (txs.isLoading) {
    return <LoadingBlock label={t('money.monthTxLoading')} />;
  }
  if (txs.isError) {
    return (
      <ErrorBlock message={errorMessage(txs.error)} onRetry={() => void txs.refetch()} />
    );
  }

  const rows = txs.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyBlock
        icon="◇"
        title={t('money.monthTxEmptyTitle')}
        message={t('money.monthTxEmptyMessage')}
        action={
          <Link to="/money/add">
            <Button variant="primary">{t('nav.addTransaction')}</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:bg-gray-900/60">
        <span>
          {plural(rows.length, {
            one: t('money.monthTxCountOne'),
            other: t('money.monthTxCountOther'),
          })}
        </span>
        <span>{t('common.amount')}</span>
      </div>
      <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
        {rows.map((tx) => {
          const account = accountsById.get(tx.accountId);
          const currency = account?.currency ?? tx.currencyOriginal ?? 'EUR';
          const typeLabel = personalTxTypeLabel(tx.type);
          const isTransfer = tx.type === 'transfer';
          const dest =
            isTransfer && tx.transferAccountId
              ? accountsById.get(tx.transferAccountId)?.name
              : null;
          const categoryName = tx.categoryId ? categoryNameById.get(tx.categoryId) : null;
          const primary =
            (isTransfer && dest ? `→ ${dest}` : tx.payeeSource) ||
            (categoryName ? categoryLabel(categoryName) : typeLabel);
          const delta = signedAmountForType(tx.type, tx.amount);
          const flow = tx.type === 'income' ? 'income' : 'expense';

          // Meta line: date · account (name + type) · (category, unless the title).
          const accountLabel = account
            ? `${account.name} · ${accountTypeLabel(account.type)}`
            : null;
          const meta = [
            f.date(tx.txnDate),
            accountLabel,
            categoryName && primary !== categoryLabel(categoryName)
              ? categoryLabel(categoryName)
              : null,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <li
              key={tx.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/40"
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm ${
                  tx.type === 'income'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : tx.type === 'expense'
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'
                }`}
                aria-hidden
              >
                {TXN_TYPE_ICON[tx.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {primary}
                </p>
                <p className="truncate text-xs text-gray-400">{meta}</p>
              </div>
              <MoneyAmount
                value={delta.abs().toString()}
                currency={currency}
                size="sm"
                flow={isTransfer ? undefined : flow}
                className="shrink-0 font-medium"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
