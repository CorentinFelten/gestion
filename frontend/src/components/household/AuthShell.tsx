/**
 * Two-pane auth shell. Left: a branded "ledger" panel that previews the app's
 * signature tally motif. Right: the form. Collapses to a single column on mobile.
 */
import type { ReactNode } from 'react';
import { useT } from '@/i18n';

function LedgerRow({ label, net, max }: { label: string; net: number; max: number }) {
  const scale = Math.min(1, Math.abs(net) / max) * 50;
  const owed = net >= 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 font-mono text-xs uppercase tracking-wide text-white/60">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
        <div
          className={`absolute inset-y-0 rounded-full ${owed ? 'left-1/2 bg-emerald-400' : 'right-1/2 bg-rose-400'}`}
          style={{ width: `${scale}%` }}
        />
      </div>
      <span
        className={`w-16 shrink-0 text-right font-mono text-xs tnum ${owed ? 'text-emerald-300' : 'text-rose-300'}`}
      >
        {owed ? '+' : '−'}
        {Math.abs(net).toFixed(2)}
      </span>
    </div>
  );
}

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-[#0C1A1A] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(60% 50% at 80% 0%, rgba(20,184,166,0.35), transparent), radial-gradient(50% 40% at 10% 100%, rgba(16,185,129,0.20), transparent)',
          }}
        />
        <div className="relative flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20 font-mono text-teal-300">
            ₲
          </span>
          Gestion
        </div>

        <div className="relative">
          <p className="mb-6 max-w-sm text-2xl font-bold leading-snug tracking-tight">
            {t('auth.brandTagline')}
          </p>
          <div className="max-w-sm space-y-3 rounded-2xl bg-white/4 p-5 ring-1 ring-white/10">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-white/50">
              {t('auth.brandLedgerLabel')}
            </p>
            <LedgerRow label={t('auth.brandYou')} net={42.5} max={60} />
            <LedgerRow label="Sam" net={-42.5} max={60} />
          </div>
        </div>

        <p className="relative font-mono text-xs text-white/40">
          {t('auth.brandFeatures')}
        </p>
      </div>

      {/* Form panel */}
      <div className="flex min-w-0 items-center justify-center bg-[#F6F7F9] px-6 py-12 dark:bg-[#0B0E14]">
        <div className="w-full max-w-sm">
          <p className="eyebrow mb-2">{eyebrow}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-sm text-gray-500">{footer}</div>
        </div>
      </div>
    </div>
  );
}
