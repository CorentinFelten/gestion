import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  accountTypeLabel,
  categoryLabel,
  personalTxTypeLabel,
  useFormat,
  useT,
} from '@/i18n';
import { usePersonalTransactions, type PersonalTxFilters } from '@/hooks/usePersonalTx';
import { useAccounts } from '@/hooks/useAccounts';
import { usePersonalCategories } from '@/hooks/usePersonalMeta';
import {
  useSavedFilters,
  useCreateSavedFilter,
  useDeleteSavedFilter,
} from '@/hooks/useSavedFilters';
import type { SavedFilterValue } from '@/types';
import { MoneyAmount } from './MoneyAmount';
import { TXN_TYPE_ICON, signedAmountForType } from './format';
import { Button, EmptyBlock, ErrorBlock, LoadingBlock, TextInput, errorMessage } from './ui';

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

  const month = useMemo(currentMonthRange, []);
  // Live filter state; defaults to the current calendar month across all accounts.
  const [search, setSearch] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  // A saved filter applied via chip carries its own facets (type/account/range…).
  const [applied, setApplied] = useState<SavedFilterValue | null>(null);

  const filters = useMemo<PersonalTxFilters>(() => {
    const base: PersonalTxFilters = { from: month.from, to: month.to };
    // Saved-filter facets override the month defaults where present.
    const merged: PersonalTxFilters = { ...base, ...(applied ?? {}) };
    if (search.trim()) merged.search = search.trim();
    if (minAmount.trim()) merged.minAmount = minAmount.trim();
    if (maxAmount.trim()) merged.maxAmount = maxAmount.trim();
    return merged;
  }, [month, applied, search, minAmount, maxAmount]);

  const txs = usePersonalTransactions(filters);
  const accounts = useAccounts();
  const categories = usePersonalCategories();

  const savedFilters = useSavedFilters();
  const createFilter = useCreateSavedFilter();
  const deleteFilter = useDeleteSavedFilter();

  const accountsById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );
  const categoryNameById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name] as const)),
    [categories.data],
  );

  const hasCustomFilter =
    !!search.trim() || !!minAmount.trim() || !!maxAmount.trim() || applied !== null;

  const applySaved = (value: SavedFilterValue) => {
    setApplied(value);
    setSearch(value.search ?? '');
    setMinAmount(value.minAmount ?? '');
    setMaxAmount(value.maxAmount ?? '');
  };

  const resetFilters = () => {
    setApplied(null);
    setSearch('');
    setMinAmount('');
    setMaxAmount('');
  };

  const saveCurrent = () => {
    const name = window.prompt(t('money.filterSavePrompt'))?.trim();
    if (!name) return;
    // Persist the effective facets, minus the default month window.
    const value: SavedFilterValue = { ...(applied ?? {}) };
    if (search.trim()) value.search = search.trim();
    if (minAmount.trim()) value.minAmount = minAmount.trim();
    if (maxAmount.trim()) value.maxAmount = maxAmount.trim();
    createFilter.mutate({ name, filters: value });
  };

  const filterBar = (
    <div className="mb-3 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {t('common.search')}
          </span>
          <TextInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('money.filterSearchPlaceholder')}
          />
        </label>
        <label className="sm:w-28">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {t('money.filterMinAmount')}
          </span>
          <TextInput
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="0"
          />
        </label>
        <label className="sm:w-28">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {t('money.filterMaxAmount')}
          </span>
          <TextInput
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="∞"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(savedFilters.data ?? []).map((sf) => (
          <span
            key={sf.id}
            className="inline-flex items-center overflow-hidden rounded-full border border-gray-200 bg-gray-50 text-xs dark:border-gray-800 dark:bg-gray-900"
          >
            <button
              type="button"
              onClick={() => applySaved(sf.filters)}
              className="px-3 py-1 font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {sf.name}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('money.filterDeleteConfirm', { name: sf.name }))) {
                  deleteFilter.mutate(sf.id);
                }
              }}
              aria-label={t('money.filterDelete', { name: sf.name })}
              className="px-2 py-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            >
              ×
            </button>
          </span>
        ))}
        {hasCustomFilter ? (
          <>
            <button
              type="button"
              onClick={saveCurrent}
              disabled={createFilter.isPending}
              className="rounded-full border border-amber-600/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
            >
              + {t('money.filterSave')}
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-full px-3 py-1 text-xs font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {t('common.clearFilters')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );

  let body: ReactNode;
  if (txs.isLoading) {
    body = <LoadingBlock label={t('money.monthTxLoading')} />;
  } else if (txs.isError) {
    body = <ErrorBlock message={errorMessage(txs.error)} onRetry={() => void txs.refetch()} />;
  } else {
    const rows = txs.data ?? [];
    if (rows.length === 0) {
      body = hasCustomFilter ? (
        <EmptyBlock
          icon="◇"
          title={t('money.filterNoMatchesTitle')}
          message={t('money.filterNoMatchesMessage')}
          action={
            <Button variant="ghost" onClick={resetFilters}>
              {t('common.clearFilters')}
            </Button>
          }
        />
      ) : (
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
    } else {
      body = (
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
  }

  return (
    <div>
      {filterBar}
      {body}
    </div>
  );
}
