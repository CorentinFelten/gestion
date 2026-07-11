import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { useAuth } from '@/context/AuthContext';
import {
  useRequireAuth,
  useHousehold,
  useMembers,
  useCurrencies,
  useMemberMap,
} from '@/hooks/useHousehold';
import { useSettleUp } from '@/hooks/useTally';
import {
  SettlementModal,
  type SettlementTarget,
} from '@/components/household/SettlementModal';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Eyebrow,
  Money,
  PageHeader,
  StateBlock,
} from '@/components/household/ui';
import { useT, useFormat, categoryLabel } from '@/i18n';

export default function SettleUpPage() {
  const { t } = useT();
  const f = useFormat();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const household = useHousehold();
  const householdId = household.data?.id;
  const base = household.data?.baseCurrency ?? 'EUR';

  const members = useMembers(householdId);
  const memberMap = useMemberMap(members.data);
  const currencies = useCurrencies();

  const [simplify, setSimplify] = useState(false);
  const settleUp = useSettleUp(householdId, simplify);
  const [target, setTarget] = useState<SettlementTarget | null>(null);

  const nameOf = (id: string) => memberMap[id]?.displayName ?? t('common.member');

  // Group entries by debtor→creditor pair, keeping per-category detail.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        fromUserId: string;
        toUserId: string;
        total: Decimal;
        rows: { categoryId: string | null; categoryName: string; amountBase: string }[];
      }
    >();
    for (const e of settleUp.data?.entries ?? []) {
      const key = `${e.fromUserId}→${e.toUserId}`;
      const g =
        map.get(key) ??
        { fromUserId: e.fromUserId, toUserId: e.toUserId, total: new Decimal(0), rows: [] };
      g.total = g.total.plus(e.amountBase);
      g.rows.push({ categoryId: e.categoryId, categoryName: e.categoryName, amountBase: e.amountBase });
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.total.comparedTo(a.total));
  }, [settleUp.data]);

  if (!ready || household.isLoading) return <StateBlock state="loading" />;
  if (!household.data) return <StateBlock state="empty" title={t('common.noHousehold')} />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={household.data.name}
        title={t('settleUp.title')}
        subtitle={t('settleUp.subtitle')}
        actions={
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-gray-500">{t('settleUp.simplifyOverall')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={simplify}
              onClick={() => setSimplify((s) => !s)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                simplify ? 'bg-teal-600' : 'bg-gray-300 dark:bg-gray-700'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  simplify ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>
        }
      />

      {simplify ? (
        <div className="mb-5">
          <Banner tone="warn">{t('settleUp.simplifyBanner')}</Banner>
        </div>
      ) : null}

      {settleUp.isLoading ? (
        <Card>
          <StateBlock state="loading" />
        </Card>
      ) : settleUp.isError ? (
        <Card>
          <StateBlock state="error" message={t('settleUp.loadError')} />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <StateBlock
            state="empty"
            title={t('settleUp.allSettled')}
            message={t('settleUp.allSettledMessage')}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={`${g.fromUserId}-${g.toUserId}`} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <Avatar name={nameOf(g.fromUserId)} id={g.fromUserId} size="sm" />
                  <span className="text-sm font-semibold">{nameOf(g.fromUserId)}</span>
                  <span className="text-gray-400" aria-hidden>
                    →
                  </span>
                  <Avatar name={nameOf(g.toUserId)} id={g.toUserId} size="sm" />
                  <span className="text-sm font-semibold">{nameOf(g.toUserId)}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <Eyebrow>{t('settleUp.owes')}</Eyebrow>
                    <Money value={g.total.toString()} currency={base} tone="debit" className="font-bold" />
                  </div>
                  {g.rows.length === 1 ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() =>
                        setTarget({
                          fromUserId: g.fromUserId,
                          fromName: nameOf(g.fromUserId),
                          toUserId: g.toUserId,
                          toName: nameOf(g.toUserId),
                          categoryId: g.rows[0].categoryId,
                          categoryName: g.rows[0].categoryName,
                          outstandingBase: g.rows[0].amountBase,
                        })
                      }
                    >
                      {t('settleUp.resetTally')}
                    </Button>
                  ) : null}
                </div>
              </div>

              {g.rows.length > 1 ? (
                <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                  {g.rows.map((r) => (
                    <li
                      key={r.categoryId ?? '∅'}
                      className="flex items-center justify-between gap-3 px-5 py-2.5"
                    >
                      <span className="text-sm text-gray-600 dark:text-gray-300">{categoryLabel(r.categoryName)}</span>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-sm tnum text-gray-900 dark:text-gray-100">
                          {f.money(r.amountBase, base)}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setTarget({
                              fromUserId: g.fromUserId,
                              fromName: nameOf(g.fromUserId),
                              toUserId: g.toUserId,
                              toName: nameOf(g.toUserId),
                              categoryId: r.categoryId,
                              categoryName: r.categoryName,
                              outstandingBase: r.amountBase,
                            })
                          }
                        >
                          {t('settleUp.reset')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <SettlementModal
        open={!!target}
        onClose={() => setTarget(null)}
        householdId={household.data.id}
        target={target}
        baseCurrency={base}
        currencies={currencies.data ?? []}
        defaultCurrency={user?.preferredCurrency ?? base}
      />
    </div>
  );
}
