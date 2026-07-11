import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Decimal } from 'decimal.js';
import {
  accountTypeLabel,
  categoryLabel,
  personalTxTypeLabel,
  CURRENCIES,
  isoToday,
  useFormat,
  useT,
} from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';
import { useAccounts } from '@/hooks/useAccounts';
import { useCreatePersonalTransaction } from '@/hooks/usePersonalTx';
import {
  useFxRate,
  useLinkableSharedTransactions,
  usePersonalCategories,
} from '@/hooks/usePersonalMeta';
import { MoneyAmount } from '@/components/money/MoneyAmount';
import {
  Button,
  Card,
  EmptyBlock,
  ErrorBlock,
  errorMessage,
  Field,
  LoadingBlock,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  tabular,
  TextArea,
  TextInput,
} from '@/components/money/ui';
import type { CreatePersonalTransactionInput, PersonalTxnType } from '@/types';

const TODAY = isoToday();

export default function MoneyAddPage() {
  const { t } = useT();
  const f = useFormat();

  const accounts = useAccounts();
  const create = useCreatePersonalTransaction();
  const categories = usePersonalCategories();

  const active = useMemo(
    () => (accounts.data ?? []).filter((a) => a.isActive),
    [accounts.data],
  );

  // ── Form state ─────────────────────────────────────────────────────────────
  const [type, setType] = useState<PersonalTxnType>('expense');
  const [accountId, setAccountId] = useState('');
  const [destId, setDestId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [entryCurrency, setEntryCurrency] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferTouched, setTransferTouched] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [payeeSource, setPayeeSource] = useState('');
  const [txnDate, setTxnDate] = useState(TODAY);
  const [notes, setNotes] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkedTransactionId, setLinkedTransactionId] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  // Default the source account + entry currency once accounts load.
  useEffect(() => {
    if (!accountId && active.length > 0) {
      setAccountId(active[0].id);
      setEntryCurrency(active[0].currency);
    }
  }, [active, accountId]);

  const account = active.find((a) => a.id === accountId);
  const dest = active.find((a) => a.id === destId);
  const accountCurrency = account?.currency ?? entryCurrency;

  // Keep entry currency aligned to the picked account when it changes.
  useEffect(() => {
    if (account) setEntryCurrency(account.currency);
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FX: one conversion at a time ─────────────────────────────────────────
  // expense/income → entry currency into the account currency.
  // transfer       → source account currency into the destination currency.
  const isTransfer = type === 'transfer';
  const foreignEntry = !isTransfer && !!accountCurrency && entryCurrency !== accountCurrency;
  const crossTransfer = isTransfer && !!account && !!dest && account.currency !== dest.currency;

  const fxFrom = isTransfer ? account?.currency ?? '' : entryCurrency;
  const fxTo = isTransfer ? dest?.currency ?? '' : accountCurrency;
  const fx = useFxRate(fxFrom, fxTo, txnDate);

  const rate = useMemo(() => (fx.data ? new Decimal(fx.data.rate) : null), [fx.data]);

  // Converted amount into the account currency (income/expense).
  const convertedAccountAmount = useMemo(() => {
    if (!amountInput) return null;
    let base: Decimal;
    try {
      base = new Decimal(amountInput);
    } catch {
      return null;
    }
    if (!foreignEntry) return base;
    if (!rate) return null;
    return base.times(rate).toDecimalPlaces(6);
  }, [amountInput, foreignEntry, rate]);

  // Suggested destination leg for a cross-currency transfer.
  const suggestedTransfer = useMemo(() => {
    if (!crossTransfer || !amountInput || !rate) return null;
    try {
      return new Decimal(amountInput).times(rate).toDecimalPlaces(6);
    } catch {
      return null;
    }
  }, [crossTransfer, amountInput, rate]);

  // Prefill the transfer leg from FX until the user edits it.
  useEffect(() => {
    if (crossTransfer && suggestedTransfer && !transferTouched) {
      setTransferAmount(suggestedTransfer.toString());
    }
    if (!crossTransfer) {
      setTransferAmount('');
      setTransferTouched(false);
    }
  }, [crossTransfer, suggestedTransfer, transferTouched]);

  // Category options filtered by flow.
  const categoryOptions = (categories.data ?? []).filter((c) => {
    if (isTransfer) return false;
    if (c.flow === 'any') return true;
    return c.flow === (type === 'income' ? 'income' : 'expense');
  });

  const linkable = useLinkableSharedTransactions(linkOpen && !isTransfer);

  // ── Validation ─────────────────────────────────────────────────────────────
  const amountPositive = (() => {
    try {
      return new Decimal(amountInput || '0').gt(0);
    } catch {
      return false;
    }
  })();
  const transferValid =
    !isTransfer || (!!destId && destId !== accountId && (!crossTransfer || !!transferAmount));
  const canSubmit =
    !!accountId && amountPositive && transferValid && (!foreignEntry || !!convertedAccountAmount);

  function resetSoft() {
    setAmountInput('');
    setPayeeSource('');
    setNotes('');
    setLinkedTransactionId('');
    setLinkOpen(false);
    setTransferAmount('');
    setTransferTouched(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !account) return;

    const amountInAccountCcy = isTransfer
      ? new Decimal(amountInput).toString()
      : (convertedAccountAmount ?? new Decimal(amountInput)).toString();

    const payload: CreatePersonalTransactionInput = {
      accountId,
      type,
      txnDate,
      amount: amountInAccountCcy,
      categoryId: categoryId || null,
      payeeSource: payeeSource.trim() || null,
      notes: notes.trim() || null,
    };
    if (foreignEntry) {
      payload.amountOriginal = amountInput;
      payload.currencyOriginal = entryCurrency;
    }
    if (isTransfer) {
      payload.transferAccountId = destId;
      if (crossTransfer && transferAmount) payload.transferAmount = transferAmount;
    }
    if (linkedTransactionId) payload.linkedTransactionId = linkedTransactionId;

    create.mutate(payload, {
      onSuccess: () => {
        setJustSaved(true);
        resetSoft();
        window.setTimeout(() => setJustSaved(false), 4000);
      },
    });
  }

  // Guarantee the account's own currency is present, then order pinned-first.
  const currencyBase = useMemo(
    () => (accountCurrency ? [accountCurrency, ...CURRENCIES] : CURRENCIES),
    [accountCurrency],
  );
  const { options: currencyOptions } = usePinnedCurrencyOptions(currencyBase);

  const typeLabel =
    type === 'income'
      ? t('money.receivedLabel')
      : type === 'expense'
        ? t('money.spentLabel')
        : t('money.transferredLabel');

  const recordLabel =
    type === 'income'
      ? t('money.recordIncome')
      : type === 'expense'
        ? t('money.recordExpense')
        : t('money.recordTransfer');

  if (accounts.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader eyebrow={t('money.eyebrow')} title={t('nav.addTransaction')} />
        <LoadingBlock label={t('money.loadingAccounts')} />
      </div>
    );
  }
  if (accounts.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader eyebrow={t('money.eyebrow')} title={t('nav.addTransaction')} />
        <ErrorBlock message={errorMessage(accounts.error)} onRetry={() => void accounts.refetch()} />
      </div>
    );
  }
  if (active.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader eyebrow={t('money.eyebrow')} title={t('nav.addTransaction')} />
        <EmptyBlock
          icon="🏦"
          title={t('money.needAccountTitle')}
          message={t('money.needAccountMessage')}
          action={
            <Link to="/money/accounts">
              <Button variant="primary">{t('money.goToAccounts')}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={t('money.eyebrow')}
        title={t('nav.addTransaction')}
        subtitle={t('money.addSubtitle')}
      />

      {justSaved ? (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <span className="font-medium text-emerald-800 dark:text-emerald-300">
            {t('money.savedBalances')}
          </span>
          <div className="flex gap-3 text-xs font-medium">
            <Link to="/money" className="text-emerald-700 hover:underline dark:text-emerald-400">
              {t('money.overviewTitle')}
            </Link>
            <Link
              to="/money/accounts"
              className="text-emerald-700 hover:underline dark:text-emerald-400"
            >
              {t('accounts.title')}
            </Link>
          </div>
        </div>
      ) : null}

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Segmented
            ariaLabel={t('money.txTypeLabel')}
            value={type}
            onChange={(v) => {
              setType(v);
              setCategoryId('');
              if (v !== 'transfer') setDestId('');
            }}
            options={[
              { value: 'expense', label: personalTxTypeLabel('expense') },
              { value: 'income', label: personalTxTypeLabel('income') },
              { value: 'transfer', label: personalTxTypeLabel('transfer') },
            ]}
          />

          {/* Accounts */}
          <div className={`grid gap-4 ${isTransfer ? 'sm:grid-cols-2' : ''}`}>
            <Field
              label={isTransfer ? t('money.fromAccount') : t('money.account')}
              htmlFor="tx-account"
            >
              <Select
                id="tx-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {active.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {accountTypeLabel(a.type)} · {a.currency}
                  </option>
                ))}
              </Select>
            </Field>
            {isTransfer ? (
              <Field label={t('money.toAccount')} htmlFor="tx-dest">
                <Select id="tx-dest" value={destId} onChange={(e) => setDestId(e.target.value)}>
                  <option value="">{t('money.selectDestination')}</option>
                  {active
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {accountTypeLabel(a.type)} · {a.currency}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
          </div>

          {/* Amount + currency */}
          <Field
            label={
              isTransfer ? `${t('common.amount')} (${accountCurrency || '-'})` : t('common.amount')
            }
            htmlFor="tx-amount"
          >
            <div className="flex gap-2">
              <TextInput
                id="tx-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="min-w-0 flex-1"
                required
              />
              {!isTransfer ? (
                <div className="w-28 shrink-0">
                  <Select
                    aria-label={t('money.entryCurrency')}
                    value={entryCurrency}
                    onChange={(e) => setEntryCurrency(e.target.value)}
                  >
                    {currencyOptions.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <span className="grid w-28 shrink-0 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-sm font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                  {accountCurrency || '-'}
                </span>
              )}
            </div>
          </Field>

          {/* Foreign-currency conversion preview (income/expense) */}
          {foreignEntry ? (
            <ConversionPreview
              loading={fx.isLoading}
              error={fx.isError}
              from={entryCurrency}
              to={accountCurrency}
              rate={fx.data?.rate}
              rateDate={fx.data?.rateDate}
              amountLabel={
                convertedAccountAmount
                  ? `≈ ${f.money(convertedAccountAmount.toString(), accountCurrency)}`
                  : '-'
              }
              note={t('money.foreignEntryNote', {
                account: accountCurrency,
                entry: entryCurrency,
              })}
            />
          ) : null}

          {/* Cross-currency transfer, both legs */}
          {crossTransfer && dest ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t('money.crossTransferTitle')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    {t('money.outOf', { name: account?.name ?? '' })}
                  </p>
                  <MoneyAmount
                    value={amountInput || '0'}
                    currency={account?.currency ?? ''}
                    flow="expense"
                    className="font-semibold"
                  />
                </div>
                <div>
                  <Field
                    label={t('money.into', { name: dest.name, currency: dest.currency })}
                    htmlFor="tx-transfer-amt"
                  >
                    <TextInput
                      id="tx-transfer-amt"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={transferAmount}
                      onChange={(e) => {
                        setTransferTouched(true);
                        setTransferAmount(e.target.value);
                      }}
                      placeholder="0.00"
                    />
                  </Field>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                {fx.isLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Spinner className="h-3 w-3" /> {t('money.fetchingRate')}
                  </span>
                ) : fx.data ? (
                  t('money.transferSuggested', {
                    rate: new Decimal(fx.data.rate).toDecimalPlaces(6).toString(),
                    from: account?.currency ?? '',
                    to: dest.currency,
                    date: f.date(fx.data.rateDate),
                  })
                ) : (
                  t('money.transferManual')
                )}
              </p>
            </div>
          ) : null}

          {/* Category (not for transfers) */}
          {!isTransfer ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('common.category')}
                htmlFor="tx-category"
                hint={categories.isLoading ? t('money.loadingCategories') : undefined}
              >
                <Select
                  id="tx-category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">{t('common.uncategorised')}</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryLabel(c.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={type === 'income' ? t('money.source') : t('money.payee')}
                htmlFor="tx-payee"
                hint={type === 'income' ? t('money.payeeHintIncome') : t('money.payeeHintExpense')}
              >
                <TextInput
                  id="tx-payee"
                  value={payeeSource}
                  onChange={(e) => setPayeeSource(e.target.value)}
                  placeholder={
                    type === 'income'
                      ? t('money.payeePlaceholderIncome')
                      : t('money.payeePlaceholderExpense')
                  }
                />
              </Field>
            </div>
          ) : null}

          {/* Date */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.date')} htmlFor="tx-date">
              <TextInput
                id="tx-date"
                type="date"
                max={TODAY}
                value={txnDate}
                onChange={(e) => setTxnDate(e.target.value)}
              />
            </Field>
          </div>

          {/* Notes */}
          <Field label={t('common.notes')} htmlFor="tx-notes">
            <TextArea
              id="tx-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('common.optional')}
            />
          </Field>

          {/* Link to a shared expense */}
          {!isTransfer ? (
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={linkOpen}
                  onChange={(e) => {
                    setLinkOpen(e.target.checked);
                    if (!e.target.checked) setLinkedTransactionId('');
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t('money.linkToShared')}
                  </span>
                  <span className="block text-xs text-gray-400">{t('money.linkHint')}</span>
                </span>
              </label>

              {linkOpen ? (
                <div className="mt-3">
                  {linkable.isLoading ? (
                    <p className="flex items-center gap-2 text-xs text-gray-400">
                      <Spinner className="h-3 w-3" /> {t('money.loadingShared')}
                    </p>
                  ) : (linkable.data?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-400">{t('money.noShared')}</p>
                  ) : (
                    <Select
                      aria-label={t('money.sharedExpense')}
                      value={linkedTransactionId}
                      onChange={(e) => setLinkedTransactionId(e.target.value)}
                    >
                      <option value="">{t('money.selectShared')}</option>
                      {linkable.data!.map((tx) => (
                        <option key={tx.id} value={tx.id}>
                          {f.date(tx.paymentDate)} · {tx.description} ·{' '}
                          {f.money(tx.amountOriginal, tx.currencyOriginal)}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {create.isError ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">{errorMessage(create.error)}</p>
          ) : null}

          <div className="flex flex-col items-start gap-3 border-t border-gray-100 pt-5 dark:border-gray-800 sm:flex-row sm:items-center">
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || create.isPending}
              className="w-full sm:w-auto"
            >
              {create.isPending ? t('money.saving') : recordLabel}
            </Button>
            {amountPositive && account ? (
              <span className={tabular('text-sm text-gray-400')}>
                {typeLabel}{' '}
                {f.money(
                  isTransfer
                    ? amountInput
                    : (convertedAccountAmount ?? amountInput).toString(),
                  accountCurrency,
                )}
              </span>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}

function ConversionPreview({
  loading,
  error,
  from,
  to,
  rate,
  rateDate,
  amountLabel,
  note,
}: {
  loading: boolean;
  error: boolean;
  from: string;
  to: string;
  rate?: string;
  rateDate?: string;
  amountLabel: string;
  note: string;
}) {
  const { t } = useT();
  const f = useFormat();
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          {t('money.currencyConversion')}
        </p>
        {loading ? (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <Spinner className="h-3 w-3" /> {t('money.fetchingRate')}
          </span>
        ) : rate ? (
          <span className={tabular('text-xs text-gray-500 dark:text-gray-400')}>
            1 {from} = {new Decimal(rate).toDecimalPlaces(6).toString()} {to}
            {rateDate ? ` · ${f.date(rateDate)}` : ''}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">
          {t('money.rateError', { currency: to })}
        </p>
      ) : (
        <p className={tabular('mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100')}>
          {amountLabel}
        </p>
      )}
      <p className="mt-1 text-xs text-gray-400">{note}</p>
    </div>
  );
}
