import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRequireAuth, useHousehold, useMembers } from '@/hooks/useHousehold';
import { useTally } from '@/hooks/useTally';
import {
  Avatar,
  Button,
  Card,
  Eyebrow,
  Money,
  PageHeader,
  Segmented,
  StateBlock,
  TallyStrip,
} from '@/components/household/ui';
import { toNumber } from '@/components/household/format';
import { useT, categoryLabel } from '@/i18n';
import type { TallyCell } from '@/types';

type View = 'list' | 'matrix';

export default function TallyPage() {
  const { t } = useT();
  const { ready } = useRequireAuth();
  const household = useHousehold();
  const householdId = household.data?.id;
  const base = household.data?.baseCurrency ?? 'EUR';
  useMembers(householdId);
  const tally = useTally(householdId, { me: true });
  const [view, setView] = useState<View>('list');

  // Group the subject's cells by category.
  const grouped = useMemo(() => {
    const byCat = new Map<string, { name: string; cells: TallyCell[]; total: number }>();
    for (const cell of tally.data?.cells ?? []) {
      const key = cell.categoryId ?? '∅';
      const g = byCat.get(key) ?? { name: cell.categoryName, cells: [], total: 0 };
      g.cells.push(cell);
      g.total += toNumber(cell.net);
      byCat.set(key, g);
    }
    return Array.from(byCat.entries()).map(([id, g]) => ({ id, ...g }));
  }, [tally.data]);

  const otherMembers = useMemo(() => {
    const map = new Map<string, string>();
    for (const cell of tally.data?.cells ?? []) map.set(cell.otherUserId, cell.otherUserName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tally.data]);

  const maxCell = Math.max(0.01, ...(tally.data?.cells ?? []).map((c) => Math.abs(toNumber(c.net))));
  const overall = toNumber(tally.data?.overall);
  const showMatrix = otherMembers.length > 1;

  if (!ready || household.isLoading) return <StateBlock state="loading" />;
  if (!household.data) return <StateBlock state="empty" title={t('common.noHousehold')} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={household.data.name}
        title={t('tally.boardTitle')}
        subtitle={t('tally.subtitle')}
        actions={
          showMatrix ? (
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: t('tally.byCategory') },
                { value: 'matrix', label: t('tally.matrix') },
              ]}
            />
          ) : (
            <Link to="/settle-up">
              <Button variant="primary">{t('nav.settleUp')}</Button>
            </Link>
          )
        }
      />

      {/* Overall */}
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <Eyebrow>{t('tally.overallPosition')}</Eyebrow>
          <p className="mt-1 text-3xl font-extrabold tracking-tight">
            <Money
              value={overall}
              currency={base}
              signDisplay="exceptZero"
              tone={overall > 0 ? 'credit' : overall < 0 ? 'debit' : 'neutral'}
            />
          </p>
        </div>
        <p className="max-w-[16rem] text-sm text-gray-500">
          {overall > 0
            ? t('tally.overallCredit')
            : overall < 0
              ? t('tally.overallDebit')
              : t('tally.overallSettled')}
        </p>
      </Card>

      {tally.isLoading ? (
        <Card>
          <StateBlock state="loading" />
        </Card>
      ) : tally.isError ? (
        <Card>
          <StateBlock state="error" message={t('tally.loadError')} />
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <StateBlock
            state="empty"
            title={t('tally.emptyTitle')}
            message={t('tally.emptyMessage')}
          />
        </Card>
      ) : view === 'matrix' && showMatrix ? (
        <MatrixView grouped={grouped} others={otherMembers} base={base} />
      ) : (
        <div className="space-y-5">
          {grouped.map((g) => (
            <Card key={g.id}>
              <div className="flex items-center justify-between px-5 py-3">
                <Eyebrow>{categoryLabel(g.name)}</Eyebrow>
                <Money
                  value={g.total}
                  currency={base}
                  signDisplay="exceptZero"
                  tone={g.total > 0 ? 'credit' : g.total < 0 ? 'debit' : 'muted'}
                  className="text-sm font-semibold"
                />
              </div>
              <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                {g.cells.map((cell) => {
                  const net = toNumber(cell.net);
                  return (
                    <li key={cell.otherUserId} className="flex items-center gap-4 px-5 py-3">
                      <Avatar name={cell.otherUserName} id={cell.otherUserId} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{cell.otherUserName}</p>
                        <div className="mt-1.5">
                          <TallyStrip net={net} max={maxCell} />
                        </div>
                      </div>
                      <div className="text-right">
                        <Money
                          value={Math.abs(net)}
                          currency={base}
                          tone={net > 0 ? 'credit' : net < 0 ? 'debit' : 'muted'}
                          className="text-sm font-semibold"
                        />
                        <p className="text-[0.7rem] text-gray-400">
                          {net > 0 ? t('tally.owesYou') : net < 0 ? t('tally.youOwe') : t('tally.settledShort')}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function MatrixView({
  grouped,
  others,
  base,
}: {
  grouped: { id: string; name: string; cells: TallyCell[]; total: number }[];
  others: { id: string; name: string }[];
  base: string;
}) {
  const { t } = useT();
  return (
    <Card className="overflow-hidden">
      <p className="px-4 pt-3 text-xs text-gray-400 sm:hidden">{t('tally.matrix')} →</p>
      <div className="scroll-touch overflow-x-auto">
        <table className="w-full min-w-xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left dark:bg-[#141A24]">
                <span className="eyebrow">{t('common.category')}</span>
              </th>
              {others.map((o) => (
                <th key={o.id} className="px-4 py-3 text-right">
                  <span className="eyebrow">{o.name}</span>
                </th>
              ))}
              <th className="px-4 py-3 text-right">
                <span className="eyebrow">{t('common.total')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => {
              const cellFor = (uid: string) =>
                toNumber(g.cells.find((c) => c.otherUserId === uid)?.net ?? 0);
              return (
                <tr key={g.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 font-medium dark:bg-[#141A24]">
                    {categoryLabel(g.name)}
                  </td>
                  {others.map((o) => {
                    const net = cellFor(o.id);
                    return (
                      <td key={o.id} className="px-4 py-3 text-right">
                        <Money
                          value={net}
                          currency={base}
                          signDisplay="exceptZero"
                          tone={net > 0 ? 'credit' : net < 0 ? 'debit' : 'muted'}
                          className="text-sm"
                        />
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right">
                    <Money
                      value={g.total}
                      currency={base}
                      signDisplay="exceptZero"
                      tone={g.total > 0 ? 'credit' : g.total < 0 ? 'debit' : 'muted'}
                      className="text-sm font-semibold"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
