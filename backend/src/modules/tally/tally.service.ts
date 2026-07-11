import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { Ledger, NULL_CATEGORY_KEY } from './ledger';
import type {
  CategoryTotal,
  ReportGroup,
  ReportResponseDto,
  ReportRow,
  SettleUpEntry,
  SettleUpResponseDto,
  TallyBoardDto,
  TallyCell,
  TallyMemberPosition,
} from './dto/tally.dto';

function money(v: Decimal): string {
  return v.toDecimalPlaces(6).toString();
}

interface LoadedLedger {
  ledger: Ledger;
  members: { id: string; name: string }[];
  baseCurrency: string;
  categoryName: (catKey: string) => string;
}

/**
 * Pairwise, per-category balance engine (PLAN.md §5). Everything is DERIVED
 * from transaction_splits + settlements, no dedicated balance table.
 */
@Injectable()
export class TallyService {
  constructor(private readonly prisma: PrismaService) {}

  // ── shared loader ────────────────────────────────────────────────────────
  private async load(householdId: string): Promise<LoadedLedger> {
    const [household, memberRows, splitRows, settlementRows] = await Promise.all([
      this.prisma.household.findUnique({
        where: { id: householdId },
        select: { baseCurrency: true },
      }),
      this.prisma.householdMember.findMany({
        where: { householdId },
        include: { user: { select: { id: true, displayName: true } } },
      }),
      this.prisma.transactionSplit.findMany({
        where: { transaction: { householdId, deletedAt: null } },
        select: {
          userId: true,
          amountBase: true,
          transaction: { select: { payerUserId: true, categoryId: true } },
        },
      }),
      this.prisma.settlement.findMany({
        where: { householdId },
        select: {
          fromUserId: true,
          toUserId: true,
          categoryId: true,
          amountBase: true,
        },
      }),
    ]);

    const ledger = new Ledger();
    const categoryNames = new Map<string, string>();

    for (const s of splitRows) {
      const catKey = s.transaction.categoryId ?? NULL_CATEGORY_KEY;
      ledger.addOwe(
        s.userId,
        s.transaction.payerUserId,
        catKey,
        new Decimal(s.amountBase.toString()),
      );
    }
    for (const st of settlementRows) {
      const catKey = st.categoryId ?? NULL_CATEGORY_KEY;
      ledger.addPaid(
        st.fromUserId,
        st.toUserId,
        catKey,
        new Decimal(st.amountBase.toString()),
      );
    }

    // Resolve category display names for the buckets in play.
    const realIds = ledger.categoryKeys().filter((k) => k !== NULL_CATEGORY_KEY);
    if (realIds.length > 0) {
      const cats = await this.prisma.category.findMany({
        where: { id: { in: realIds } },
        select: { id: true, name: true },
      });
      for (const c of cats) categoryNames.set(c.id, c.name);
    }

    return {
      ledger,
      baseCurrency: household?.baseCurrency ?? 'EUR',
      members: memberRows.map((m) => ({ id: m.user.id, name: m.user.displayName })),
      categoryName: (catKey: string) =>
        catKey === NULL_CATEGORY_KEY
          ? 'Uncategorized'
          : (categoryNames.get(catKey) ?? 'Unknown category'),
    };
  }

  // ── primitive ─────────────────────────────────────────────────────────────
  /**
   * net_pair(u, v, c) in base currency. Positive ⇒ u owes v.
   * `categoryId` null ⇒ overall net across every category bucket.
   */
  async netPair(
    householdId: string,
    userU: string,
    userV: string,
    categoryId: string | null,
  ): Promise<Decimal> {
    const { ledger } = await this.load(householdId);
    return categoryId === null
      ? ledger.netOverall(userU, userV)
      : ledger.netCat(userU, userV, categoryId);
  }

  // ── tally board ────────────────────────────────────────────────────────────
  async getTally(
    householdId: string,
    opts: { subjectUserId?: string; categoryId?: string },
  ): Promise<TallyBoardDto> {
    const loaded = await this.load(householdId);
    const { ledger, members, baseCurrency } = loaded;

    // Category buckets in scope (a single category when filtered).
    const scopeKeys = opts.categoryId ? [opts.categoryId] : ledger.categoryKeys();

    if (opts.subjectUserId) {
      const subject = members.find((m) => m.id === opts.subjectUserId);
      const pos = this.buildPosition(loaded, opts.subjectUserId, scopeKeys);
      return {
        baseCurrency,
        subjectUserId: opts.subjectUserId,
        subjectUserName: subject?.name ?? null,
        cells: pos.cells,
        categoryTotals: pos.categoryTotals,
        overall: pos.overall,
      };
    }

    // Full matrix: one position per member.
    const memberPositions: TallyMemberPosition[] = members.map((m) => {
      const pos = this.buildPosition(loaded, m.id, scopeKeys);
      return {
        subjectUserId: m.id,
        subjectUserName: m.name,
        cells: pos.cells,
        categoryTotals: pos.categoryTotals,
        overall: pos.overall,
      };
    });

    return {
      baseCurrency,
      subjectUserId: null,
      subjectUserName: null,
      cells: [],
      categoryTotals: [],
      overall: '0',
      members: memberPositions,
    };
  }

  /**
   * Build one subject's position: per (other member × category) cell where the
   * subject is OWED (+) or OWES (−), plus per-category subtotals and overall.
   * cell.net = net_pair(other, subject, c) so + means the other owes subject.
   */
  private buildPosition(
    loaded: LoadedLedger,
    subjectId: string,
    scopeKeys: string[],
  ): { cells: TallyCell[]; categoryTotals: CategoryTotal[]; overall: string } {
    const { ledger, members, categoryName } = loaded;
    const others = members.filter((m) => m.id !== subjectId);

    const cells: TallyCell[] = [];
    const categoryTotals: CategoryTotal[] = [];
    let overall = new Decimal(0);

    for (const catKey of scopeKeys) {
      let catTotal = new Decimal(0);
      for (const other of others) {
        const net = ledger.netCat(other.id, subjectId, catKey); // + ⇒ other owes subject
        catTotal = catTotal.plus(net);
        if (!net.isZero()) {
          cells.push({
            categoryId: catKey === NULL_CATEGORY_KEY ? null : catKey,
            categoryName: categoryName(catKey),
            otherUserId: other.id,
            otherUserName: other.name,
            net: money(net),
          });
        }
      }
      categoryTotals.push({
        categoryId: catKey === NULL_CATEGORY_KEY ? null : catKey,
        categoryName: categoryName(catKey),
        net: money(catTotal),
      });
      overall = overall.plus(catTotal);
    }

    return { cells, categoryTotals, overall: money(overall) };
  }

  // ── settle up ──────────────────────────────────────────────────────────────
  async getSettleUp(householdId: string, simplify: boolean): Promise<SettleUpResponseDto> {
    const { ledger, members, baseCurrency, categoryName } = await this.load(householdId);
    const nameOf = new Map(members.map((m) => [m.id, m.name]));

    if (simplify) {
      return {
        baseCurrency,
        simplified: true,
        entries: this.greedySimplify(ledger, members, nameOf),
      };
    }

    // Per-category exact transfers, each net_pair is already the exact amount.
    const entries: SettleUpEntry[] = [];
    for (const catKey of ledger.categoryKeys()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i].id;
          const b = members[j].id;
          const net = ledger.netCat(a, b, catKey); // + ⇒ a owes b
          if (net.isZero()) continue;
          const debtor = net.gt(0) ? a : b;
          const creditor = net.gt(0) ? b : a;
          entries.push({
            fromUserId: debtor,
            fromUserName: nameOf.get(debtor),
            toUserId: creditor,
            toUserName: nameOf.get(creditor),
            categoryId: catKey === NULL_CATEGORY_KEY ? null : catKey,
            categoryName: categoryName(catKey),
            amountBase: money(net.abs()),
          });
        }
      }
    }
    entries.sort((x, y) => new Decimal(y.amountBase).comparedTo(new Decimal(x.amountBase)));
    return { baseCurrency, simplified: false, entries };
  }

  /**
   * Optional overall greedy min-transfer matching (loses per-category detail).
   * balance(u) > 0 ⇒ u is a net creditor (is owed); < 0 ⇒ net debtor.
   */
  private greedySimplify(
    ledger: Ledger,
    members: { id: string; name: string }[],
    nameOf: Map<string, string>,
  ): SettleUpEntry[] {
    const balances = members.map((m) => {
      let bal = new Decimal(0);
      for (const other of members) {
        if (other.id === m.id) continue;
        // net_pair(other, m) > 0 ⇒ other owes m ⇒ m is owed (+).
        bal = bal.plus(ledger.netOverall(other.id, m.id));
      }
      return { id: m.id, bal };
    });

    const creditors = balances.filter((b) => b.bal.gt(0)).map((b) => ({ ...b }));
    const debtors = balances
      .filter((b) => b.bal.lt(0))
      .map((b) => ({ id: b.id, bal: b.bal.neg() }));
    creditors.sort((a, b) => b.bal.comparedTo(a.bal));
    debtors.sort((a, b) => b.bal.comparedTo(a.bal));

    const entries: SettleUpEntry[] = [];
    let ci = 0;
    let di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const c = creditors[ci];
      const d = debtors[di];
      const amount = Decimal.min(c.bal, d.bal);
      if (amount.gt(0)) {
        entries.push({
          fromUserId: d.id,
          fromUserName: nameOf.get(d.id),
          toUserId: c.id,
          toUserName: nameOf.get(c.id),
          categoryId: null,
          categoryName: 'Overall (simplified)',
          amountBase: money(amount),
        });
      }
      c.bal = c.bal.minus(amount);
      d.bal = d.bal.minus(amount);
      if (c.bal.lte(0)) ci++;
      if (d.bal.lte(0)) di++;
    }
    return entries;
  }

  // ── reports ────────────────────────────────────────────────────────────────
  async getReports(householdId: string, group: ReportGroup): Promise<ReportResponseDto> {
    const [household, memberRows, txns] = await Promise.all([
      this.prisma.household.findUnique({
        where: { id: householdId },
        select: { baseCurrency: true },
      }),
      this.prisma.householdMember.findMany({
        where: { householdId },
        include: { user: { select: { id: true, displayName: true } } },
      }),
      this.prisma.transaction.findMany({
        where: { householdId, deletedAt: null },
        select: {
          categoryId: true,
          payerUserId: true,
          paymentDate: true,
          currencyOriginal: true,
          amountBase: true,
        },
      }),
    ]);

    const memberName = new Map(memberRows.map((m) => [m.user.id, m.user.displayName]));
    const catIds = [...new Set(txns.map((t) => t.categoryId).filter((c): c is string => !!c))];
    const catName = new Map<string, string>();
    if (catIds.length > 0) {
      const cats = await this.prisma.category.findMany({
        where: { id: { in: catIds } },
        select: { id: true, name: true },
      });
      for (const c of cats) catName.set(c.id, c.name);
    }

    const buckets = new Map<string, { label: string; total: Decimal; count: number }>();
    const add = (key: string, label: string, amount: Decimal): void => {
      const b = buckets.get(key) ?? { label, total: new Decimal(0), count: 0 };
      b.total = b.total.plus(amount);
      b.count += 1;
      buckets.set(key, b);
    };

    for (const t of txns) {
      const amount = new Decimal(t.amountBase.toString());
      switch (group) {
        case 'category': {
          const k = t.categoryId ?? '__none__';
          add(
            k,
            t.categoryId ? (catName.get(t.categoryId) ?? 'Unknown') : 'Uncategorized',
            amount,
          );
          break;
        }
        case 'member':
          add(t.payerUserId, memberName.get(t.payerUserId) ?? 'Unknown', amount);
          break;
        case 'month': {
          const ym = t.paymentDate.toISOString().slice(0, 7);
          add(ym, ym, amount);
          break;
        }
        case 'currency':
          add(t.currencyOriginal, t.currencyOriginal, amount);
          break;
      }
    }

    const rows: ReportRow[] = [...buckets.entries()]
      .map(([key, b]) => ({
        key,
        label: b.label,
        totalBase: money(b.total),
        count: b.count,
      }))
      .sort((a, b) => new Decimal(b.totalBase).comparedTo(new Decimal(a.totalBase)));

    return { baseCurrency: household?.baseCurrency ?? 'EUR', group, rows };
  }
}
