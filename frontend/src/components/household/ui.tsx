/**
 * Shared visual primitives for the household ledger UI.
 * Identity: cool porcelain/ink surfaces, a single teal brand accent, emerald =
 * "owed to you", rose = "you owe". Money is set in monospace tabular figures.
 */
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useFormat, useT } from '@/i18n';
import './household.css';

// ── Surfaces & structure ──────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'form' | 'article';
}) {
  return (
    <As
      className={`rounded-2xl border border-gray-200/80 bg-white shadow-xs dark:border-gray-800 dark:bg-[#141A24] ${className}`}
    >
      {children}
    </As>
  );
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-prose text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0B0E14] disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm' };
  const variants = {
    primary: 'bg-teal-600 text-white hover:bg-teal-700 active:bg-teal-800',
    secondary:
      'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-100 dark:hover:bg-gray-800',
    ghost:
      'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// ── Form controls ─────────────────────────────────────────────────────────────

const controlClass =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-xs transition-colors focus:border-teal-500 focus:outline-hidden focus:ring-2 focus:ring-teal-500/30 dark:border-gray-700 dark:bg-[#0F141C] dark:text-gray-100';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="eyebrow mb-1.5 block">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlClass} ${className}`} {...rest} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${controlClass} ${className}`} {...rest} />;
}

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlClass} appearance-none pr-8 ${className}`} {...rest}>
      {children}
    </select>
  );
}

/** Segmented pill control for a small set of choices (split type, report group). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-gray-100/70 p-1 dark:border-gray-800 dark:bg-gray-900/60">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-lg font-semibold transition-colors ${pad} ${
              active
                ? 'bg-white text-teal-700 shadow-xs dark:bg-gray-700 dark:text-teal-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Money & identity ──────────────────────────────────────────────────────────

/** Money set in monospace tabular figures. `tone` colors it for tallies. */
export function Money({
  value,
  currency,
  signDisplay,
  tone = 'neutral',
  className = '',
}: {
  value: string | number;
  currency: string;
  signDisplay?: 'auto' | 'always' | 'never' | 'exceptZero';
  tone?: 'neutral' | 'credit' | 'debit' | 'muted';
  className?: string;
}) {
  const f = useFormat();
  const tones = {
    neutral: 'text-gray-900 dark:text-gray-100',
    credit: 'text-emerald-600 dark:text-emerald-400',
    debit: 'text-rose-600 dark:text-rose-400',
    muted: 'text-gray-400',
  };
  return (
    <span className={`font-mono tnum ${tones[tone]} ${className}`}>
      {f.money(value, currency, { signDisplay })}
    </span>
  );
}

export function CurrencyBadge({ code }: { code: string }) {
  return (
    <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[0.68rem] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
      {code}
    </span>
  );
}

const AVATAR_TINTS = [
  'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  'bg-lime-100 text-lime-700 dark:bg-lime-900/50 dark:text-lime-300',
];

function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function Avatar({
  name,
  id,
  size = 'md',
}: {
  name: string;
  id: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dims = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-11 w-11 text-base' };
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dims[size]} ${tintFor(
        id,
      )}`}
      title={name}
    >
      {initials || '?'}
    </span>
  );
}

/**
 * SIGNATURE ELEMENT, the tally strip. A zero-baseline bar: emerald grows right
 * when `net` is positive (owed to you), rose grows left when negative (you owe).
 * `max` scales the fill relative to the largest position on screen.
 */
export function TallyStrip({ net, max }: { net: number; max: number }) {
  const scale = max > 0 ? Math.min(1, Math.abs(net) / max) : 0;
  const pct = (scale * 50).toFixed(2);
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300 dark:bg-gray-600" />
      {net >= 0 ? (
        <div
          className="absolute inset-y-0 left-1/2 rounded-full bg-emerald-500"
          style={{ width: `${pct}%` }}
        />
      ) : (
        <div
          className="absolute inset-y-0 right-1/2 rounded-full bg-rose-500"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}

// ── State blocks ──────────────────────────────────────────────────────────────

export function Spinner({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label={t('common.loading')}
    />
  );
}

/** Unified loading / error / empty placeholder for data panes. */
export function StateBlock({
  state,
  title,
  message,
  action,
}: {
  state: 'loading' | 'error' | 'empty';
  title?: string;
  message?: string;
  action?: ReactNode;
}) {
  const { t } = useT();
  const copy = {
    loading: { t: title ?? t('common.loading'), m: message ?? '' },
    error: { t: title ?? t('common.errorGeneric'), m: message ?? t('common.errorRetry') },
    empty: { t: title ?? t('common.nothingHere'), m: message ?? '' },
  }[state];
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {state === 'loading' ? (
        <Spinner className="text-teal-500" />
      ) : (
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-full text-lg ${
            state === 'error'
              ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-800'
          }`}
        >
          {state === 'error' ? '!' : '·'}
        </span>
      )}
      <div>
        <p className="font-semibold text-gray-800 dark:text-gray-100">{copy.t}</p>
        {copy.m ? <p className="mt-0.5 text-sm text-gray-500">{copy.m}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Banner({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'warn' | 'info';
  children: ReactNode;
}) {
  const tones = {
    error: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300',
    warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
    info: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900/60 dark:bg-teal-950/40 dark:text-teal-300',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role="alert">
      {children}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

/**
 * Categorical palette for charts, teal-led to match the brand, tuned to stay
 * distinct and legible in both light and dark. Cycle with modulo.
 */
export const CHART_COLORS = [
  '#0d9488', // teal
  '#f59e0b', // amber
  '#6366f1', // indigo
  '#ec4899', // pink
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#0ea5e9', // sky
  '#ef4444', // red
  '#84cc16', // lime
  '#f97316', // orange
];

// ── Modal ─────────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useT();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape to close + lock body scroll + trap focus inside the dialog, moving
  // focus in on open and restoring it to the previously focused element on close
  // (mirrors the mobile drawer in Layout.tsx).
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;

    const focusables = (): HTMLElement[] =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];

    // Move initial focus into the dialog.
    (focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) {
          e.preventDefault();
          node?.focus();
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        const idx = active ? items.indexOf(active) : -1;
        if (e.shiftKey && idx <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        } else if (!e.shiftKey && idx === items.length - 1) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-gray-900/50 backdrop-blur-xs sm:items-start sm:p-6 md:p-8">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-gray-200 bg-white shadow-xl outline-hidden dark:border-gray-800 dark:bg-[#141A24] sm:my-4 sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        }`}
      >
        {/* Bottom-sheet grab handle (mobile only) */}
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-700" />
        </div>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:px-6">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>
        <div
          className="overflow-y-auto px-5 py-5 sm:px-6"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
