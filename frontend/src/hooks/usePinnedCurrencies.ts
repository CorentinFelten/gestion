/**
 * Pinned-first currency ordering for the signed-in user.
 *
 * Reads the current user's `pinnedCurrencies` from AuthContext and returns a
 * base currency list re-ordered so pinned codes come FIRST (in the user's pinned
 * order), then the rest. Use everywhere a currency `<select>` is rendered so the
 * ordering is consistent across the app.
 */
import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  CURRENCIES,
  currencyOptionsFrom,
  splitCurrenciesByPinned,
  type CurrencyOption,
} from '@/i18n';

export interface PinnedCurrencyOptions {
  /** Ordered, de-duplicated, pinned-first currency codes. */
  codes: string[];
  /** `{ value, label }` options (`CODE, Name`) in pinned-first order. */
  options: CurrencyOption[];
  /** The user's pinned codes present in the result (uppercased, deduped). */
  pinned: string[];
  /** The non-pinned remainder, in the base list's order. */
  rest: string[];
}

/**
 * @param baseList Codes to order (defaults to the app's featured `CURRENCIES`).
 *   Pass a page-specific list (e.g. `/currencies` from the API, or a list that
 *   already guarantees a currently-selected value) to reorder it pinned-first.
 */
export function usePinnedCurrencyOptions(
  baseList: readonly string[] = CURRENCIES,
): PinnedCurrencyOptions {
  const { user } = useAuth();
  const pinnedPref = user?.pinnedCurrencies;
  // Depend on the joined contents so inline array literals don't thrash the memo.
  const baseKey = baseList.join(',');
  const pinnedKey = (pinnedPref ?? []).join(',');

  return useMemo(() => {
    const { pinned, rest } = splitCurrenciesByPinned(baseList, pinnedPref);
    const codes = [...pinned, ...rest];
    return { codes, options: currencyOptionsFrom(codes), pinned, rest };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, pinnedKey]);
}
