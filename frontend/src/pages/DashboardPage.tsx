import { useMemo, useState, type FormEvent } from 'react';
import Decimal from 'decimal.js';
import { Link } from 'react-router-dom';
import { BarChart, Bar, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { useAuth } from '@/context/AuthContext';
import {
  useRequireAuth,
  useHousehold,
  useCreateHousehold,
  useMembers,
  useCategories,
  useMemberMap,
} from '@/hooks/useHousehold';
import { ReceivedInvitesList } from '@/components/household/ReceivedInvites';
import { useReceivedInvites } from '@/hooks/useInvites';
import { useTally } from '@/hooks/useTally';
import { useTransactions } from '@/hooks/useTransactions';
import {
  Avatar,
  Banner,
  Button,
  Card,
  CHART_COLORS,
  CurrencyBadge,
  Eyebrow,
  Field,
  Input,
  Money,
  PageHeader,
  Select,
  StateBlock,
  TallyStrip,
} from '@/components/household/ui';
import { isoToday, toNumber } from '@/components/household/format';
import { useT, useFormat, categoryLabel } from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';

function monthStart(): string {
  // Local first-of-month; built from local components (not toISOString, which is
  // UTC and can roll into the previous month in negative-offset locales).
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}-01`;
}

export default function DashboardPage() {
  const { t } = useT();
  const f = useFormat();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const household = useHousehold();
  const householdId = household.data?.id;
  const base = household.data?.baseCurrency ?? user?.preferredCurrency ?? 'EUR';

  const members = useMembers(householdId);
  const memberMap = useMemberMap(members.data);
  const categories = useCategories(householdId);
  const tally = useTally(householdId, { me: true });
  const recent = useTransactions(householdId, {});
  const monthly = useTransactions(householdId, { from: monthStart(), to: isoToday() });

  const catName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories.data ?? []) map[c.id] = categoryLabel(c.name);
    return map;
  }, [categories.data]);
  const uncategorisedLabel = t('common.uncategorised');

  // Pairwise positions vs each member (from the tally cells, netted per person).
  const positions = useMemo(() => {
    const by: Record<string, { name: string; net: number }> = {};
    for (const cell of tally.data?.cells ?? []) {
      const cur = by[cell.otherUserId] ?? { name: cell.otherUserName, net: 0 };
      cur.net += toNumber(cell.net);
      by[cell.otherUserId] = cur;
    }
    return Object.entries(by)
      .map(([userId, v]) => ({ userId, ...v }))
      .filter((p) => Math.abs(p.net) >= 0.005)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [tally.data]);

  const overall = toNumber(tally.data?.overall);
  const owed = positions
    .filter((p) => p.net > 0)
    .reduce((sum, p) => sum.plus(p.net), new Decimal(0))
    .toString();
  const owe = positions
    .filter((p) => p.net < 0)
    .reduce((sum, p) => sum.minus(p.net), new Decimal(0))
    .toString();
  const maxPos = Math.max(0.01, ...positions.map((p) => Math.abs(p.net)));

  const monthByCategory = useMemo(() => {
    const by: Record<string, Decimal> = {};
    for (const tx of monthly.data ?? []) {
      const key = tx.categoryId ? catName[tx.categoryId] ?? uncategorisedLabel : uncategorisedLabel;
      by[key] = (by[key] ?? new Decimal(0)).plus(tx.amountBase);
    }
    return Object.entries(by)
      .map(([label, value]) => ({ label, value: value.toNumber() }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [monthly.data, catName, uncategorisedLabel]);
  const monthTotal = monthByCategory
    .reduce((sum, r) => sum.plus(r.value), new Decimal(0))
    .toString();

  if (!ready || household.isLoading) {
    return <StateBlock state="loading" />;
  }
  if (household.isError) {
    return <StateBlock state="error" message={t('dashboard.loadError')} />;
  }
  if (!household.data) {
    return <HouseholdOnboarding defaultCurrency={user?.preferredCurrency ?? 'EUR'} />;
  }

  const firstName = user?.displayName?.split(' ')[0];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={household.data.name}
        title={firstName ? t('dashboard.greeting', { name: firstName }) : t('dashboard.greetingNoName')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <Link to="/transactions">
            <Button variant="primary">{t('transactions.addTransaction')}</Button>
          </Link>
        }
      />

      {/* Net balance hero */}
      <Card className="mb-6 overflow-hidden">
        <div className="grid gap-px bg-gray-100 dark:bg-gray-800 sm:grid-cols-3">
          <div className="bg-white p-6 dark:bg-[#141A24] sm:col-span-1">
            <Eyebrow>{t('dashboard.netBalance')}</Eyebrow>
            <p className="mt-2 text-3xl font-extrabold tracking-tight">
              <Money
                value={overall}
                currency={base}
                signDisplay="exceptZero"
                tone={overall > 0 ? 'credit' : overall < 0 ? 'debit' : 'neutral'}
              />
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {overall > 0
                ? t('dashboard.owedOverall')
                : overall < 0
                  ? t('dashboard.oweOverall')
                  : t('dashboard.allSettled')}
            </p>
          </div>
          <div className="bg-white p-6 dark:bg-[#141A24]">
            <Eyebrow>{t('dashboard.youAreOwed')}</Eyebrow>
            <p className="mt-2 text-2xl font-bold">
              <Money value={owed} currency={base} tone="credit" />
            </p>
          </div>
          <div className="bg-white p-6 dark:bg-[#141A24]">
            <Eyebrow>{t('dashboard.youOwe')}</Eyebrow>
            <p className="mt-2 text-2xl font-bold">
              <Money value={owe} currency={base} tone="debit" />
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Positions vs members */}
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between px-5 py-4">
            <Eyebrow>{t('dashboard.whoOwesWhom')}</Eyebrow>
            <Link to="/settle-up" className="text-xs font-semibold text-teal-600 hover:text-teal-700">
              {t('nav.settleUp')} →
            </Link>
          </div>
          <div className="border-t border-gray-100 dark:border-gray-800">
            {tally.isLoading ? (
              <StateBlock state="loading" />
            ) : tally.isError ? (
              <StateBlock state="error" />
            ) : positions.length === 0 ? (
              <StateBlock state="empty" title={t('dashboard.allSquare')} message={t('dashboard.noOutstanding')} />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {positions.map((p) => (
                  <li key={p.userId} className="flex items-center gap-4 px-5 py-3.5">
                    <Avatar name={p.name} id={p.userId} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <div className="mt-1.5">
                        <TallyStrip net={p.net} max={maxPos} />
                      </div>
                    </div>
                    <div className="text-right">
                      <Money
                        value={Math.abs(p.net)}
                        currency={base}
                        tone={p.net > 0 ? 'credit' : 'debit'}
                        className="text-sm font-semibold"
                      />
                      <p className="text-[0.7rem] text-gray-400">
                        {p.net > 0 ? t('dashboard.owesYou') : t('dashboard.youOweThem')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Spend this month */}
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between px-5 py-4">
            <Eyebrow>{t('dashboard.spendThisMonth')}</Eyebrow>
            <span className="font-mono text-sm font-semibold tnum">
              {f.money(monthTotal, base)}
            </span>
          </div>
          <div className="border-t border-gray-100 px-2 pb-4 pt-4 dark:border-gray-800">
            {monthly.isLoading ? (
              <StateBlock state="loading" />
            ) : monthByCategory.length === 0 ? (
              <StateBlock state="empty" title={t('dashboard.nothingYet')} message={t('dashboard.noSpendThisMonth')} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthByCategory} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    className="text-gray-400"
                    interval={0}
                    tickFormatter={(l: string) => (l.length > 6 ? `${l.slice(0, 6)}…` : l)}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(13,148,136,0.08)' }}
                    formatter={(v) => f.money(v as number, base)}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid rgba(148,163,184,0.3)',
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {monthByCategory.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Recent transactions */}
      <Card className="mt-6">
        <div className="flex items-center justify-between px-5 py-4">
          <Eyebrow>{t('dashboard.recentActivity')}</Eyebrow>
          <Link to="/transactions" className="text-xs font-semibold text-teal-600 hover:text-teal-700">
            {t('common.viewAll')} →
          </Link>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800">
          {recent.isLoading ? (
            <StateBlock state="loading" />
          ) : recent.isError ? (
            <StateBlock state="error" />
          ) : (recent.data?.length ?? 0) === 0 ? (
            <StateBlock
              state="empty"
              title={t('transactions.emptyTitle')}
              message={t('transactions.emptyGetStarted')}
            />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {(recent.data ?? []).slice(0, 6).map((tx) => (
                <li key={tx.id} className="flex items-center gap-4 px-5 py-3">
                  <Avatar
                    name={memberMap[tx.payerUserId]?.displayName ?? '?'}
                    id={tx.payerUserId}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tx.description}</p>
                    <p className="text-xs text-gray-400">
                      {memberMap[tx.payerUserId]?.displayName ?? t('common.someone')} ·{' '}
                      {f.date(tx.paymentDate)}
                      {tx.categoryId && catName[tx.categoryId] ? ` · ${catName[tx.categoryId]}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money value={tx.amountBase} currency={base} className="text-sm font-semibold" />
                    {tx.currencyOriginal !== base ? (
                      <p className="text-[0.7rem] text-gray-400">
                        {f.money(tx.amountOriginal, tx.currencyOriginal)}{' '}
                        <CurrencyBadge code={tx.currencyOriginal} />
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {members.isError ? (
        <div className="mt-4">
          <Banner tone="warn">{t('dashboard.memberRosterError')}</Banner>
        </div>
      ) : null}
    </div>
  );
}

/**
 * First-run onboarding shown when the signed-in user has no household yet.
 * They can create a new household, or accept a pending in-app invitation someone
 * sent them. The private "Mon argent" section works without a household too.
 */
function HouseholdOnboarding({ defaultCurrency }: { defaultCurrency: string }) {
  const { t } = useT();
  const create = useCreateHousehold();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const { options: currencyOptions } = usePinnedCurrencyOptions();

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || create.isPending) return;
    create.mutate({ name: name.trim(), baseCurrency: currency });
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader eyebrow={t('dashboard.welcome')} title={t('dashboard.createTitle')} />

      {/* Any pending invitations addressed to this user (hidden when none). */}
      <PendingInvitesCard />

      <Card className="p-6">
        <form onSubmit={submitCreate} className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.createSubtitle')}</p>
          <Field label={t('dashboard.householdName')} htmlFor="hh-name">
            <Input
              id="hh-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dashboard.householdNamePlaceholder')}
              maxLength={120}
              autoFocus
            />
          </Field>
          <Field label={t('dashboard.baseCurrency')} htmlFor="hh-cur" hint={t('dashboard.baseCurrencyHint')}>
            <Select id="hh-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencyOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {create.isError ? <Banner tone="warn">{t('dashboard.createError')}</Banner> : null}
          <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
            {create.isPending ? t('common.loading') : t('dashboard.createButton')}
          </Button>
        </form>

        <p className="mt-5 border-t border-gray-100 pt-4 text-xs text-gray-400 dark:border-gray-800">
          {t('dashboard.createPersonalHint')}
        </p>
      </Card>
    </div>
  );
}

/** Received invitations shown during onboarding; renders nothing when there are none. */
function PendingInvitesCard() {
  const { t } = useT();
  const received = useReceivedInvites();
  if ((received.data?.length ?? 0) === 0) return null;
  return (
    <Card className="p-6">
      <Eyebrow>{t('dashboard.pendingInvites')}</Eyebrow>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {t('dashboard.pendingInvitesHint')}
      </p>
      <div className="mt-4">
        <ReceivedInvitesList hideWhenEmpty />
      </div>
    </Card>
  );
}
