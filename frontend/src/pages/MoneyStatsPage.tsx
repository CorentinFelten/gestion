import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { accountTypeLabel, useT } from '@/i18n';
import { useStats } from '@/hooks/usePersonalStats';
import { useAccounts } from '@/hooks/useAccounts';
import { useCaptureSnapshot, useNetWorth, useNetWorthHistory } from '@/hooks/useNetWorth';
import {
  BreakdownChart,
  CashflowChart,
  CategoryPieChart,
  IncomeTimelineChart,
  NetWorthHistoryChart,
} from '@/components/money/charts';
import {
  Card,
  EmptyBlock,
  ErrorBlock,
  errorMessage,
  LoadingBlock,
  PageHeader,
  SectionTitle,
  Segmented,
} from '@/components/money/ui';
import type { StatsPeriod, StatsResponse } from '@/types';

export default function MoneyStatsPage() {
  const { user } = useAuth();
  const { t } = useT();
  const profileCurrency = user?.preferredCurrency ?? 'EUR';

  const [period, setPeriod] = useState<StatsPeriod>('month');

  const cashflow = useStats('cashflow', period);
  const byCategory = useStats('by-category', period);
  const byAccount = useStats('by-account', period);
  const incomeTimeline = useStats('income-timeline', period);
  const netWorth = useNetWorth();
  const accounts = useAccounts();

  const currency = netWorth.data?.profileCurrency ?? profileCurrency;

  // The by-account view keys each point by accountId; enrich its label with the
  // account type (e.g. «Compte courant») so two accounts sharing a name stay
  // distinguishable in the chart.
  const accountTypeById = useMemo(() => {
    const m = new Map<string, string>();
    accounts.data?.forEach((a) => m.set(a.id, accountTypeLabel(a.type)));
    return m;
  }, [accounts.data]);

  const withAccountType = (points: StatsResponse['points']) =>
    points.map((p) => {
      const type = accountTypeById.get(p.key);
      return type ? { ...p, label: `${p.label} · ${type}` } : p;
    });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t('money.eyebrow')}
        title={t('stats.title')}
        subtitle={t('stats.subtitle')}
        actions={
          <Segmented
            ariaLabel={t('stats.period')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'month', label: t('stats.monthly') },
              { value: 'year', label: t('stats.yearly') },
            ]}
          />
        }
      />

      <div className="space-y-8">
        <ChartSection
          title={`${t('stats.cashflow')} · ${t('stats.incomeVsExpense')}`}
          query={cashflow}
          isEmpty={(d) => d.points.length === 0}
        >
          {(d) => <CashflowChart points={d.points} currency={currency} />}
        </ChartSection>

        <NetWorthHistorySection currency={currency} />

        <div className="grid gap-8 lg:grid-cols-2">
          <ChartSection
            title={t('stats.spendingByCategory')}
            query={byCategory}
            isEmpty={(d) => d.points.every((p) => Number(p.expense ?? 0) <= 0)}
          >
            {(d) => <CategoryPieChart points={d.points} currency={currency} metric="expense" />}
          </ChartSection>

          <ChartSection
            title={t('stats.incomeByCategory')}
            query={byCategory}
            isEmpty={(d) => d.points.every((p) => Number(p.income ?? 0) <= 0)}
          >
            {(d) => <CategoryPieChart points={d.points} currency={currency} metric="income" />}
          </ChartSection>
        </div>

        <ChartSection
          title={t('stats.spendingByAccount')}
          query={byAccount}
          isEmpty={(d) => d.points.every((p) => Number(p.expense ?? 0) <= 0)}
        >
          {/* The by-account view's `total` is net flow (income − expense); this
              chart is titled spending, so plot the expense side explicitly. */}
          {(d) => (
            <BreakdownChart
              points={withAccountType(d.points).map((p) => ({ ...p, total: p.expense ?? '0' }))}
              currency={currency}
            />
          )}
        </ChartSection>

        <ChartSection
          title={`${t('stats.incomeTimeline')} · ${t('stats.whenPaid')}`}
          query={incomeTimeline}
          isEmpty={(d) => d.points.length === 0}
        >
          {(d) => <IncomeTimelineChart points={d.points} currency={currency} />}
        </ChartSection>
      </div>
    </div>
  );
}

/**
 * Real patrimoine-net trend from captured daily snapshots. On mount we POST one
 * snapshot (idempotent, one row/day) so a fresh user always sees at least
 * today's point rather than an empty chart.
 */
function NetWorthHistorySection({ currency }: { currency: string }) {
  const { t } = useT();
  const history = useNetWorthHistory(365);
  const snapshot = useCaptureSnapshot();
  const captured = useRef(false);

  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    snapshot.mutate();
    // Fire exactly once on mount; the mutation invalidates the history query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const points = history.data?.points ?? [];
  const chartCurrency = history.data?.profileCurrency ?? currency;

  return (
    <section>
      <SectionTitle>{t('stats.netWorthTrend')}</SectionTitle>
      <Card className="p-5">
        {history.isLoading ? (
          <LoadingBlock label={t('stats.loading')} />
        ) : history.isError ? (
          <ErrorBlock
            message={errorMessage(history.error)}
            onRetry={() => void history.refetch()}
          />
        ) : points.length > 0 ? (
          <>
            <NetWorthHistoryChart points={points} currency={chartCurrency} />
            <p className="mt-3 text-xs text-gray-400">{t('stats.netWorthHistoryNote')}</p>
          </>
        ) : (
          <EmptyBlock
            icon="◇"
            title={t('stats.netWorthHistoryEmptyTitle')}
            message={t('stats.netWorthHistoryEmptyMessage')}
          />
        )}
      </Card>
    </section>
  );
}

function ChartSection({
  title,
  query,
  isEmpty,
  note,
  children,
}: {
  title: string;
  query: UseQueryResult<StatsResponse>;
  isEmpty: (data: StatsResponse) => boolean;
  note?: string;
  children: (data: StatsResponse) => ReactNode;
}) {
  const { t } = useT();
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <Card className="p-5">
        {query.isLoading ? (
          <LoadingBlock label={t('stats.loading')} />
        ) : query.isError ? (
          <ErrorBlock message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data && !isEmpty(query.data) ? (
          <>
            {children(query.data)}
            {note ? <p className="mt-3 text-xs text-gray-400">{note}</p> : null}
          </>
        ) : (
          <EmptyBlock
            icon="◇"
            title={t('stats.emptyTitle')}
            message={t('stats.emptyMessage')}
          />
        )}
      </Card>
    </section>
  );
}
