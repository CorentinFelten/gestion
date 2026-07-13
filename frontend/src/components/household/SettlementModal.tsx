/**
 * Record a reimbursement (settlement) from a debtor to a creditor within a
 * category. Prefills the exact outstanding for a one-click "reset tally", but the
 * amount is editable for a partial payment. The payer picks the currency actually
 * used; a live preview converts it to base and shows how much of the debt clears.
 */
import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { isApiError } from '@/lib/api';
import type { CreateSettlementInput } from '@/types';
import { isoToday, minorUnits, toNumber } from './format';
import { useCreateSettlement } from '@/hooks/useSettlements';
import { useFxPreview } from '@/hooks/useTransactions';
import { Banner, Button, CurrencyBadge, Field, Input, Modal, Select, Textarea } from './ui';
import { useT, useFormat, categoryLabel } from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';

export interface SettlementTarget {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  categoryId: string | null;
  categoryName: string;
  outstandingBase: string;
}

export function SettlementModal({
  open,
  onClose,
  householdId,
  target,
  baseCurrency,
  currencies,
  defaultCurrency,
}: {
  open: boolean;
  onClose: () => void;
  householdId: string;
  target: SettlementTarget | null;
  baseCurrency: string;
  currencies: string[];
  defaultCurrency: string;
}) {
  const { t } = useT();
  const f = useFormat();
  const outstanding = toNumber(target?.outstandingBase);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [date, setDate] = useState(isoToday());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateSettlement(householdId);

  useEffect(() => {
    if (!open || !target) return;
    setCurrency(baseCurrency);
    setAmount(new Decimal(outstanding).toDecimalPlaces(minorUnits(baseCurrency)).toString());
    setDate(isoToday());
    setNote('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const currencyBase = useMemo(() => {
    const set = new Set([baseCurrency, defaultCurrency, ...currencies]);
    return Array.from(set).filter(Boolean);
  }, [currencies, baseCurrency, defaultCurrency]);
  const { codes: currencyOptions } = usePinnedCurrencyOptions(currencyBase);

  const fxPreview = useFxPreviewSafe(currency, baseCurrency, date);
  const baseEquiv =
    currency === baseCurrency
      ? toNumber(amount)
      : fxPreview?.rate
        ? new Decimal(toNumber(amount)).times(fxPreview.rate).toNumber()
        : null;

  const clears = baseEquiv ?? 0;
  const isFull = baseEquiv !== null && Math.abs(clears - outstanding) < 0.005;
  const remaining = baseEquiv !== null ? Math.max(0, outstanding - clears) : outstanding;

  if (!target) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!target) return;
    // A one-click reset in the base currency must drive the debt to exactly zero.
    // The outstanding balance can carry sub-cent precision (6 dp) from FX-converted
    // splits; rounding the paid amount to 2 dp would leave a residual and the
    // backend would not flag it as a full reset. So submit the exact outstanding.
    const isBaseFullReset = currency === baseCurrency && isFull;
    const amountOriginal = isBaseFullReset
      ? new Decimal(target.outstandingBase).toDecimalPlaces(6).toString()
      : new Decimal(toNumber(amount)).toDecimalPlaces(minorUnits(currency)).toString();
    const payload: CreateSettlementInput = {
      fromUserId: target.fromUserId,
      toUserId: target.toUserId,
      categoryId: target.categoryId,
      amountOriginal,
      currencyOriginal: currency,
      paymentDate: date,
      note: note.trim() || null,
    };
    try {
      await create.mutateAsync(payload);
      onClose();
    } catch (err) {
      setError(
        isApiError(err)
          ? String(
              Array.isArray(err.response.data.message)
                ? err.response.data.message.join(', ')
                : err.response.data.message,
            )
          : t('settleUp.saveError'),
      );
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('settleUp.recordReimbursement')}>
      <form onSubmit={submit} className="space-y-5">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-800 dark:bg-gray-900/50">
          <p className="flex items-center justify-between">
            <span className="font-medium">
              {target.fromName} <span className="text-gray-400">{t('settleUp.paysVerb')}</span> {target.toName}
            </span>
            <span className="eyebrow">{categoryLabel(target.categoryName)}</span>
          </p>
          <p className="mt-1 text-gray-500">
            {t('settleUp.outstanding')} :{' '}
            <span className="font-mono font-semibold tnum text-gray-900 dark:text-gray-100">
              {f.money(outstanding, baseCurrency)}
            </span>
          </p>
        </div>

        <Field label={t('settleUp.amountPaid')} htmlFor="s-amount" hint={t('settleUp.partialHint')}>
          <div className="flex gap-2">
            <Input
              id="s-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-right font-mono tnum"
            />
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28" aria-label={t('common.currency')}>
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          {currency !== baseCurrency ? (
            <p className="mt-1.5 text-xs text-gray-500">
              {fxPreview ? (
                <>
                  ≈{' '}
                  <span className="font-mono tnum">{f.money(clears, baseCurrency)}</span>{' '}
                  <CurrencyBadge code={baseCurrency} /> @ {f.number(fxPreview.rate, { maximumFractionDigits: 6 })}
                </>
              ) : (
                <span className="text-amber-600">{t('settleUp.rateResolved')}</span>
              )}
            </p>
          ) : null}
        </Field>

        <Field label={t('transactions.paymentDate')} htmlFor="s-date">
          <Input id="s-date" type="date" max={isoToday()} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>

        <Field label={t('settleUp.note')} htmlFor="s-note">
          <Textarea
            id="s-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('settleUp.notePlaceholder')}
          />
        </Field>

        <div
          className={`rounded-xl px-4 py-2.5 text-sm ${
            isFull
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
          }`}
        >
          {isFull ? (
            <span className="font-medium">✓ {t('settleUp.resetsToZero')}</span>
          ) : (
            <span>
              {t('settleUp.partialLeaves', { amount: f.money(remaining, baseCurrency) })}
            </span>
          )}
        </div>

        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-gray-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-gray-800 dark:bg-[#141A24]/95 sm:-mx-6 sm:px-6">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1 sm:flex-none">
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || toNumber(amount) <= 0}
            className="flex-1 sm:flex-none"
          >
            {create.isPending ? t('settleUp.recording') : isFull ? t('settleUp.resetTally') : t('settleUp.recordPayment')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Thin wrapper so the FX preview hook is always called in a stable order. */
function useFxPreviewSafe(from: string, to: string, date: string) {
  const q = useFxPreview(from, to, date);
  if (from === to) return { rate: '1' };
  return q.data ?? null;
}
