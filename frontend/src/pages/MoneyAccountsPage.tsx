import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { accountTypeLabel, countryLabel, useT } from '@/i18n';
import {
  useAccounts,
  useAccountBalance,
  useCreateAccount,
  useUpdateAccount,
} from '@/hooks/useAccounts';
import { useNetWorth } from '@/hooks/useNetWorth';
import {
  usePersonalTransactions,
  useDeletePersonalTransaction,
} from '@/hooks/usePersonalTx';
import { AccountLedger } from '@/components/money/AccountLedger';
import { CreateAccountForm, EditAccountForm } from '@/components/money/AccountForms';
import { PayoffCalculator } from '@/components/money/PayoffCalculator';
import { useMoneyTxModal } from '@/components/money/MoneyTxModal';
import { MoneyAmount } from '@/components/money/MoneyAmount';
import { ACCOUNT_TYPE_ICON } from '@/components/money/format';
import {
  Button,
  Card,
  EmptyBlock,
  ErrorBlock,
  errorMessage,
  LoadingBlock,
  PageHeader,
} from '@/components/money/ui';
import type { Account } from '@/types';

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
  const [editingId, setEditingId] = useState<string | null>(null);

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
                  {/* Mobile: name on its own line, then a row with balance +
                      actions (avoids the name/amount collision). ≥sm: one row. */}
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
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
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {acc.name}
                          </span>
                          {acc.country ? (
                            <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              {countryLabel(acc.country)}
                            </span>
                          ) : null}
                          {!acc.isActive ? (
                            <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              {t('accounts.archived')}
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-xs text-gray-400">
                          {accountTypeLabel(acc.type)} · {acc.currency}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <div className="text-right">
                        {bal !== undefined ? (
                          <MoneyAmount
                            value={bal}
                            currency={acc.currency}
                            className="font-semibold"
                          />
                        ) : (
                          <span className="text-sm text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingId((id) => (id === acc.id ? null : acc.id))}
                          className="rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        >
                          {editingId === acc.id ? t('common.close') : t('common.edit')}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            updateAccount.mutate({ id: acc.id, isActive: !acc.isActive })
                          }
                          disabled={updateAccount.isPending}
                          className="rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        >
                          {acc.isActive ? t('common.archive') : t('accounts.restore')}
                        </button>
                      </div>
                    </div>
                  </div>

                  {editingId === acc.id ? (
                    <EditAccountForm
                      account={acc}
                      pending={updateAccount.isPending}
                      error={updateAccount.isError ? errorMessage(updateAccount.error) : null}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(input) =>
                        updateAccount.mutate(
                          { id: acc.id, ...input },
                          { onSuccess: () => setEditingId(null) },
                        )
                      }
                    />
                  ) : null}

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
  const txModal = useMoneyTxModal();
  const account = accountsById.get(accountId)!;
  const txs = usePersonalTransactions({ accountId });
  const balance = useAccountBalance(accountId);
  const del = useDeletePersonalTransaction();

  return (
    <div className="border-t border-gray-100 p-4 dark:border-gray-800">
      {account.type === 'credit_card' ? (
        <div className="mb-4">
          <PayoffCalculator account={account} />
        </div>
      ) : null}
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
          onEdit={(tx) => txModal.open(tx)}
          onDelete={(id) => {
            if (window.confirm(t('accounts.deleteConfirm'))) {
              del.mutate(id);
            }
          }}
        />
      )}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => txModal.open(null, { accountId })}
          className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
        >
          + {t('accounts.addToAccount')}
        </button>
      </div>
    </div>
  );
}
