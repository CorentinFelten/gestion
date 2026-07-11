import { useFormat } from '@/i18n';
import { isNegative } from './format';
import { tabular } from './ui';

/**
 * A monetary figure with consistent income(emerald)/expense(rose)/neutral
 * treatment and tabular alignment. `signed` flips styling by sign; `flow`
 * forces the income/expense reading regardless of the stored sign.
 * Formatting follows the active locale via `useFormat()`.
 */
export function MoneyAmount({
  value,
  currency,
  className = '',
  signed = false,
  flow,
  size = 'md',
}: {
  value: string | number | null | undefined;
  currency: string;
  className?: string;
  signed?: boolean;
  flow?: 'income' | 'expense' | 'neutral';
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
}) {
  const f = useFormat();
  const neg = isNegative(value);
  const tone =
    flow === 'income'
      ? 'text-emerald-600 dark:text-emerald-400'
      : flow === 'expense'
        ? 'text-rose-600 dark:text-rose-400'
        : flow === 'neutral'
          ? 'text-gray-900 dark:text-gray-100'
          : signed
            ? neg
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-emerald-600 dark:text-emerald-400'
            : 'text-gray-900 dark:text-gray-100';

  const sizeClass = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl font-semibold',
    xl: 'text-3xl font-semibold',
    hero: 'text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight break-words',
  }[size];

  const text =
    flow === 'income'
      ? f.signedMoney(value, currency)
      : flow === 'expense'
        ? `−${f.abs(value, currency)}`
        : signed
          ? f.signedMoney(value, currency)
          : f.money(value, currency);

  return <span className={tabular(`${sizeClass} ${tone} ${className}`)}>{text}</span>;
}
