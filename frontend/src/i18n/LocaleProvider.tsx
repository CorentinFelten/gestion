/**
 * Locale layer: the active `Intl` locale (fr-FR default, fr-CA alternative),
 * seeded from the authenticated user's `locale` profile field and overridable in
 * session via `setLocale`. Distinct from the LANGUAGE layer (UI strings): locale
 * drives ONLY number/date/currency formatting.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/context/AuthContext';
import type { Locale } from '@/types';
import {
  DEFAULT_LOCALE,
  formatAbs,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonthKey,
  formatNumber,
  formatPercent,
  formatSignedMoney,
  type MoneyOptions,
} from './format';

const SUPPORTED_LOCALES: Locale[] = ['fr-FR', 'fr-CA'];

/** Coerce any stored locale string to a supported `Locale` (default fr-FR). */
export function normalizeLocale(value: string | null | undefined): Locale {
  if (value && (SUPPORTED_LOCALES as string[]).includes(value)) return value as Locale;
  // Accept a bare language/region hint, e.g. "fr_CA" or "fr-ca".
  const norm = (value ?? '').replace('_', '-').toLowerCase();
  if (norm.startsWith('fr-ca')) return 'fr-CA';
  return DEFAULT_LOCALE;
}

interface LocaleContextValue {
  locale: Locale;
  /** Override the locale for this session (does not persist to the profile). */
  setLocale: (locale: Locale) => void;
  supportedLocales: Locale[];
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [override, setOverride] = useState<Locale | null>(null);

  const locale = override ?? normalizeLocale(user?.locale);

  const setLocale = useCallback((next: Locale) => setOverride(next), []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, supportedLocales: SUPPORTED_LOCALES }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The active Intl locale + a session setter. Default `fr-FR` outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}

/**
 * Formatters pre-bound to the active locale, the ergonomic way to format in a
 * component: `const f = useFormat(); f.money('12.5', 'EUR')`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useFormat() {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      locale,
      money: (amount: string | number | null | undefined, currency: string, opts?: MoneyOptions) =>
        formatMoney(amount, currency, locale, opts),
      abs: (amount: string | number | null | undefined, currency: string) =>
        formatAbs(amount, currency, locale),
      signedMoney: (amount: string | number | null | undefined, currency: string) =>
        formatSignedMoney(amount, currency, locale),
      number: (value: string | number | null | undefined, opts?: Intl.NumberFormatOptions) =>
        formatNumber(value, locale, opts),
      percent: (
        value: string | number | null | undefined,
        opts?: { fractionDigits?: number; alreadyPercent?: boolean },
      ) => formatPercent(value, locale, opts),
      date: (value: string | number | Date | null | undefined) => formatDate(value, locale),
      dateTime: (value: string | number | Date | null | undefined) =>
        formatDateTime(value, locale),
      monthKey: (key: string, opts?: Intl.DateTimeFormatOptions) =>
        formatMonthKey(key, locale, opts),
    }),
    [locale],
  );
}
