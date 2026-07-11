import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { useAuth } from '@/context/AuthContext';
import {
  useRequireAuth,
  useHousehold,
  useMembers,
  useCategories,
  useCurrencies,
  useMemberMap,
} from '@/hooks/useHousehold';
import {
  useTransactions,
  useDeleteTransaction,
  type TransactionFilters,
} from '@/hooks/useTransactions';
import { TransactionModal } from '@/components/household/TransactionModal';
import {
  Avatar,
  Banner,
  Button,
  Card,
  CurrencyBadge,
  Field,
  Input,
  Money,
  PageHeader,
  Select,
  StateBlock,
} from '@/components/household/ui';
import { useT, useFormat, categoryLabel } from '@/i18n';
import type { Transaction } from '@/types';

const EMPTY: TransactionFilters = {};

export default function TransactionsPage() {
  const { t, plural } = useT();
  const f = useFormat();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const household = useHousehold();
  const householdId = household.data?.id;
  const base = household.data?.baseCurrency ?? 'EUR';

  const members = useMembers(householdId);
  const memberMap = useMemberMap(members.data);
  const categories = useCategories(householdId);
  const currencies = useCurrencies();

  const [filters, setFilters] = useState<TransactionFilters>(EMPTY);
  const list = useTransactions(householdId, filters);
  const del = useDeleteTransaction(householdId);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const catName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories.data ?? []) map[c.id] = categoryLabel(c.name);
    return map;
  }, [categories.data]);

  const usedCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const t of list.data ?? []) set.add(t.currencyOriginal);
    return Array.from(set);
  }, [list.data]);

  const hasFilters = Object.values(filters).some(Boolean);
  const total = (list.data ?? [])
    .reduce((sum, t) => sum.plus(t.amountBase), new Decimal(0))
    .toString();

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(t: Transaction) {
    setEditing(t);
    setModalOpen(true);
  }
  function set<K extends keyof TransactionFilters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
  }

  if (!ready || household.isLoading) return <StateBlock state="loading" />;
  if (!household.data) return <StateBlock state="empty" title={t('common.noHousehold')} />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={household.data.name}
        title={t('transactions.title')}
        subtitle={t('transactions.subtitle')}
        actions={
          <Button variant="primary" onClick={openAdd} disabled={!members.data?.length}>
            {t('transactions.addTransaction')}
          </Button>
        }
      />

      {/* Filters */}
      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label={t('common.search')} htmlFor="f-search" className="lg:col-span-2">
            <Input
              id="f-search"
              value={filters.search ?? ''}
              onChange={(e) => set('search', e.target.value)}
              placeholder={t('transactions.searchPlaceholder')}
            />
          </Field>
          <Field label={t('transactions.dateFrom')} htmlFor="f-from">
            <Input id="f-from" type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label={t('transactions.dateTo')} htmlFor="f-to">
            <Input id="f-to" type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} />
          </Field>
          <Field label={t('common.member')} htmlFor="f-member">
            <Select id="f-member" value={filters.memberId ?? ''} onChange={(e) => set('memberId', e.target.value)}>
              <option value="">{t('transactions.anyMember')}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.category')} htmlFor="f-cat">
            <Select id="f-cat" value={filters.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">{t('common.all')}</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Field label={t('common.currency')} htmlFor="f-cur" className="w-40">
            <Select id="f-cur" value={filters.currency ?? ''} onChange={(e) => set('currency', e.target.value)}>
              <option value="">{t('transactions.anyCurrency')}</option>
              {(usedCurrencies.length ? usedCurrencies : currencies.data ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
              {t('common.clearFilters')}
            </Button>
          ) : null}
        </div>
      </Card>

      {del.isError ? (
        <div className="mb-5">
          <Banner tone="error">{t('transactions.deleteError')}</Banner>
        </div>
      ) : null}

      {/* List */}
      <Card>
        <div className="flex items-center justify-between px-5 py-3 text-sm">
          <span className="text-gray-500">
            {plural(list.data?.length ?? 0, {
              one: t('transactions.countOne'),
              other: t('transactions.countOther'),
            })}
          </span>
          <span className="text-gray-500">
            {t('common.total')}{' '}
            <span className="font-mono font-semibold tnum text-gray-900 dark:text-gray-100">
              {f.money(total, base)}
            </span>
          </span>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800">
          {list.isLoading ? (
            <StateBlock state="loading" />
          ) : list.isError ? (
            <StateBlock state="error" message={t('transactions.loadError')} />
          ) : (list.data?.length ?? 0) === 0 ? (
            <StateBlock
              state="empty"
              title={hasFilters ? t('transactions.noMatches') : t('transactions.emptyTitle')}
              message={hasFilters ? t('transactions.noMatchesMessage') : t('transactions.emptyMessage')}
              action={
                !hasFilters ? (
                  <Button variant="primary" size="sm" onClick={openAdd} disabled={!members.data?.length}>
                    {t('transactions.addTransaction')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {(list.data ?? []).map((tx) => (
                <li
                  key={tx.id}
                  className="group flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-gray-50/70 dark:hover:bg-gray-800/40 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3 sm:flex-1 sm:gap-4">
                    <Avatar
                      name={memberMap[tx.payerUserId]?.displayName ?? '?'}
                      id={tx.payerUserId}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{tx.description}</p>
                      <p className="text-xs text-gray-400">
                        {memberMap[tx.payerUserId]?.displayName ?? t('common.someone')} ·{' '}
                        {f.date(tx.paymentDate)}
                        {tx.categoryId && catName[tx.categoryId] ? (
                          <>
                            {' · '}
                            <span className="text-gray-500">{catName[tx.categoryId]}</span>
                          </>
                        ) : null}
                        {' · '}
                        {plural(tx.splits.length, {
                          one: t('transactions.splitWaysOne'),
                          other: t('transactions.splitWaysOther'),
                        })}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money value={tx.amountBase} currency={base} className="font-semibold" />
                      {tx.currencyOriginal !== base ? (
                        <p className="text-[0.7rem] text-gray-400">
                          {f.money(tx.amountOriginal, tx.currencyOriginal)}{' '}
                          <CurrencyBadge code={tx.currencyOriginal} />
                        </p>
                      ) : (
                        <p className="text-[0.7rem]">
                          <CurrencyBadge code={base} />
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 justify-end gap-1 border-t border-gray-100 pt-2 transition-opacity focus-within:opacity-100 dark:border-gray-800 sm:border-0 sm:pt-0 sm:opacity-0 sm:group-hover:opacity-100">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(tx)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      onClick={() => {
                        if (window.confirm(t('transactions.confirmDelete', { description: tx.description })))
                          del.mutate(tx.id);
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {household.data && members.data ? (
        <TransactionModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          householdId={household.data.id}
          members={members.data}
          categories={categories.data ?? []}
          currencies={currencies.data ?? []}
          baseCurrency={base}
          defaultCurrency={user?.preferredCurrency ?? base}
          defaultPayerId={user?.id ?? members.data[0]?.userId ?? ''}
          editing={editing}
        />
      ) : null}
    </div>
  );
}
