import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useRequireAuth, useHousehold, useMembers, useMemberMap } from '@/hooks/useHousehold';
import { useReport } from '@/hooks/useReports';
import {
  Card,
  CHART_COLORS,
  Eyebrow,
  PageHeader,
  Segmented,
  StateBlock,
} from '@/components/household/ui';
import { useT, useFormat, categoryLabel } from '@/i18n';
import type { ReportGroup } from '@/types';

export default function ReportsPage() {
  const { t, plural } = useT();
  const f = useFormat();
  const { ready } = useRequireAuth();
  const household = useHousehold();
  const householdId = household.data?.id;
  const base = household.data?.baseCurrency ?? 'EUR';
  const members = useMembers(householdId);
  const memberMap = useMemberMap(members.data);

  const GROUPS: { value: ReportGroup; label: string }[] = [
    { value: 'category', label: t('reports.groupCategory') },
    { value: 'member', label: t('reports.groupMember') },
    { value: 'month', label: t('reports.groupMonth') },
    { value: 'currency', label: t('reports.groupCurrency') },
  ];

  const [group, setGroup] = useState<ReportGroup>('category');
  const report = useReport(householdId, group);

  const rows = useMemo(() => {
    const raw = report.data?.rows ?? [];
    return raw
      .map((r) => ({
        key: r.key,
        label:
          group === 'member'
            ? memberMap[r.key]?.displayName ?? r.label
            : group === 'month'
              ? f.monthKey(r.key)
              : group === 'category'
                ? categoryLabel(r.label)
                : r.label,
        value: Number(r.totalBase),
        count: r.count,
      }))
      .sort((a, b) =>
        group === 'month' ? a.key.localeCompare(b.key) : b.value - a.value,
      );
  }, [report.data, group, memberMap, f]);

  const totalDec = rows.reduce((sum, r) => sum.plus(r.value), new Decimal(0));
  const total = totalDec.toNumber();
  const isTimeSeries = group === 'month';

  const countLabel = plural(rows.length, {
    one: t(
      group === 'month'
        ? 'reports.countMonthOne'
        : group === 'member'
          ? 'reports.countMemberOne'
          : group === 'currency'
            ? 'reports.countCurrencyOne'
            : 'reports.countCategoryOne',
    ),
    other: t(
      group === 'month'
        ? 'reports.countMonthOther'
        : group === 'member'
          ? 'reports.countMemberOther'
          : group === 'currency'
            ? 'reports.countCurrencyOther'
            : 'reports.countCategoryOther',
    ),
  });

  if (!ready || household.isLoading) return <StateBlock state="loading" />;
  if (!household.data) return <StateBlock state="empty" title={t('common.noHousehold')} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={household.data.name}
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={<Segmented value={group} onChange={setGroup} options={GROUPS} />}
      />

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <Eyebrow>{t('reports.totalSpend')}</Eyebrow>
          <p className="mt-1 font-mono text-3xl font-extrabold tracking-tight tnum">
            {f.money(totalDec.toString(), base)}
          </p>
        </div>
        <p className="text-sm text-gray-500">
          {countLabel} · {t('reports.convertedTo', { currency: base })}
        </p>
      </Card>

      {report.isLoading ? (
        <Card>
          <StateBlock state="loading" />
        </Card>
      ) : report.isError ? (
        <Card>
          <StateBlock state="error" message={t('reports.loadError')} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <StateBlock
            state="empty"
            title={t('reports.emptyTitle')}
            message={t('reports.emptyMessage')}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Chart */}
          <Card className="p-5 lg:col-span-3">
            <Eyebrow>{isTimeSeries ? t('reports.overTime') : t('reports.distribution')}</Eyebrow>
            <div className="mt-4">
              {isTimeSeries ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'currentColor' }}
                      className="text-gray-400"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tick={{ fontSize: 11, fill: 'currentColor' }}
                      className="text-gray-400"
                      tickFormatter={(v: number) => f.money(v, base)}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(13,148,136,0.08)' }}
                      formatter={(v: number) => f.money(v, base)}
                      contentStyle={{ borderRadius: 12, border: '1px solid rgba(148,163,184,0.3)', fontSize: 12 }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} fill={CHART_COLORS[0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={rows}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={64}
                      outerRadius={110}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {rows.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, n: string) => [f.money(v, base), n]}
                      contentStyle={{ borderRadius: 12, border: '1px solid rgba(148,163,184,0.3)', fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {/* Table */}
          <Card className="lg:col-span-2">
            <div className="px-5 py-3">
              <Eyebrow>{t('reports.breakdown')}</Eyebrow>
            </div>
            <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
              {rows.map((r, i) => {
                const pct = total > 0 ? (r.value / total) * 100 : 0;
                return (
                  <li key={r.key} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <span className="truncate text-sm font-medium">{r.label}</span>
                      </span>
                      <span className="font-mono text-sm font-semibold tnum">
                        {f.money(r.value, base)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                      </div>
                      <span className="w-9 shrink-0 text-right font-mono text-[0.7rem] tnum text-gray-400">
                        {f.percent(pct, { alreadyPercent: true, fractionDigits: 0 })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
