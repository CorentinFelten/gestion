import { NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PersonalService } from './personal.service';

/**
 * Personal ledger unit tests (PLAN.md §5.5, §9): balance math (income / expense /
 * transfer incl. cross-currency legs), net-worth aggregation with a mocked
 * getLatestRate, and owner-only isolation (user B cannot read user A's data).
 *
 * Uses a tiny in-memory Prisma fake so the real service logic runs end-to-end.
 */

// ── In-memory Prisma fake ─────────────────────────────────────────────────────
type Row = Record<string, any>;

const toT = (v: any): number => (v instanceof Date ? v.getTime() : v);

function matchValue(fieldVal: any, cond: any): boolean {
  if (cond === null) return fieldVal === null || fieldVal === undefined;
  if (cond instanceof Date) return fieldVal instanceof Date && fieldVal.getTime() === cond.getTime();
  if (typeof cond === 'object') {
    if ('in' in cond) return cond.in.includes(fieldVal);
    if ('gte' in cond || 'lte' in cond || 'lt' in cond || 'gt' in cond) {
      const t = toT(fieldVal);
      if (cond.gte !== undefined && !(t >= toT(cond.gte))) return false;
      if (cond.gt !== undefined && !(t > toT(cond.gt))) return false;
      if (cond.lte !== undefined && !(t <= toT(cond.lte))) return false;
      if (cond.lt !== undefined && !(t < toT(cond.lt))) return false;
      return true;
    }
    if ('contains' in cond) {
      if (fieldVal == null) return false;
      const hay = cond.mode === 'insensitive' ? String(fieldVal).toLowerCase() : String(fieldVal);
      const needle = cond.mode === 'insensitive' ? String(cond.contains).toLowerCase() : cond.contains;
      return hay.includes(needle);
    }
  }
  return fieldVal === cond;
}

function matchWhere(row: Row, where: Row = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(v as Row[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(v as Row[]).every((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (!matchValue(row[k], v)) return false;
  }
  return true;
}

let idCounter = 1;
const nextId = (p: string) => `${p}_${idCounter++}`;

/**
 * Matches `household: { members: { some: { userId } } }` relation filters used by
 * the linked-ref guard (SEC-12) against a row's `householdId` and a membership set
 * of `${householdId}:${userId}` keys.
 */
function matchHouseholdMembership(row: Row, where: Row, memberships: Set<string>): boolean {
  const rel = where.household?.members?.some;
  if (!rel) return true;
  return memberships.has(`${row.householdId}:${rel.userId}`);
}

class FakePrisma {
  accounts: Row[] = [];
  personalTransactions: Row[] = [];
  users: Row[] = [];
  categories: Row[] = [];
  transactions: Row[] = [];
  settlements: Row[] = [];
  memberships = new Set<string>(); // `${householdId}:${userId}`

  account = {
    findFirst: async ({ where }: any) => this.accounts.find((a) => matchWhere(a, where)) ?? null,
    findMany: async ({ where }: any) => this.accounts.filter((a) => matchWhere(a, where)),
    create: async ({ data }: any) => {
      const row = {
        id: nextId('acc'),
        isActive: true,
        archivedAt: null,
        sortOrder: 0,
        createdAt: new Date(),
        ...data,
      };
      this.accounts.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = this.accounts.find((a) => a.id === where.id);
      if (!row) throw new Error('account not found');
      Object.assign(row, data);
      return row;
    },
  };

  personalTransaction = {
    findFirst: async ({ where }: any) =>
      this.personalTransactions.find((t) => matchWhere(t, where)) ?? null,
    findMany: async ({ where, include }: any) => {
      const rows = this.personalTransactions.filter((t) => matchWhere(t, where));
      if (include?.account) {
        return rows.map((t) => ({
          ...t,
          account: this.accounts.find((a) => a.id === t.accountId),
          category: this.categories.find((c) => c.id === t.categoryId) ?? null,
        }));
      }
      return rows;
    },
    create: async ({ data }: any) => {
      const row = {
        id: nextId('ptx'),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        amountOriginal: null,
        currencyOriginal: null,
        fxRate: null,
        fxRateDate: null,
        fxSource: null,
        transferAccountId: null,
        transferAmount: null,
        linkedTransactionId: null,
        linkedSettlementId: null,
        payeeSource: null,
        notes: null,
        categoryId: null,
        ...data,
      };
      this.personalTransactions.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = this.personalTransactions.find((t) => t.id === where.id);
      if (!row) throw new Error('txn not found');
      // translate Prisma relation syntax → scalar FKs
      const rel = (key: string, fk: string) => {
        if (data[key] === undefined) return;
        const v = data[key];
        row[fk] = v?.connect?.id ?? (v?.disconnect ? null : row[fk]);
        delete data[key];
      };
      rel('account', 'accountId');
      rel('transferAccount', 'transferAccountId');
      rel('category', 'categoryId');
      rel('linkedTransaction', 'linkedTransactionId');
      rel('linkedSettlement', 'linkedSettlementId');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const rows = this.personalTransactions.filter((t) => matchWhere(t, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };

  user = {
    findUnique: async ({ where }: any) => this.users.find((u) => u.id === where.id) ?? null,
  };

  category = {
    findFirst: async ({ where }: any) => this.categories.find((c) => matchWhere(c, where)) ?? null,
  };

  transaction = {
    findFirst: async ({ where }: any) =>
      this.transactions.find(
        (t) =>
          matchWhere(t, { id: where.id }) &&
          matchHouseholdMembership(t, where, this.memberships),
      ) ?? null,
  };

  settlement = {
    findFirst: async ({ where }: any) =>
      this.settlements.find(
        (s) =>
          matchWhere(s, { id: where.id }) &&
          matchHouseholdMembership(s, where, this.memberships),
      ) ?? null,
  };
}

// ── Test harness ──────────────────────────────────────────────────────────────
function makeService(fxOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const prisma = new FakePrisma();
  const fx: any = {
    convert: jest.fn(),
    getRate: jest.fn(),
    getLatestRate: jest.fn(),
    ...fxOverrides,
  };
  const service = new PersonalService(prisma as any, fx as any);
  return { service, prisma, fx };
}

const USER_A = 'userA';
const USER_B = 'userB';

function seedUser(prisma: FakePrisma, id: string, currency = 'EUR') {
  prisma.users.push({ id, preferredCurrency: currency });
}

const today = new Date().toISOString().slice(0, 10);

describe('PersonalService, account country', () => {
  it('persists the country and returns it in the DTO', async () => {
    const { service } = makeService();
    const acc = await service.createAccount(USER_A, {
      name: 'Compte courant',
      type: 'checking',
      currency: 'EUR',
      country: 'FR',
    });
    expect(acc.country).toBe('FR');
    expect(acc.currency).toBe('EUR');
  });

  it('defaults currency from country when currency omitted (CA → CAD)', async () => {
    const { service } = makeService();
    const acc = await service.createAccount(USER_A, {
      name: 'Compte chèques',
      type: 'checking',
      country: 'CA',
    });
    expect(acc.country).toBe('CA');
    expect(acc.currency).toBe('CAD');
  });

  it('defaults country to FR and currency to EUR when both omitted', async () => {
    const { service } = makeService();
    const acc = await service.createAccount(USER_A, {
      name: 'Livret',
      type: 'savings',
    });
    expect(acc.country).toBe('FR');
    expect(acc.currency).toBe('EUR');
  });

  it('updates the account country', async () => {
    const { service } = makeService();
    const acc = await service.createAccount(USER_A, {
      name: 'Compte',
      type: 'checking',
      country: 'FR',
    });
    const updated = await service.updateAccount(USER_A, acc.id, { country: 'CA' });
    expect(updated.country).toBe('CA');
  });
});

describe('PersonalService, account balance math', () => {
  it('computes opening + income − expense − transfer_out + transfer_in', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);

    const checking = await service.createAccount(USER_A, {
      name: 'Checking',
      type: 'checking',
      currency: 'EUR',
      openingBalance: '100',
    });
    const savings = await service.createAccount(USER_A, {
      name: 'Savings',
      type: 'savings',
      currency: 'EUR',
      openingBalance: '0',
    });

    await service.createTransaction(USER_A, {
      accountId: checking.id,
      type: 'income',
      amount: '50',
      txnDate: today,
    });
    await service.createTransaction(USER_A, {
      accountId: checking.id,
      type: 'expense',
      amount: '30',
      txnDate: today,
    });
    await service.createTransaction(USER_A, {
      accountId: checking.id,
      type: 'transfer',
      amount: '20',
      transferAccountId: savings.id,
      txnDate: today,
    });

    const checkingBal = await service.getAccountBalance(USER_A, checking.id);
    const savingsBal = await service.getAccountBalance(USER_A, savings.id);

    // 100 + 50 − 30 − 20 = 100
    expect(checkingBal.balance).toBe('100');
    expect(checkingBal.currency).toBe('EUR');
    // 0 + 20 = 20
    expect(savingsBal.balance).toBe('20');
  });

  it('stores both legs for a cross-currency transfer (client-supplied leg)', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);

    const checking = await service.createAccount(USER_A, {
      name: 'EUR Checking',
      type: 'checking',
      currency: 'EUR',
      openingBalance: '100',
    });
    const invest = await service.createAccount(USER_A, {
      name: 'USD Invest',
      type: 'investment',
      currency: 'USD',
      openingBalance: '0',
    });

    await service.createTransaction(USER_A, {
      accountId: checking.id,
      type: 'transfer',
      amount: '90', // EUR leg out
      transferAccountId: invest.id,
      transferAmount: '100', // USD leg in
      txnDate: today,
    });

    expect((await service.getAccountBalance(USER_A, checking.id)).balance).toBe('10');
    expect((await service.getAccountBalance(USER_A, invest.id)).balance).toBe('100');
  });

  it('freezes FX for a cross-currency transfer when no leg supplied', async () => {
    const convert = jest.fn().mockResolvedValue({
      amount: new Decimal('11'),
      rate: new Decimal('1.1'),
      rateDate: today,
      source: 'test',
    });
    const { service, prisma } = makeService({ convert });
    seedUser(prisma, USER_A);

    const checking = await service.createAccount(USER_A, {
      name: 'EUR', type: 'checking', currency: 'EUR', openingBalance: '100',
    });
    const usd = await service.createAccount(USER_A, {
      name: 'USD', type: 'savings', currency: 'USD', openingBalance: '0',
    });

    await service.createTransaction(USER_A, {
      accountId: checking.id,
      type: 'transfer',
      amount: '10',
      transferAccountId: usd.id,
      txnDate: today,
    });

    expect(convert).toHaveBeenCalledWith(expect.any(Decimal), 'EUR', 'USD', today);
    expect((await service.getAccountBalance(USER_A, checking.id)).balance).toBe('90');
    expect((await service.getAccountBalance(USER_A, usd.id)).balance).toBe('11');
  });

  it('freezes FX for a foreign-currency expense entry', async () => {
    const convert = jest.fn().mockResolvedValue({
      amount: new Decimal('108'),
      rate: new Decimal('0.9'),
      rateDate: today,
      source: 'test',
    });
    const { service, prisma } = makeService({ convert });
    seedUser(prisma, USER_A);

    const acc = await service.createAccount(USER_A, {
      name: 'EUR', type: 'checking', currency: 'EUR', openingBalance: '200',
    });

    const txn = await service.createTransaction(USER_A, {
      accountId: acc.id,
      type: 'expense',
      amount: '108', // ignored in favour of the converted original
      amountOriginal: '120',
      currencyOriginal: 'USD',
      txnDate: today,
    });

    expect(convert).toHaveBeenCalledWith(expect.any(Decimal), 'USD', 'EUR', today);
    expect(txn.amount).toBe('108');
    expect(txn.amountOriginal).toBe('120');
    expect(txn.currencyOriginal).toBe('USD');
    expect(txn.fxRate).toBe('0.9');
    // 200 − 108 = 92
    expect((await service.getAccountBalance(USER_A, acc.id)).balance).toBe('92');
  });
});

describe('PersonalService, net worth (§3.4 latest rate)', () => {
  it('aggregates active accounts into the profile currency; liabilities count negative', async () => {
    const getLatestRate = jest.fn().mockResolvedValue({
      rate: new Decimal('0.8'),
      rateDate: today,
      source: 'test',
    });
    const { service, prisma } = makeService({ getLatestRate });
    seedUser(prisma, USER_A, 'EUR');

    const checking = await service.createAccount(USER_A, {
      name: 'EUR Checking', type: 'checking', currency: 'EUR', openingBalance: '1000',
    });
    const savings = await service.createAccount(USER_A, {
      name: 'USD Savings', type: 'savings', currency: 'USD', openingBalance: '500',
    });
    const card = await service.createAccount(USER_A, {
      name: 'Credit Card', type: 'credit_card', currency: 'EUR', openingBalance: '0',
    });

    // Spend 300 EUR on the credit card → its balance is −300 (a liability).
    await service.createTransaction(USER_A, {
      accountId: card.id, type: 'expense', amount: '300', txnDate: today,
    });

    const nw = await service.getNetWorth(USER_A);

    // 1000 EUR + 500 USD*0.8 (=400) + (−300) = 1100
    expect(nw.profileCurrency).toBe('EUR');
    expect(nw.total).toBe('1100');
    expect(nw.accounts).toHaveLength(3);

    const usdRow = nw.accounts.find((a) => a.accountId === savings.id)!;
    expect(usdRow.nativeCurrency).toBe('USD');
    expect(usdRow.nativeBalance).toBe('500');
    expect(usdRow.convertedBalance).toBe('400');

    const cardRow = nw.accounts.find((a) => a.accountId === card.id)!;
    expect(cardRow.nativeBalance).toBe('-300');
    expect(cardRow.convertedBalance).toBe('-300');

    // Same-currency account is not converted via FX.
    const eurRow = nw.accounts.find((a) => a.accountId === checking.id)!;
    expect(eurRow.convertedBalance).toBe('1000');
    // getLatestRate only called for the USD account.
    expect(getLatestRate).toHaveBeenCalledTimes(1);
    expect(getLatestRate).toHaveBeenCalledWith('USD', 'EUR');
  });

  it('excludes archived (inactive) accounts from net worth', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A, 'EUR');

    const a = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '100',
    });
    const b = await service.createAccount(USER_A, {
      name: 'B', type: 'savings', currency: 'EUR', openingBalance: '999',
    });
    await service.updateAccount(USER_A, b.id, { isActive: false });

    const nw = await service.getNetWorth(USER_A);
    expect(nw.total).toBe('100');
    expect(nw.accounts).toHaveLength(1);
    expect(nw.accounts[0].accountId).toBe(a.id);
  });
});

describe('PersonalService, owner-only privacy (§9)', () => {
  it('user B cannot read, balance, update, or delete user A data', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    seedUser(prisma, USER_B);

    const accA = await service.createAccount(USER_A, {
      name: 'A private', type: 'checking', currency: 'EUR', openingBalance: '500',
    });
    const txnA = await service.createTransaction(USER_A, {
      accountId: accA.id, type: 'income', amount: '100', txnDate: today,
    });

    // B's listing is empty and never contains A's account.
    expect(await service.listAccounts(USER_B)).toHaveLength(0);
    expect(await service.listTransactions(USER_B, {})).toHaveLength(0);

    // B cannot read A's balance.
    await expect(service.getAccountBalance(USER_B, accA.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // B cannot archive A's account.
    await expect(
      service.updateAccount(USER_B, accA.id, { isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // B cannot edit A's transaction.
    await expect(
      service.updateTransaction(USER_B, txnA.id, { amount: '9999' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // B cannot delete A's transaction.
    await expect(service.removeTransaction(USER_B, txnA.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // A's data is untouched.
    expect((await service.getAccountBalance(USER_A, accA.id)).balance).toBe('600');
  });
});

describe('PersonalService, transactions & stats', () => {
  it('soft-deletes a transaction so it no longer affects the balance', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    const txn = await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'income', amount: '100', txnDate: today,
    });
    expect((await service.getAccountBalance(USER_A, acc.id)).balance).toBe('100');

    await service.removeTransaction(USER_A, txn.id);
    expect((await service.getAccountBalance(USER_A, acc.id)).balance).toBe('0');
    expect(await service.listTransactions(USER_A, {})).toHaveLength(0);
  });

  it('filters transactions by type and search', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'income', amount: '3000', txnDate: today, payeeSource: 'ACME Corp',
    });
    await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'expense', amount: '40', txnDate: today, notes: 'groceries',
    });

    expect(await service.listTransactions(USER_A, { type: 'income' })).toHaveLength(1);
    expect(await service.listTransactions(USER_A, { search: 'grocer' })).toHaveLength(1);
    expect(await service.listTransactions(USER_A, { payee: 'acme' })).toHaveLength(1);
  });

  it('summary reports this-month income, spending and savings rate', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A, 'EUR');
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'income', amount: '2000', txnDate: today,
    });
    await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'expense', amount: '500', txnDate: today,
    });

    const s = await service.getStatsSummary(USER_A);
    expect(s.income).toBe('2000');
    expect(s.spending).toBe('500');
    expect(s.savingsRate).toBe('0.75'); // (2000-500)/2000
  });

  it('income-timeline stats only surface income buckets', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A, 'EUR');
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'income', amount: '2500', txnDate: today,
    });
    await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'expense', amount: '900', txnDate: today,
    });

    const stats = await service.getStats(USER_A, 'income-timeline', 'month');
    expect(stats.view).toBe('income-timeline');
    expect(stats.points).toHaveLength(1);
    expect(stats.points[0].income).toBe('2500');
  });
});

describe('PersonalService, linked shared-ledger refs (SEC-12)', () => {
  it('links to a shared transaction/settlement in the user\'s own household', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    prisma.memberships.add('hh_A:userA');
    prisma.transactions.push({ id: 'sharedTxn', householdId: 'hh_A' });
    prisma.settlements.push({ id: 'sharedStl', householdId: 'hh_A' });
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });

    const created = await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'income', amount: '100', txnDate: today,
      linkedTransactionId: 'sharedTxn', linkedSettlementId: 'sharedStl',
    });
    expect(created.linkedTransactionId).toBe('sharedTxn');
    expect(created.linkedSettlementId).toBe('sharedStl');
  });

  it('rejects linking to a shared transaction outside the user\'s households', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    // The shared txn belongs to a household A is NOT a member of.
    prisma.transactions.push({ id: 'foreignTxn', householdId: 'hh_other' });
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });

    await expect(
      service.createTransaction(USER_A, {
        accountId: acc.id, type: 'income', amount: '100', txnDate: today,
        linkedTransactionId: 'foreignTxn',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects linking to a non-existent shared settlement', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    prisma.memberships.add('hh_A:userA');
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });

    await expect(
      service.createTransaction(USER_A, {
        accountId: acc.id, type: 'income', amount: '100', txnDate: today,
        linkedSettlementId: 'ghost',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects on update when linking to a foreign shared settlement', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    prisma.memberships.add('hh_A:userA');
    prisma.settlements.push({ id: 'foreignStl', householdId: 'hh_other' });
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    const txn = await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'income', amount: '100', txnDate: today,
    });

    await expect(
      service.updateTransaction(USER_A, txn.id, { linkedSettlementId: 'foreignStl' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
