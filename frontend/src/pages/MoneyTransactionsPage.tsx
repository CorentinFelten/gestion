import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { accountTypeLabel, categoryLabel, personalTxTypeLabel, useT } from '@/i18n';
import { usePersonalTransactions } from '@/hooks/usePersonalTx';
import { useAccounts } from '@/hooks/useAccounts';
import { usePersonalCategories } from '@/hooks/usePersonalMeta';
import {
  useSavedFilters,
  useCreateSavedFilter,
  useDeleteSavedFilter,
} from '@/hooks/useSavedFilters';
import type { PersonalTxnType, SavedFilterValue } from '@/types';
import { useMoneyTxModal } from '@/components/money/MoneyTxModal';
import { TransactionRow } from '@/components/money/TransactionRow';
import {
  Button,
  Card,
  EmptyBlock,
  ErrorBlock,
  Field,
  LoadingBlock,
  PageHeader,
  Select,
  TextInput,
  errorMessage,
} from '@/components/money/ui';

type Period = 'month' | 'year' | 'all' | 'custom';

/** Date window for a preset period, in UTC (matches the backend's day bucketing). */
function periodRange(period: Period): { from: string; to: string } {
  if (period === 'all') return { from: '', to: '' };
  const now = new Date();
  const y = now.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  // month
  const m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}

/**
 * The dedicated, full personal-transaction ledger: every income / expense /
 * transfer across accounts, with a period gate (month · year · all · custom)
 * and rich facet filters (type · account · category · amount · search). The
 * `/money` overview stays limited to the current month; this is where you dig.
 *
 * The server query is scoped by the date window only; the remaining facets are
 * applied client-side so the category / account dropdowns can offer exactly the
 * values actually present in the window (no empty options).
 */
export default function MoneyTransactionsPage() {
  const { t, plural } = useT();
  const txModal = useMoneyTxModal();

  const accounts = useAccounts();
  const categories = usePersonalCategories();

  const savedFilters = useSavedFilters();
  const createFilter = useCreateSavedFilter();
  const deleteFilter = useDeleteSavedFilter();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<Period>('year');
  const initial = periodRange('year');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [type, setType] = useState<'' | PersonalTxnType>('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Server query: date window only (facets are applied client-side below).
  const txs = usePersonalTransactions({
    from: from || undefined,
    to: to || undefined,
  });

  const accountsById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    [accounts.data],
  );
  const categoryNameById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name] as const)),
    [categories.data],
  );

  const windowRows = useMemo(() => txs.data ?? [], [txs.data]);

  // Facet options limited to values present in the current window.
  const presentAccounts = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of windowRows) {
      ids.add(tx.accountId);
      if (tx.transferAccountId) ids.add(tx.transferAccountId);
    }
    return [...ids]
      .map((id) => accountsById.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [windowRows, accountsById]);

  const presentCategories = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of windowRows) if (tx.categoryId) ids.add(tx.categoryId);
    return [...ids]
      .map((id) => ({ id, name: categoryNameById.get(id) }))
      .filter((c): c is { id: string; name: string } => !!c.name)
      .sort((a, b) => categoryLabel(a.name).localeCompare(categoryLabel(b.name), 'fr'));
  }, [windowRows, categoryNameById]);

  // Client-side facet filtering (mirrors the backend's account "either leg" rule).
  const rows = useMemo(() => {
    const min = minAmount.trim() ? new Decimal(minAmount) : null;
    const max = maxAmount.trim() ? new Decimal(maxAmount) : null;
    const q = search.trim().toLowerCase();
    return windowRows.filter((tx) => {
      if (type && tx.type !== type) return false;
      if (accountId && tx.accountId !== accountId && tx.transferAccountId !== accountId)
        return false;
      if (categoryId && tx.categoryId !== categoryId) return false;
      if (min || max) {
        let amt: Decimal;
        try {
          amt = new Decimal(tx.amount);
        } catch {
          return false;
        }
        if (min && amt.lt(min)) return false;
        if (max && amt.gt(max)) return false;
      }
      if (q) {
        const catName = tx.categoryId ? categoryNameById.get(tx.categoryId) : null;
        const hay = [tx.payeeSource, tx.notes, catName ? categoryLabel(catName) : null]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [windowRows, type, accountId, categoryId, minAmount, maxAmount, search, categoryNameById]);

  const hasFacetFilter =
    !!type || !!accountId || !!categoryId || !!search.trim() || !!minAmount.trim() || !!maxAmount.trim();

  function setPreset(p: Period) {
    setPeriod(p);
    if (p !== 'custom') {
      const r = periodRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function applySaved(value: SavedFilterValue) {
    setType(value.type ?? '');
    setAccountId(value.accountId ?? '');
    setCategoryId(value.categoryId ?? '');
    setSearch(value.search ?? '');
    setMinAmount(value.minAmount ?? '');
    setMaxAmount(value.maxAmount ?? '');
    if (value.from || value.to) {
      setPeriod('custom');
      setFrom(value.from ?? '');
      setTo(value.to ?? '');
    }
  }

  function resetFilters() {
    setType('');
    setAccountId('');
    setCategoryId('');
    setSearch('');
    setMinAmount('');
    setMaxAmount('');
  }

  function saveCurrent() {
    const name = window.prompt(t('money.filterSavePrompt'))?.trim();
    if (!name) return;
    const value: SavedFilterValue = {};
    if (type) value.type = type;
    if (accountId) value.accountId = accountId;
    if (categoryId) value.categoryId = categoryId;
    if (search.trim()) value.search = search.trim();
    if (minAmount.trim()) value.minAmount = minAmount.trim();
    if (maxAmount.trim()) value.maxAmount = maxAmount.trim();
    if (period === 'custom') {
      if (from) value.from = from;
      if (to) value.to = to;
    }
    createFilter.mutate({ name, filters: value });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t('money.eyebrow')}
        title={t('money.fullTitle')}
        subtitle={t('money.fullSubtitle')}
        actions={
          <Button variant="primary" onClick={() => txModal.open()}>
            + {t('nav.addTransaction')}
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        {/* Period presets */}
        <div className="mb-3 flex flex-wrap gap-2">
          {([
            ['month', t('money.periodMonth')],
            ['year', t('money.periodYear')],
            ['all', t('money.periodAll')],
            ['custom', t('money.periodCustom')],
          ] as [Period, string][]).map(([p, label]) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {period === 'custom' ? (
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('money.filterFrom')} htmlFor="tx-from">
              <TextInput
                id="tx-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label={t('money.filterTo')} htmlFor="tx-to">
              <TextInput
                id="tx-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {/* Facet filters */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('common.search')} htmlFor="tx-search">
            <TextInput
              id="tx-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('money.filterSearchPlaceholder')}
            />
          </Field>
          <Field label={t('common.type')} htmlFor="tx-type">
            <Select
              id="tx-type"
              value={type}
              onChange={(e) => setType(e.target.value as '' | PersonalTxnType)}
            >
              <option value="">{t('money.filterAllTypes')}</option>
              <option value="expense">{personalTxTypeLabel('expense')}</option>
              <option value="income">{personalTxTypeLabel('income')}</option>
              <option value="transfer">{personalTxTypeLabel('transfer')}</option>
            </Select>
          </Field>
          <Field label={t('money.account')} htmlFor="tx-account-filter">
            <Select
              id="tx-account-filter"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">{t('money.filterAllAccounts')}</option>
              {presentAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {accountTypeLabel(a.type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.category')} htmlFor="tx-category-filter">
            <Select
              id="tx-category-filter"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{t('money.filterAllCategories')}</option>
              {presentCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('money.filterMinAmount')} htmlFor="tx-min">
            <TextInput
              id="tx-min"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label={t('money.filterMaxAmount')} htmlFor="tx-max">
            <TextInput
              id="tx-max"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="∞"
            />
          </Field>
        </div>

        {/* Saved filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          {hasFacetFilter || period === 'custom' ? (
            <>
              <button
                type="button"
                onClick={saveCurrent}
                disabled={createFilter.isPending}
                className="rounded-full border border-amber-600/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
              >
                + {t('money.filterSave')}
              </button>
              {hasFacetFilter ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-full px-3 py-1 text-xs font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {t('common.clearFilters')}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>

      {/* Results */}
      {txs.isLoading ? (
        <LoadingBlock label={t('money.monthTxLoading')} />
      ) : txs.isError ? (
        <ErrorBlock message={errorMessage(txs.error)} onRetry={() => void txs.refetch()} />
      ) : rows.length === 0 ? (
        hasFacetFilter ? (
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
              <Button variant="primary" onClick={() => txModal.open()}>
                {t('nav.addTransaction')}
              </Button>
            }
          />
        )
      ) : (
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
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                accountsById={accountsById}
                categoryNameById={categoryNameById}
                onClick={txModal.open}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
