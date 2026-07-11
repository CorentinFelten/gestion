/**
 * Add / edit a shared transaction: amount + currency, date, payer, category,
 * split editor with live balancing, live base-currency conversion preview, and
 * an optional receipt upload (posted after the transaction is created).
 */
import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { api, isApiError } from '@/lib/api';
import { csrfHeaders } from './csrf';
import type { Category, CreateTransactionInput, Member, SplitType, Transaction } from '@/types';
import { isoToday, minorUnits, toNumber, type SplitDraft } from './format';
import {
  useCreateTransaction,
  useFxPreview,
  useUpdateTransaction,
} from '@/hooks/useTransactions';
import { Banner, Button, CurrencyBadge, Field, Input, Modal, Select, Textarea } from './ui';
import { SplitEditor, buildSplitInputs, splitStatus } from './SplitEditor';
import { useT, useFormat, categoryLabel } from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';

function initialDrafts(members: Member[], editing: Transaction | null): SplitDraft[] {
  return members.map((m) => {
    const existing = editing?.splits.find((s) => s.userId === m.userId);
    return {
      userId: m.userId,
      selected: editing ? !!existing : true,
      value: existing && editing?.splits[0]?.splitType !== 'equal' ? existing.shareValue : '',
    };
  });
}

export function TransactionModal({
  open,
  onClose,
  householdId,
  members,
  categories,
  currencies,
  baseCurrency,
  defaultCurrency,
  defaultPayerId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  members: Member[];
  categories: Category[];
  currencies: string[];
  baseCurrency: string;
  defaultCurrency: string;
  defaultPayerId: string;
  editing: Transaction | null;
}) {
  const { t } = useT();
  const f = useFormat();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [paymentDate, setPaymentDate] = useState(isoToday());
  const [payerUserId, setPayerUserId] = useState(defaultPayerId);
  const [categoryId, setCategoryId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [drafts, setDrafts] = useState<SplitDraft[]>(initialDrafts(members, editing));
  const [receipt, setReceipt] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const create = useCreateTransaction(householdId);
  const update = useUpdateTransaction(householdId);

  // Re-seed the form whenever it opens (create vs edit).
  useEffect(() => {
    if (!open) return;
    setDescription(editing?.description ?? '');
    setAmount(editing?.amountOriginal ?? '');
    setCurrency(editing?.currencyOriginal ?? defaultCurrency);
    setPaymentDate(editing?.paymentDate?.slice(0, 10) ?? isoToday());
    setPayerUserId(editing?.payerUserId ?? defaultPayerId);
    setCategoryId(editing?.categoryId ?? '');
    setNotes(editing?.notes ?? '');
    setSplitType((editing?.splits[0]?.splitType as SplitType) ?? 'equal');
    setDrafts(initialDrafts(members, editing));
    setReceipt(null);
    setSubmitError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const currencyBase = useMemo(() => {
    const set = new Set([defaultCurrency, baseCurrency, ...currencies]);
    return Array.from(set).filter(Boolean);
  }, [currencies, defaultCurrency, baseCurrency]);
  const { codes: currencyOptions } = usePinnedCurrencyOptions(currencyBase);

  const fx = useFxPreview(currency, baseCurrency, paymentDate);
  const status = splitStatus(splitType, amount, drafts, currency);

  const baseEquiv =
    currency === baseCurrency
      ? toNumber(amount)
      : fx.data
        ? new Decimal(toNumber(amount)).times(toNumber(fx.data.rate)).toNumber()
        : null;

  const canSubmit =
    description.trim().length > 0 &&
    toNumber(amount) > 0 &&
    !!payerUserId &&
    status.valid &&
    !create.isPending &&
    !update.isPending;

  async function uploadReceipt(txId: string) {
    if (!receipt) return;
    const form = new FormData();
    form.append('file', receipt);
    const headers = await csrfHeaders();
    await api.post(`/transactions/${txId}/attachments`, form, {
      headers: { ...headers, 'Content-Type': 'multipart/form-data' },
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const payload: CreateTransactionInput = {
      payerUserId,
      description: description.trim(),
      categoryId: categoryId || null,
      notes: notes.trim() || null,
      amountOriginal: new Decimal(toNumber(amount)).toDecimalPlaces(minorUnits(currency)).toString(),
      currencyOriginal: currency,
      paymentDate,
      splits: buildSplitInputs(splitType, drafts),
    };
    try {
      const tx = editing
        ? await update.mutateAsync({ id: editing.id, input: payload })
        : await create.mutateAsync(payload);
      await uploadReceipt(tx.id).catch(() => undefined);
      onClose();
    } catch (err) {
      setSubmitError(
        isApiError(err)
          ? String(
              Array.isArray(err.response.data.message)
                ? err.response.data.message.join(', ')
                : err.response.data.message,
            )
          : t('transactions.saveError'),
      );
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? t('transactions.modalEdit') : t('transactions.modalAdd')} wide>
      <form onSubmit={onSubmit} className="space-y-5">
        {submitError ? <Banner tone="error">{submitError}</Banner> : null}

        <Field label={t('common.description')} htmlFor="tx-desc">
          <Input
            id="tx-desc"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('transactions.descriptionPlaceholder')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.amount')} htmlFor="tx-amount">
            <div className="flex gap-2">
              <Input
                id="tx-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="text-right font-mono tnum"
              />
              <Select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                aria-label={t('common.currency')}
                className="w-28"
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-1.5 h-4 text-xs text-gray-500">
              {currency === baseCurrency ? (
                <span>{t('transactions.householdBaseCurrency')}</span>
              ) : fx.isLoading ? (
                <span>{t('transactions.fetchingRate', { date: f.date(paymentDate) })}</span>
              ) : fx.isError ? (
                <span className="text-amber-600">{t('transactions.rateUnavailable')}</span>
              ) : baseEquiv !== null && fx.data ? (
                <span>
                  ≈ <span className="font-mono tnum">{f.money(baseEquiv, baseCurrency)}</span>{' '}
                  <CurrencyBadge code={baseCurrency} /> @ {fx.data.rate} ({fx.data.rateDate})
                </span>
              ) : null}
            </div>
          </Field>

          <Field label={t('transactions.paymentDate')} htmlFor="tx-date" hint={t('transactions.rateFrozenHint')}>
            <Input
              id="tx-date"
              type="date"
              required
              max={isoToday()}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.paidBy')} htmlFor="tx-payer">
            <Select
              id="tx-payer"
              value={payerUserId}
              onChange={(e) => setPayerUserId(e.target.value)}
              required
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('common.category')} htmlFor="tx-category">
            <Select id="tx-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('common.uncategorised')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {categoryLabel(c.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <SplitEditor
          members={members}
          currency={currency}
          total={amount}
          type={splitType}
          drafts={drafts}
          onChangeType={setSplitType}
          onChangeDrafts={setDrafts}
        />

        <Field label={t('common.notes')} htmlFor="tx-notes">
          <Textarea
            id="tx-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('transactions.notesPlaceholder')}
          />
        </Field>

        <Field label={t('transactions.receipt')} htmlFor="tx-receipt" hint={receipt ? receipt.name : t('transactions.receiptHint')}>
          <input
            id="tx-receipt"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gray-700 hover:file:bg-gray-200 dark:file:bg-gray-800 dark:file:text-gray-200"
          />
        </Field>

        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-gray-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-gray-800 dark:bg-[#141A24]/95 sm:-mx-6 sm:px-6">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1 sm:flex-none">
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            className="flex-1 sm:flex-none"
          >
            {create.isPending || update.isPending
              ? t('common.saving')
              : editing
                ? t('common.saveChanges')
                : t('transactions.addTransaction')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
