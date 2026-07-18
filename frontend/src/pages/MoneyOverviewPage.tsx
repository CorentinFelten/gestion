import { Link } from 'react-router-dom';
import Decimal from 'decimal.js';
import { useAuth } from '@/context/AuthContext';
import { useFormat, useT } from '@/i18n';
import { useNetWorth } from '@/hooks/useNetWorth';
import { useStatsSummary } from '@/hooks/usePersonalStats';
import { NetWorthStatement } from '@/components/money/NetWorthStatement';
import { MonthTransactions } from '@/components/money/MonthTransactions';
import { MoneyAmount } from '@/components/money/MoneyAmount';
import { useMoneyTxModal } from '@/components/money/MoneyTxModal';
import {
  Button,
  Card,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionTitle,
  Spinner,
  tabular,
  errorMessage,
} from '@/components/money/ui';

export default function MoneyOverviewPage() {
  const { user } = useAuth();
  const { t } = useT();
  const f = useFormat();
  const txModal = useMoneyTxModal();
  const profileCurrency = user?.preferredCurrency ?? 'EUR';

  const netWorth = useNetWorth();
  const summary = useStatsSummary();

  const savingsRate = (() => {
    const raw = summary.data?.savingsRate;
    if (raw === null || raw === undefined || raw === '') return '-';
    const n = Number(raw);
    if (Number.isNaN(n)) return '-';
    // Backend may send a ratio (0–1) or an already-scaled percent (0–100).
    return f.percent(n, { alreadyPercent: Math.abs(n) > 1, fractionDigits: 0 });
  })();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t('money.eyebrow')}
        title={t('money.overviewTitle')}
        subtitle={t('money.overviewSubtitle')}
        actions={
          <>
            <Link to="/money/accounts">
              <Button variant="outline">{t('accounts.title')}</Button>
            </Link>
            <Button variant="primary" onClick={() => txModal.open()}>
              + {t('nav.addTransaction')}
            </Button>
          </>
        }
      />

      {/* Net worth, the signature statement */}
      {netWorth.isLoading ? (
        <LoadingBlock label={t('money.netWorthLoading')} />
      ) : netWorth.isError ? (
        <ErrorBlock
          title={t('money.netWorthError')}
          message={errorMessage(netWorth.error)}
          onRetry={() => void netWorth.refetch()}
        />
      ) : netWorth.data && netWorth.data.accounts.length === 0 ? (
        <EmptyBlock
          icon="🏦"
          title={t('money.emptyAccountsTitle')}
          message={t('money.emptyAccountsMessage')}
          action={
            <Link to="/money/accounts">
              <Button variant="primary">{t('accounts.createAccount')}</Button>
            </Link>
          }
        />
      ) : netWorth.data ? (
        <NetWorthStatement data={netWorth.data} />
      ) : null}

      {/* This month */}
      <div className="mt-8">
        <SectionTitle
          aside={
            <Link
              to="/money/stats"
              className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              {t('money.viewStatistics')} →
            </Link>
          }
        >
          {t('money.thisMonth')} · {summary.data?.month ?? ''}
        </SectionTitle>

        {summary.isLoading ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-gray-200 py-10 text-sm text-gray-500 dark:border-gray-800">
            <Spinner /> {t('money.thisMonthLoading')}
          </div>
        ) : summary.isError ? (
          <ErrorBlock
            title={t('money.summaryError')}
            message={errorMessage(summary.error)}
            onRetry={() => void summary.refetch()}
          />
        ) : summary.data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile label={t('money.income')}>
              <MoneyAmount
                value={summary.data.income}
                currency={summary.data.profileCurrency}
                size="xl"
                flow="income"
              />
            </SummaryTile>
            <SummaryTile label={t('money.spending')}>
              <MoneyAmount
                value={summary.data.spending}
                currency={summary.data.profileCurrency}
                size="xl"
                flow="expense"
              />
            </SummaryTile>
            <SummaryTile label={t('money.netThisMonth')}>
              <MoneyAmount
                value={new Decimal(summary.data.income || 0)
                  .minus(summary.data.spending || 0)
                  .toString()}
                currency={summary.data.profileCurrency}
                size="xl"
                signed
              />
            </SummaryTile>
            <SummaryTile label={t('money.savingsRate')}>
              <span className={tabular('text-3xl font-semibold text-gray-900 dark:text-white')}>
                {savingsRate}
              </span>
            </SummaryTile>
          </div>
        ) : (
          <EmptyBlock
            icon="◇"
            title={t('money.noActivityTitle')}
            message={t('money.noActivityMessage')}
            action={
              <Button variant="primary" onClick={() => txModal.open()}>
                {t('nav.addTransaction')}
              </Button>
            }
          />
        )}
        {summary.data ? (
          <p className="mt-3 text-xs text-gray-400">
            {t('money.figuresNote', { currency: profileCurrency })}
          </p>
        ) : null}
      </div>

      {/* Current-month transactions, scrollable overview across all accounts */}
      <div className="mt-8">
        <SectionTitle
          aside={
            <Link
              to="/money/transactions"
              className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              {t('money.viewAllTransactions')} →
            </Link>
          }
        >
          {t('money.monthTxTitle')}
        </SectionTitle>
        <MonthTransactions />
      </div>
    </div>
  );
}

function SummaryTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-2">{children}</div>
    </Card>
  );
}
