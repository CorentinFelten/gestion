/**
 * Split editor: divide a transaction between members by equal / exact / percent /
 * shares, with a live "sums to total" meter. Validation against the *original*
 * amount (the server applies the same frozen rate to every part, so proportions
 * hold in the base currency). Controlled by the parent form.
 */
import Decimal from 'decimal.js';
import type { Member, SplitInput, SplitType } from '@/types';
import { minorUnits, resolveSplits, toNumber, type SplitDraft } from './format';
import { Avatar, Money, Segmented } from './ui';
import { useT, useFormat, SPLIT_TYPE_OPTIONS, type TParams } from '@/i18n';

export type { SplitDraft } from './format';

/** Build the API payload from the current drafts. */
export function buildSplitInputs(type: SplitType, drafts: SplitDraft[]): SplitInput[] {
  return drafts
    .filter((d) => d.selected)
    .map((d) => ({
      userId: d.userId,
      splitType: type,
      shareValue: type === 'equal' ? '1' : d.value || '0',
    }));
}

/** Whether the current split is valid & submittable. Messages are returned as
 * i18n keys (+ optional params) so the caller renders them in the UI language. */
export function splitStatus(
  type: SplitType,
  total: string | number,
  drafts: SplitDraft[],
  currency: string,
): {
  valid: boolean;
  messageKey: string;
  messageParams?: TParams;
  sum: Decimal;
  delta: Decimal;
  percentSum: Decimal;
} {
  const digits = minorUnits(currency);
  const active = drafts.filter((d) => d.selected);
  const totalDec = new Decimal(toNumber(total));
  const { sum } = resolveSplits(type, total, drafts, currency);
  const delta = sum.minus(totalDec);
  const percentSum = active.reduce((acc, d) => acc.plus(toNumber(d.value)), new Decimal(0));

  if (active.length === 0) {
    return { valid: false, messageKey: 'transactions.splitSelectMember', sum, delta, percentSum };
  }
  if (totalDec.lte(0)) {
    return { valid: false, messageKey: 'transactions.splitEnterAmount', sum, delta, percentSum };
  }
  if (type === 'percent' && !percentSum.toDecimalPlaces(4).equals(100)) {
    return {
      valid: false,
      messageKey: 'transactions.splitPercentSum',
      messageParams: { sum: percentSum.toDecimalPlaces(2).toString() },
      sum,
      delta,
      percentSum,
    };
  }
  if (type === 'shares' && percentSum.lte(0)) {
    return { valid: false, messageKey: 'transactions.splitGiveShare', sum, delta, percentSum };
  }
  if (!delta.toDecimalPlaces(digits).isZero()) {
    return { valid: false, messageKey: 'validation.splitsMustSumToTotal', sum, delta, percentSum };
  }
  return { valid: true, messageKey: 'transactions.splitsBalance', sum, delta, percentSum };
}

export function SplitEditor({
  members,
  currency,
  total,
  type,
  drafts,
  onChangeType,
  onChangeDrafts,
}: {
  members: Member[];
  currency: string;
  total: string;
  type: SplitType;
  drafts: SplitDraft[];
  onChangeType: (t: SplitType) => void;
  onChangeDrafts: (d: SplitDraft[]) => void;
}) {
  const { t } = useT();
  const f = useFormat();
  const { amounts } = resolveSplits(type, total, drafts, currency);
  const status = splitStatus(type, total, drafts, currency);
  const digits = minorUnits(currency);

  function update(userId: string, patch: Partial<SplitDraft>) {
    onChangeDrafts(drafts.map((d) => (d.userId === userId ? { ...d, ...patch } : d)));
  }

  const suffix = type === 'percent' ? '%' : type === 'shares' ? '×' : currency;
  const showInput = type !== 'equal';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{t('transactions.splitBetween')}</p>
        <Segmented value={type} onChange={onChangeType} options={SPLIT_TYPE_OPTIONS} size="sm" />
      </div>

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {members.map((m) => {
          const draft = drafts.find((d) => d.userId === m.userId);
          const selected = draft?.selected ?? false;
          return (
            <div
              key={m.userId}
              className={`flex items-center gap-3 px-3 py-2.5 ${selected ? '' : 'opacity-55'}`}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => update(m.userId, { selected: e.target.checked })}
                className="h-4 w-4 shrink-0 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                aria-label={t('transactions.includeMember', { name: m.displayName })}
              />
              <Avatar name={m.displayName} id={m.userId} size="sm" />
              <span className="flex-1 truncate text-sm font-medium">{m.displayName}</span>

              {showInput && selected ? (
                <div className="relative w-28">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={type === 'exact' ? Math.pow(10, -digits) : type === 'percent' ? 0.1 : 1}
                    value={draft?.value ?? ''}
                    onChange={(e) => update(m.userId, { value: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-right font-mono text-sm tnum focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-gray-700 dark:bg-[#0F141C]"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs text-gray-400">
                    {suffix}
                  </span>
                </div>
              ) : null}

              <span className="w-24 shrink-0 text-right">
                {selected ? (
                  <Money value={amounts[m.userId]?.toString() ?? 0} currency={currency} />
                ) : (
                  <span className="font-mono text-sm text-gray-300 dark:text-gray-700">-</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Live sum / remainder meter */}
      <div
        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
          status.valid
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
            : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
        }`}
      >
        <span className="flex items-center gap-2 font-medium">
          <span aria-hidden>{status.valid ? '✓' : '⚠'}</span>
          {t(status.messageKey, status.messageParams)}
        </span>
        <span className="font-mono text-xs tnum">
          {f.money(status.sum.toString(), currency)} /{' '}
          {f.money(toNumber(total), currency)}
        </span>
      </div>
    </div>
  );
}
