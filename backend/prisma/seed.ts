/**
 * Seed script (PLAN.md §10), demo data for manual QA.
 *
 * Creates: one demo household (base EUR), three users, the default shared +
 * global personal categories, a few mixed-currency shared expenses with equal
 * splits, one category-reset settlement, and per-user personal accounts with
 * income/expense transactions.
 *
 * Idempotent: wipes and recreates the demo rows (matched by the demo email
 * domain) on every run. Run with `npm run seed` or `prisma db seed`.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { Decimal } from 'decimal.js';
import {
  DEFAULT_PERSONAL_CATEGORIES,
  DEFAULT_SHARED_CATEGORIES,
} from '../src/modules/categories/categories.constants';

const prisma = new PrismaClient();

const DEMO_DOMAIN = 'demo.gestion.local';
const PASSWORD = 'demo1234';

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Round to 6 dp like the app's money layer. */
function money(v: Decimal.Value): string {
  return new Decimal(v).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
}

/** Equal split with largest-remainder distribution so Σ == total exactly. */
function equalSplit(totalBase: Decimal, userIds: string[]): { userId: string; amountBase: string }[] {
  const n = userIds.length;
  const cents = totalBase.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const baseShare = Math.floor(cents / n);
  let remainder = cents - baseShare * n;
  return userIds.map((userId) => {
    let share = baseShare;
    if (remainder > 0) {
      share += 1;
      remainder -= 1;
    }
    return { userId, amountBase: money(new Decimal(share).div(100)) };
  });
}

async function wipeDemo(): Promise<void> {
  const demoUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${DEMO_DOMAIN}` } },
    select: { id: true },
  });
  const userIds = demoUsers.map((u) => u.id);
  if (userIds.length === 0) return;
  const households = await prisma.household.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true },
  });
  const householdIds = households.map((h) => h.id);
  // Cascades handle members/transactions/splits/settlements/categories/accounts.
  await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  await wipeDemo();
  const passwordHash = await argon2.hash(PASSWORD);

  // ── Users ──────────────────────────────────────────────────────────────────
  const [alice, bob, carol] = await Promise.all(
    [
      { email: `alice@${DEMO_DOMAIN}`, displayName: 'Alice', preferredCurrency: 'EUR' },
      { email: `bob@${DEMO_DOMAIN}`, displayName: 'Bob', preferredCurrency: 'USD' },
      { email: `carol@${DEMO_DOMAIN}`, displayName: 'Carol', preferredCurrency: 'GBP' },
    ].map((u) => prisma.user.create({ data: { ...u, passwordHash } })),
  );

  // ── Household + default shared categories + members ──────────────────────────
  const household = await prisma.household.create({
    data: {
      name: 'Demo Household',
      baseCurrency: 'EUR',
      createdById: alice.id,
      members: {
        create: [
          { userId: alice.id, role: 'owner' },
          { userId: bob.id, role: 'member' },
          { userId: carol.id, role: 'member' },
        ],
      },
      categories: {
        create: DEFAULT_SHARED_CATEGORIES.map((c) => ({
          scope: c.scope,
          flow: c.flow,
          name: c.name,
          icon: c.icon ?? null,
          color: c.color ?? null,
        })),
      },
    },
    include: { categories: true },
  });
  const catByName = new Map(household.categories.map((c) => [c.name, c]));
  const memberIds = [alice.id, bob.id, carol.id];

  // Global personal defaults (shared across all users), created once.
  const existingGlobal = await prisma.category.count({
    where: { userId: null, householdId: null, scope: { in: ['personal', 'both'] } },
  });
  if (existingGlobal === 0) {
    await prisma.category.createMany({
      data: DEFAULT_PERSONAL_CATEGORIES.map((c) => ({
        householdId: null,
        userId: null,
        scope: c.scope,
        flow: c.flow,
        name: c.name,
        icon: c.icon ?? null,
        color: c.color ?? null,
      })),
      skipDuplicates: true,
    });
  }

  // ── Mixed-currency shared expenses with equal splits ─────────────────────────
  // Fixed illustrative FX rates (seed avoids network; the app freezes live rates).
  const expenses: {
    payer: string;
    desc: string;
    category: string;
    amountOriginal: string;
    currency: string;
    date: string;
    rate: string; // original -> EUR
    participants: string[];
  }[] = [
    { payer: alice.id, desc: 'Weekly groceries', category: 'Alimentation', amountOriginal: '90', currency: 'EUR', date: '2026-03-02', rate: '1', participants: memberIds },
    { payer: bob.id, desc: 'US hotel', category: 'Voyages', amountOriginal: '120', currency: 'USD', date: '2026-03-13', rate: '0.871380', participants: memberIds },
    { payer: carol.id, desc: 'Internet bill', category: 'Internet', amountOriginal: '40', currency: 'GBP', date: '2026-03-05', rate: '1.180000', participants: memberIds },
    { payer: alice.id, desc: 'Electricity', category: 'Électricité', amountOriginal: '75', currency: 'EUR', date: '2026-03-20', rate: '1', participants: [alice.id, bob.id] },
  ];

  for (const e of expenses) {
    const cat = catByName.get(e.category);
    const amountOriginal = new Decimal(e.amountOriginal);
    const rate = new Decimal(e.rate);
    const amountBase = amountOriginal.times(rate);
    const splits = equalSplit(new Decimal(money(amountBase)), e.participants);
    await prisma.transaction.create({
      data: {
        householdId: household.id,
        payerUserId: e.payer,
        description: e.desc,
        categoryId: cat?.id ?? null,
        amountOriginal: money(amountOriginal),
        currencyOriginal: e.currency,
        paymentDate: d(e.date),
        baseCurrency: 'EUR',
        fxRate: e.rate,
        fxRateDate: d(e.date),
        fxSource: e.currency === 'EUR' ? 'identity' : 'seed',
        amountBase: money(amountBase),
        createdById: e.payer,
        splits: {
          create: splits.map((s): Prisma.TransactionSplitCreateWithoutTransactionInput => ({
            user: { connect: { id: s.userId } },
            splitType: 'equal',
            shareValue: '1',
            amountBase: s.amountBase,
          })),
        },
      },
    });
  }

  // ── A partial reimbursement: Bob pays Alice 20 EUR toward Groceries ──────────
  await prisma.settlement.create({
    data: {
      householdId: household.id,
      fromUserId: bob.id,
      toUserId: alice.id,
      categoryId: catByName.get('Alimentation')?.id ?? null,
      amountOriginal: '20',
      currencyOriginal: 'EUR',
      paymentDate: d('2026-03-22'),
      fxRate: '1',
      fxRateDate: d('2026-03-22'),
      fxSource: 'identity',
      amountBase: '20',
      isFullReset: false,
      note: 'Partial groceries reimbursement',
      createdById: bob.id,
    },
  });

  // ── Personal ledgers (per user) ──────────────────────────────────────────────
  for (const [user, currency, opening] of [
    [alice, 'EUR', '1500'],
    [bob, 'USD', '2200'],
    [carol, 'GBP', '800'],
  ] as const) {
    const checking = await prisma.account.create({
      data: { userId: user.id, name: 'Checking', type: 'checking', currency, openingBalance: opening, sortOrder: 0 },
    });
    const savings = await prisma.account.create({
      data: { userId: user.id, name: 'Savings', type: 'savings', currency, openingBalance: '5000', sortOrder: 1 },
    });
    await prisma.personalTransaction.createMany({
      data: [
        { userId: user.id, accountId: checking.id, type: 'income', amount: '2600', txnDate: d('2026-03-01'), payeeSource: 'Employer', notes: 'Monthly salary' },
        { userId: user.id, accountId: checking.id, type: 'expense', amount: '450', txnDate: d('2026-03-03'), payeeSource: 'Landlord', notes: 'Rent' },
        { userId: user.id, accountId: checking.id, type: 'expense', amount: '85', txnDate: d('2026-03-10'), payeeSource: 'Supermarket', notes: 'Groceries' },
      ],
    });
    // A cross-account transfer (checking -> savings).
    await prisma.personalTransaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        type: 'transfer',
        amount: '300',
        transferAccountId: savings.id,
        transferAmount: '300',
        txnDate: d('2026-03-15'),
        notes: 'Move to savings',
      },
    });
  }

  const [users, households, txns, setts, accts, ptx] = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } }),
    prisma.household.count({ where: { id: household.id } }),
    prisma.transaction.count({ where: { householdId: household.id } }),
    prisma.settlement.count({ where: { householdId: household.id } }),
    prisma.account.count({ where: { userId: { in: memberIds } } }),
    prisma.personalTransaction.count({ where: { userId: { in: memberIds } } }),
  ]);

  console.log('Seed complete:');
  console.log(`  users=${users} households=${households} shared-expenses=${txns} settlements=${setts}`);
  console.log(`  personal-accounts=${accts} personal-transactions=${ptx}`);
  console.log(`  login: alice@${DEMO_DOMAIN} / ${PASSWORD}  (also bob@, carol@)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
