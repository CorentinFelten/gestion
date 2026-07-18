import { useEffect, useRef } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useT } from '@/i18n';
import { fr } from '@/i18n/dictionaries/fr';

/**
 * Shared primitives for the private "My Money" area.
 * Design language: a personal *passbook / statement*. Neutral ink surfaces,
 * hairline rules, right-aligned tabular figures, and a restrained gold accent
 * (money / vault) reserved for chrome, section eyebrows, active states, the
 * "Private" chip. Income is emerald, expense is rose; the accent never doubles
 * as either so the green/red reading stays unambiguous.
 */

// Gold accent, used sparingly for chrome only.
export const ACCENT_TEXT = 'text-amber-700 dark:text-amber-400';
export const ACCENT_BG = 'bg-amber-600 dark:bg-amber-500';

export function tabular(extra = ''): string {
  return `tabular-nums [font-variant-numeric:tabular-nums] ${extra}`.trim();
}

/** Owner-only marker, this whole area is private per PLAN §9. */
export function PrivateChip() {
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-600/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:border-amber-400/30 dark:text-amber-400">
      <span aria-hidden>🔒</span> {t('money.private')}
    </span>
  );
}

/** Uppercase micro-label with a gold tick, the section's structural voice. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
      <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_BG}`} aria-hidden />
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-5 dark:border-gray-800">
      <div>
        <div className="mb-2 flex items-center gap-3">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <PrivateChip />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  return (
    <Tag
      className={`rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <Eyebrow>{children}</Eyebrow>
      {aside}
    </div>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'outline';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200',
  outline:
    'border border-gray-300 text-gray-800 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800',
  ghost: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
  danger:
    'border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/10',
};

export function Button({
  variant = 'outline',
  className = '',
  children,
  ...props
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ── Form fields ──────────────────────────────────────────────────────────────
const FIELD_BASE =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs outline-hidden transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 disabled:opacity-60';

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
    >
      {children}
    </label>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{hint}</p> : null}
    </div>
  );
}

export function TextInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_BASE} ${className}`} {...props} />;
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${FIELD_BASE} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function TextArea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD_BASE} ${className}`} {...props} />;
}

// ── Segmented control ────────────────────────────────────────────────────────
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-800 dark:bg-gray-900"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-white text-gray-900 shadow-xs dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── State blocks ─────────────────────────────────────────────────────────────
export function Spinner({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <span
      role="status"
      aria-label={t('common.loading')}
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-200 ${className}`}
    />
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 py-16 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
      <Spinner /> {label ?? t('common.loading')}
    </div>
  );
}

export function ErrorBlock({
  title,
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm dark:border-rose-500/30 dark:bg-rose-500/10">
      <p className="font-medium text-rose-800 dark:text-rose-300">{title ?? t('common.errorGeneric')}</p>
      {message ? <p className="mt-1 text-rose-700/80 dark:text-rose-300/80">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyBlock({
  title,
  message,
  action,
  icon = '◇',
}: {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 px-6 py-14 text-center dark:border-gray-800">
      <span className="mb-3 text-2xl text-gray-300 dark:text-gray-600" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</p>
      {message ? (
        <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ── Modal / bottom-sheet ─────────────────────────────────────────────────────
/**
 * Overlay dialog for the "My Money" area. Bottom-sheet on mobile, centered
 * card on ≥sm. Escape to close, body-scroll lock, focus trap + restore — mirrors
 * the household `Modal` and the mobile drawer in `Layout.tsx`.
 */
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

/** Turns an axios/query error into a readable string. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as {
      response?: { data?: { message?: string | string[] } };
      message?: string;
    };
    const data = anyErr.response?.data?.message;
    if (Array.isArray(data)) return data.join(', ');
    if (typeof data === 'string') return data;
    if (typeof anyErr.message === 'string') return anyErr.message;
  }
  // Non-hook util → source the fallback from the dictionary directly (French-only
  // today) rather than hardcoding a string here.
  return `${fr.common.errorGeneric}. ${fr.common.errorRetry}`;
}
