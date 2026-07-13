import { Decimal } from 'decimal.js';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StatsPoint } from '@/types';
import { personalTxTypeLabel, useFormat, useT } from '@/i18n';
import { toNumber } from './format';
import { useIsDark } from './useIsDark';

/**
 * Recharts wrappers for the Statistics page. One colour system across every
 * chart: emerald = income, rose = expense, amber = net worth / accent, and a
 * brand-neutral qualitative palette for categorical breakdowns. Axis and grid
 * colours adapt to light / dark. All formatting follows the active locale via
 * `useFormat()`.
 */

const INCOME = { light: '#059669', dark: '#34d399' };
const EXPENSE = { light: '#e11d48', dark: '#fb7185' };
const ACCENT = { light: '#d97706', dark: '#fbbf24' };

// Qualitative palette, distinguishable in both themes, avoids emerald/rose.
const QUALITATIVE = ['#6366f1', '#0ea5e9', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16'];

// Compact month label for chart axes, e.g. `mars 26`.
const MONTH_AXIS_OPTS: Intl.DateTimeFormatOptions = { month: 'short', year: '2-digit' };

function useChartTheme() {
  const dark = useIsDark();
  return {
    dark,
    income: dark ? INCOME.dark : INCOME.light,
    expense: dark ? EXPENSE.dark : EXPENSE.light,
    accent: dark ? ACCENT.dark : ACCENT.light,
    grid: dark ? '#1f2937' : '#eef2f7',
    axis: dark ? '#9ca3af' : '#6b7280',
    tooltipBg: dark ? '#0b1220' : '#ffffff',
    tooltipBorder: dark ? '#374151' : '#e5e7eb',
    tooltipText: dark ? '#e5e7eb' : '#111827',
  };
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: { fullLabel?: string };
}

function MoneyTooltip({
  active,
  payload,
  label,
  currency,
  theme,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  currency: string;
  theme: ReturnType<typeof useChartTheme>;
}) {
  const f = useFormat();
  if (!active || !payload || payload.length === 0) return null;
  const title = payload[0]?.payload?.fullLabel ?? label;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{
        background: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        color: theme.tooltipText,
      }}
    >
      <p className="mb-1 font-semibold">{title}</p>
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 tabular-nums">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-gray-400">{entry.name}</span>
          <span className="ml-auto font-medium">
            {f.money(String(entry.value ?? 0), currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

const AXIS_TICK = { fontSize: 11 };

/** Compact numeric axis ticks in the active locale (currency shown in tooltip). */
function useMoneyAxisFormatter() {
  const f = useFormat();
  return (v: number) => f.number(v, { notation: 'compact', maximumFractionDigits: 1 });
}

/**
 * Shared `<Legend>` props that tag every entry with the chart's currency, so the
 * money unit is explicit on the chart itself (not only in the hover tooltip).
 */
function currencyLegendProps(theme: ReturnType<typeof useChartTheme>, currency: string) {
  return {
    iconType: 'circle' as const,
    iconSize: 8,
    wrapperStyle: { fontSize: 12, color: theme.axis },
    formatter: (value: unknown) => `${String(value)} (${currency})`,
  };
}

// ── Cashflow: income vs expense per period ───────────────────────────────────
export function CashflowChart({
  points,
  currency,
}: {
  points: StatsPoint[];
  currency: string;
}) {
  const theme = useChartTheme();
  const f = useFormat();
  const axisFmt = useMoneyAxisFormatter();
  const data = points.map((p) => ({
    label: p.label || f.monthKey(p.key, MONTH_AXIS_OPTS),
    fullLabel: p.label || f.monthKey(p.key, MONTH_AXIS_OPTS),
    income: toNumber(p.income),
    expense: toNumber(p.expense),
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barGap={4} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} stroke={theme.grid} />
        <XAxis dataKey="label" tick={AXIS_TICK} stroke={theme.axis} tickLine={false} />
        <YAxis
          tick={AXIS_TICK}
          stroke={theme.axis}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={axisFmt}
        />
        <Tooltip
          cursor={{ fill: theme.grid, opacity: 0.4 }}
          content={(p) => (
            <MoneyTooltip
              active={p.active}
              payload={p.payload as unknown as TooltipEntry[]}
              label={p.label as string | undefined}
              currency={currency}
              theme={theme}
            />
          )}
        />
        <Legend {...currencyLegendProps(theme, currency)} />
        <Bar
          dataKey="income"
          name={personalTxTypeLabel('income')}
          fill={theme.income}
          radius={[3, 3, 0, 0]}
        />
        <Bar
          dataKey="expense"
          name={personalTxTypeLabel('expense')}
          fill={theme.expense}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Income timeline: when was I paid ─────────────────────────────────────────
export function IncomeTimelineChart({
  points,
  currency,
}: {
  points: StatsPoint[];
  currency: string;
}) {
  const theme = useChartTheme();
  const f = useFormat();
  const axisFmt = useMoneyAxisFormatter();
  const data = points.map((p) => ({
    label: p.label || f.monthKey(p.key, MONTH_AXIS_OPTS),
    fullLabel: p.label || f.monthKey(p.key, MONTH_AXIS_OPTS),
    income: toNumber(p.income ?? p.total),
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} stroke={theme.grid} />
        <XAxis dataKey="label" tick={AXIS_TICK} stroke={theme.axis} tickLine={false} />
        <YAxis
          tick={AXIS_TICK}
          stroke={theme.axis}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={axisFmt}
        />
        <Tooltip
          cursor={{ fill: theme.grid, opacity: 0.4 }}
          content={(p) => (
            <MoneyTooltip
              active={p.active}
              payload={p.payload as unknown as TooltipEntry[]}
              label={p.label as string | undefined}
              currency={currency}
              theme={theme}
            />
          )}
        />
        <Legend {...currencyLegendProps(theme, currency)} />
        <Bar
          dataKey="income"
          name={personalTxTypeLabel('income')}
          fill={theme.income}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Categorical breakdown (by category / by account) ─────────────────────────
export function BreakdownChart({
  points,
  currency,
}: {
  points: StatsPoint[];
  currency: string;
}) {
  const theme = useChartTheme();
  const { t } = useT();
  const axisFmt = useMoneyAxisFormatter();
  const data = points
    .map((p) => ({
      label: p.label || p.key,
      fullLabel: p.label || p.key,
      total: Math.abs(toNumber(p.total ?? p.expense ?? p.income)),
    }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  const height = Math.max(180, data.length * 40 + 24);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid horizontal={false} stroke={theme.grid} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          stroke={theme.axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={axisFmt}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={AXIS_TICK}
          stroke={theme.axis}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip
          cursor={{ fill: theme.grid, opacity: 0.4 }}
          content={(p) => (
            <MoneyTooltip
              active={p.active}
              payload={p.payload as unknown as TooltipEntry[]}
              label={p.label as string | undefined}
              currency={currency}
              theme={theme}
            />
          )}
        />
        <Legend {...currencyLegendProps(theme, currency)} />
        <Bar dataKey="total" name={t('stats.spending')} radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={QUALITATIVE[i % QUALITATIVE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Category donut (spending or income share per category) ───────────────────
export function CategoryPieChart({
  points,
  currency,
  metric,
}: {
  points: StatsPoint[];
  currency: string;
  /** Which side of each category bucket to chart: expense (spending) or income. */
  metric: 'income' | 'expense';
}) {
  const theme = useChartTheme();
  const data = points
    .map((p) => ({
      label: p.label || p.key,
      fullLabel: p.label || p.key,
      value: Math.abs(toNumber(metric === 'income' ? p.income : p.expense)),
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  // Nothing to plot for this metric (e.g. income pie with no categorized income).
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={100}
          paddingAngle={data.length > 1 ? 1.5 : 0}
          stroke={theme.tooltipBg}
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={QUALITATIVE[i % QUALITATIVE.length]} />
          ))}
        </Pie>
        <Legend {...currencyLegendProps(theme, currency)} />
        <Tooltip
          content={(p) => (
            <MoneyTooltip
              active={p.active}
              payload={p.payload as unknown as TooltipEntry[]}
              currency={currency}
              theme={theme}
            />
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Net-worth trend (derived from cashflow, anchored to current total) ───────
export function NetWorthTrendChart({
  cashflow,
  currentTotal,
  currency,
}: {
  cashflow: StatsPoint[];
  currentTotal: string;
  currency: string;
}) {
  const theme = useChartTheme();
  const { t } = useT();
  const f = useFormat();
  const axisFmt = useMoneyAxisFormatter();

  // Cumulative net (income − expense), then shift so the final point equals the
  // current net worth. This is an estimated trend from recorded flows (§3.4:
  // net worth itself uses the latest rate; historical points are approximate).
  let acc = new Decimal(0);
  const cumulative = cashflow.map((p) => {
    acc = acc.plus(new Decimal(toNumber(p.income)).minus(toNumber(p.expense)));
    return { key: p.key, label: p.label || f.monthKey(p.key, MONTH_AXIS_OPTS), value: acc };
  });
  const last = cumulative.length ? cumulative[cumulative.length - 1].value : new Decimal(0);
  const offset = new Decimal(currentTotal || '0').minus(last);
  const data = cumulative.map((c) => ({
    label: c.label,
    fullLabel: c.label,
    worth: c.value.plus(offset).toNumber(),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={0.28} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={theme.grid} />
        <XAxis dataKey="label" tick={AXIS_TICK} stroke={theme.axis} tickLine={false} />
        <YAxis
          tick={AXIS_TICK}
          stroke={theme.axis}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={axisFmt}
        />
        <Tooltip
          cursor={{ stroke: theme.grid }}
          content={(p) => (
            <MoneyTooltip
              active={p.active}
              payload={p.payload as unknown as TooltipEntry[]}
              label={p.label as string | undefined}
              currency={currency}
              theme={theme}
            />
          )}
        />
        <Legend {...currencyLegendProps(theme, currency)} />
        <Area
          type="monotone"
          dataKey="worth"
          name={t('money.netWorth')}
          stroke={theme.accent}
          strokeWidth={2}
          fill="url(#nw-fill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
