import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  accountTypeLabel,
  countryDefaultCurrency,
  countryLabel,
  ACCOUNT_TYPE_OPTIONS,
  COUNTRY_OPTIONS,
  CURRENCIES,
  useT,
} from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';
import {
  useAccounts,
  useAccountBalance,
  useCreateAccount,
  useUpdateAccount,
  type CreateAccountInput,
} from '@/hooks/useAccounts';
import { useNetWorth } from '@/hooks/useNetWorth';
import {
  usePersonalTransactions,
  useDeletePersonalTransaction,
} from '@/hooks/usePersonalTx';
import { AccountLedger } from '@/components/money/AccountLedger';
import { MoneyAmount } from '@/components/money/MoneyAmount';
import { ACCOUNT_TYPE_ICON } from '@/components/money/format';
import {
  Button,
  Card,
  EmptyBlock,
  ErrorBlock,
  errorMessage,
  Field,
  LoadingBlock,
  PageHeader,
  Select,
  TextInput,
} from '@/components/money/ui';
import type { Account, AccountType, Country } from '@/types';

export default function MoneyAccountsPage() {
  const { user } = useAuth();
  const { t, plural } = useT();
  const defaultCurrency = user?.preferredCurrency ?? 'EUR';

  const accounts = useAccounts();
  const netWorth = useNetWorth();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();

  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Native balances from net worth (active accounts).
  const balanceByAccount = useMemo(() => {
    const m = new Map<string, string>();
    netWorth.data?.accounts.forEach((a) => m.set(a.accountId, a.nativeBalance));
    return m;
  }, [netWorth.data]);

  const all = useMemo(() => accounts.data ?? [], [accounts.data]);
  const visible = all.filter((a) => (showArchived ? true : a.isActive));
  const archivedCount = all.filter((a) => !a.isActive).length;
  const accountsById = useMemo(() => new Map(all.map((a) => [a.id, a] as const)), [all]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t('money.eyebrow')}
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={
          <Button variant="primary" onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? t('common.close') : `+ ${t('accounts.newAccount')}`}
          </Button>
        }
      />

      {showCreate ? (
        <CreateAccountForm
          defaultCurrency={defaultCurrency}
          pending={createAccount.isPending}
          error={createAccount.isError ? errorMessage(createAccount.error) : null}
          onCancel={() => setShowCreate(false)}
          onSubmit={(input) =>
            createAccount.mutate(input, { onSuccess: () => setShowCreate(false) })
          }
        />
      ) : null}

      {updateAccount.isError ? (
        <p className="mb-4 text-sm text-rose-600 dark:text-rose-400">{t('accounts.archiveError')}</p>
      ) : null}

      {accounts.isLoading ? (
        <LoadingBlock label={t('accounts.loading')} />
      ) : accounts.isError ? (
        <ErrorBlock message={errorMessage(accounts.error)} onRetry={() => void accounts.refetch()} />
      ) : all.length === 0 ? (
        <EmptyBlock
          icon="🏦"
          title={t('accounts.emptyTitle')}
          message={t('accounts.emptyMessage')}
          action={
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              {t('accounts.createAccount')}
            </Button>
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((acc) => {
              const bal = balanceByAccount.get(acc.id);
              const isSelected = acc.id === selectedId;
              return (
                <Card as="li" key={acc.id} className={isSelected ? 'ring-1 ring-amber-500/40' : ''}>
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <button
                      type="button"
                      onClick={() => setSelectedId(isSelected ? null : acc.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-expanded={isSelected}
                    >
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        aria-hidden
                      >
                        {ACCOUNT_TYPE_ICON[acc.type]}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {acc.name}
                          </span>
                          {acc.country ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              {countryLabel(acc.country)}
                            </span>
                          ) : null}
                          {!acc.isActive ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              {t('accounts.archived')}
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-xs text-gray-400">
                          {accountTypeLabel(acc.type)} · {acc.currency}
                        </span>
                      </span>
                    </button>

                    <div className="text-right">
                      {bal !== undefined ? (
                        <MoneyAmount value={bal} currency={acc.currency} className="font-semibold" />
                      ) : (
                        <span className="text-sm text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => updateAccount.mutate({ id: acc.id, isActive: !acc.isActive })}
                      disabled={updateAccount.isPending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      {acc.isActive ? t('common.archive') : t('accounts.restore')}
                    </button>
                  </div>

                  {isSelected ? (
                    <SelectedLedger accountId={acc.id} accountsById={accountsById} />
                  ) : null}
                </Card>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
            <span>
              {plural(visible.length, {
                one: t('accounts.shownCountOne'),
                other: t('accounts.shownCountOther'),
              })}
            </span>
            {archivedCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowArchived((s) => !s)}
                className="font-medium text-amber-700 hover:underline dark:text-amber-400"
              >
                {showArchived
                  ? t('accounts.hideArchived', { count: archivedCount })
                  : t('accounts.showArchived', { count: archivedCount })}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function SelectedLedger({
  accountId,
  accountsById,
}: {
  accountId: string;
  accountsById: Map<string, Account>;
}) {
  const { t } = useT();
  const account = accountsById.get(accountId)!;
  const txs = usePersonalTransactions({ accountId });
  const balance = useAccountBalance(accountId);
  const del = useDeletePersonalTransaction();

  return (
    <div className="border-t border-gray-100 p-4 dark:border-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {t('accounts.ledger')}
        </p>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">
            {t('accounts.currentBalance')}
          </p>
          {balance.data ? (
            <MoneyAmount
              value={balance.data.balance}
              currency={account.currency}
              className="font-semibold"
            />
          ) : (
            <span className="text-sm text-gray-300 dark:text-gray-600">
              {balance.isLoading ? '…' : '-'}
            </span>
          )}
        </div>
      </div>

      {del.isError ? (
        <p className="mb-3 text-sm text-rose-600 dark:text-rose-400">{t('accounts.deleteError')}</p>
      ) : null}

      {txs.isLoading ? (
        <LoadingBlock label={t('accounts.ledgerLoading')} />
      ) : txs.isError ? (
        <ErrorBlock message={errorMessage(txs.error)} onRetry={() => void txs.refetch()} />
      ) : (
        <AccountLedger
          account={account}
          transactions={txs.data ?? []}
          accountsById={accountsById}
          deletingId={del.isPending ? del.variables : null}
          onDelete={(id) => {
            if (window.confirm(t('accounts.deleteConfirm'))) {
              del.mutate(id);
            }
          }}
        />
      )}
      <div className="mt-3">
        <Link
          to="/money/add"
          className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
        >
          + {t('accounts.addToAccount')}
        </Link>
      </div>
    </div>
  );
}

function CreateAccountForm({
  defaultCurrency,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  defaultCurrency: string;
  onSubmit: (input: CreateAccountInput) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [country, setCountry] = useState<Country>(defaultCurrency === 'CAD' ? 'CA' : 'FR');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('0');

  // Guarantee the selected currency is present, then order pinned-first.
  const currencyBase = useMemo(() => [currency, ...CURRENCIES], [currency]);
  const { options: currencyOptions } = usePinnedCurrencyOptions(currencyBase);

  return (
    <Card className="mb-6 p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSubmit({
            name: name.trim(),
            type,
            currency,
            country,
            openingBalance: openingBalance.trim() || '0',
          });
        }}
      >
        <p className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('accounts.newAccountTitle')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label={t('accounts.accountName')} htmlFor="acc-name">
              <TextInput
                id="acc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('accounts.accountNamePlaceholder')}
                autoFocus
                required
              />
            </Field>
          </div>
          <Field label={t('accounts.accountType')} htmlFor="acc-type">
            <Select
              id="acc-type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.country')} htmlFor="acc-country">
            <Select
              id="acc-country"
              value={country}
              onChange={(e) => {
                const next = e.target.value as Country;
                setCountry(next);
                // Default the currency to the country's currency until the user
                // overrides it explicitly.
                if (!currencyTouched) setCurrency(countryDefaultCurrency(next));
              }}
            >
              {COUNTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.currency')} htmlFor="acc-ccy">
            <Select
              id="acc-ccy"
              value={currency}
              onChange={(e) => {
                setCurrencyTouched(true);
                setCurrency(e.target.value);
              }}
            >
              {currencyOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field
              label={t('accounts.openingBalance')}
              htmlFor="acc-open"
              hint={t('accounts.openingBalanceHint')}
            >
              <TextInput
                id="acc-open"
                type="number"
                inputMode="decimal"
                step="any"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

        <div className="mt-5 flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? t('accounts.creating') : t('accounts.createAccount')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
