import { Decimal } from 'decimal.js';
import type { Account, PersonalTransaction } from '@/types';
import { personalTxTypeLabel, useFormat, useT } from '@/i18n';
import { TXN_TYPE_ICON } from './format';
import { MoneyAmount } from './MoneyAmount';
import { EmptyBlock, tabular } from './ui';

/**
 * An account's ledger: every posting against the account with a running
 * balance in the account's native currency, most-recent first. Handles both
 * legs of transfers, a transfer *out of* this account debits it, a transfer
 * *into* it (via transferAccountId) credits it for the converted leg.
 */

interface Row {
  tx: PersonalTransaction;
  delta: Decimal;
  running: string;
  direction: 'in' | 'out';
}

function deltaForAccount(tx: PersonalTransaction, accountId: string): Decimal {
  if (tx.transferAccountId === accountId && tx.accountId !== accountId) {
    // Incoming leg of a transfer, credited with the converted amount if the
    // destination currency differs, otherwise the same amount.
    return new Decimal(tx.transferAmount ?? tx.amount ?? '0');
  }
  const amt = new Decimal(tx.amount ?? '0');
  if (tx.type === 'income') return amt;
  return amt.negated(); // expense or outgoing transfer
}

export function AccountLedger({
  account,
  transactions,
  accountsById,
  onDelete,
  deletingId,
}: {
  account: Account;
  transactions: PersonalTransaction[];
  accountsById: Map<string, Account>;
  onDelete?: (id: string) => void;
  deletingId?: string | null;
}) {
  const { t } = useT();
  const f = useFormat();

  // Chronological ascending to accumulate a running balance from the opening.
  const ascending = [...transactions].sort((a, b) => {
    const d = a.txnDate.localeCompare(b.txnDate);
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt);
  });

  let running = new Decimal(account.openingBalance ?? '0');
  const byId = new Map<string, Row>();
  for (const tx of ascending) {
    const delta = deltaForAccount(tx, account.id);
    running = running.plus(delta);
    byId.set(tx.id, {
      tx,
      delta,
      running: running.toString(),
      direction: delta.isNegative() ? 'out' : 'in',
    });
  }

  const rows = [...ascending].reverse().map((tx) => byId.get(tx.id)!);

  if (rows.length === 0) {
    return (
      <EmptyBlock
        icon="✎"
        title={t('money.ledgerEmptyTitle')}
        message={t('money.ledgerEmptyMessage')}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex items-center border-b border-gray-100 bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:bg-gray-900/60">
        <span className="flex-1">{t('money.posting')}</span>
        <span className="w-24 text-right sm:w-32">{t('common.amount')}</span>
        <span className="w-24 text-right sm:w-36">{t('money.balance')}</span>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map(({ tx, delta, running: run, direction }) => {
          const typeLabel = personalTxTypeLabel(tx.type);
          const isTransfer = tx.type === 'transfer';
          const counterparty =
            isTransfer && tx.transferAccountId
              ? accountsById.get(
                  tx.accountId === account.id ? tx.transferAccountId : tx.accountId,
                )?.name
              : tx.payeeSource;
          const flow = direction === 'in' ? 'income' : 'expense';
          return (
            <li
              key={tx.id}
              className="group flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/40"
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm ${
                  direction === 'in'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                }`}
                aria-hidden
              >
                {TXN_TYPE_ICON[tx.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {counterparty || typeLabel}
                </p>
                <p className="text-xs text-gray-400">
                  {f.date(tx.txnDate)} · {typeLabel}
                  {tx.currencyOriginal && tx.currencyOriginal !== account.currency
                    ? ` · ${f.money(tx.amountOriginal, tx.currencyOriginal)} ${t('money.originalSuffix')}`
                    : ''}
                </p>
              </div>
              <div className="w-24 text-right sm:w-32">
                <MoneyAmount
                  value={delta.abs().toString()}
                  currency={account.currency}
                  size="sm"
                  flow={flow}
                  className="font-medium"
                />
              </div>
              <div className="w-24 text-right sm:w-36">
                <span className={tabular('text-sm text-gray-600 dark:text-gray-300')}>
                  {f.money(run, account.currency)}
                </span>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => onDelete(tx.id)}
                    disabled={deletingId === tx.id}
                    className="ml-2 p-1 text-xs text-gray-400 opacity-100 transition hover:text-rose-500 disabled:opacity-50 dark:text-gray-500 sm:text-gray-300 sm:opacity-0 sm:group-hover:opacity-100 dark:sm:text-gray-600"
                    aria-label={t('money.deleteTransaction')}
                  >
                    {deletingId === tx.id ? '…' : '✕'}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
