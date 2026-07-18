import { accountTypeLabel, categoryLabel, personalTxTypeLabel, useFormat } from '@/i18n';
import type { Account, PersonalTransaction } from '@/types';
import { MoneyAmount } from './MoneyAmount';
import { TXN_TYPE_ICON, signedAmountForType } from './format';

/**
 * One personal-transaction line, shared by the current-month overview list and
 * the full transactions page. Shown in the account's native currency, most
 * recent first. When `onClick` is given the whole row is a button (opens the
 * edit overlay); otherwise it renders read-only.
 */
export function TransactionRow({
  tx,
  accountsById,
  categoryNameById,
  onClick,
}: {
  tx: PersonalTransaction;
  accountsById: Map<string, Account>;
  categoryNameById: Map<string, string>;
  onClick?: (tx: PersonalTransaction) => void;
}) {
  const f = useFormat();

  const account = accountsById.get(tx.accountId);
  const currency = account?.currency ?? tx.currencyOriginal ?? 'EUR';
  const typeLabel = personalTxTypeLabel(tx.type);
  const isTransfer = tx.type === 'transfer';
  const dest =
    isTransfer && tx.transferAccountId ? accountsById.get(tx.transferAccountId)?.name : null;
  const categoryName = tx.categoryId ? categoryNameById.get(tx.categoryId) : null;
  const primary =
    (isTransfer && dest ? `→ ${dest}` : tx.payeeSource) ||
    (categoryName ? categoryLabel(categoryName) : typeLabel);
  const delta = signedAmountForType(tx.type, tx.amount);
  const flow = tx.type === 'income' ? 'income' : 'expense';

  // Meta line: date · account (name + type) · (category, unless it's the title).
  const accountLabel = account ? `${account.name} · ${accountTypeLabel(account.type)}` : null;
  const meta = [
    f.date(tx.txnDate),
    accountLabel,
    categoryName && primary !== categoryLabel(categoryName) ? categoryLabel(categoryName) : null,
    tx.linkedTransactionId ? '🔗' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const inner = (
    <>
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
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{primary}</p>
        <p className="truncate text-xs text-gray-400">{meta}</p>
      </div>
      <MoneyAmount
        value={delta.abs().toString()}
        currency={currency}
        size="sm"
        flow={isTransfer ? undefined : flow}
        className="shrink-0 font-medium"
      />
    </>
  );

  if (onClick) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onClick(tx)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900/40"
        >
          {inner}
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/40">
      {inner}
    </li>
  );
}
