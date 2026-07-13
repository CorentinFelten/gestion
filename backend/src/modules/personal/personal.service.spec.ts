import { BadRequestException, NotFoundException } from '@nestjs/common';
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

const toT = (v: any): number => {
  if (v instanceof Date) return v.getTime();
  // Numeric (decimal) strings compare numerically, matching Prisma's Decimal
  // range filters (amount gte/lte). Non-numeric strings fall through unchanged.
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
};

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
  netWorthSnapshots: Row[] = [];
  savedFilters: Row[] = [];
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
        interestRate: null,
        creditLimit: null,
        minPayment: null,
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

  netWorthSnapshot = {
    findMany: async ({ where, orderBy }: any) => {
      let rows = this.netWorthSnapshots.filter((r) => matchWhere(r, where));
      if (orderBy?.snapshotDate === 'asc') {
        rows = [...rows].sort((a, b) => a.snapshotDate.getTime() - b.snapshotDate.getTime());
      }
      return rows;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.userId_snapshotDate;
      const existing = this.netWorthSnapshots.find(
        (r) => r.userId === key.userId && r.snapshotDate.getTime() === key.snapshotDate.getTime(),
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: nextId('nws'), createdAt: new Date(), ...create };
      this.netWorthSnapshots.push(row);
      return row;
    },
  };

  savedFilter = {
    findMany: async ({ where, orderBy }: any) => {
      let rows = this.savedFilters.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === 'asc') {
        rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }
      return rows;
    },
    create: async ({ data }: any) => {
      const row = { id: nextId('sf'), createdAt: new Date(), updatedAt: new Date(), ...data };
      this.savedFilters.push(row);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      const before = this.savedFilters.length;
      this.savedFilters = this.savedFilters.filter((r) => !matchWhere(r, where));
      return { count: before - this.savedFilters.length };
    },
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

  it('editing a transfer amount recomputes the destination leg (no desync)', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const checking = await service.createAccount(USER_A, {
      name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '100',
    });
    const savings = await service.createAccount(USER_A, {
      name: 'Savings', type: 'savings', currency: 'EUR', openingBalance: '0',
    });
    const tx = await service.createTransaction(USER_A, {
      accountId: checking.id, type: 'transfer', amount: '20',
      transferAccountId: savings.id, txnDate: today,
    });

    // Bump ONLY the amount; the incoming leg must follow, not stay at 20.
    await service.updateTransaction(USER_A, tx.id, { amount: '50' });

    // 100 − 50 = 50 ; savings 0 + 50 = 50 (would be +20 if the leg desynced).
    expect((await service.getAccountBalance(USER_A, checking.id)).balance).toBe('50');
    expect((await service.getAccountBalance(USER_A, savings.id)).balance).toBe('50');
  });

  it('rejects another household\'s shared category on a personal transaction', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    // Global personal default (householdId null): allowed.
    prisma.categories.push({
      id: 'cat_global', userId: null, householdId: null, scope: 'personal', name: 'Salaire', flow: 'income',
    });
    // A different household's SHARED category (userId null, householdId set): must NOT match.
    prisma.categories.push({
      id: 'cat_foreign', userId: null, householdId: 'hh_other', scope: 'shared', name: 'Secret', flow: 'expense',
    });

    await expect(
      service.createTransaction(USER_A, {
        accountId: acc.id, type: 'expense', amount: '10', txnDate: today, categoryId: 'cat_foreign',
      }),
    ).rejects.toThrow('Category not found');

    const ok = await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'income', amount: '10', txnDate: today, categoryId: 'cat_global',
    });
    expect(ok.categoryId).toBe('cat_global');
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
    // The exact latest rate + its date surface on the converted account.
    expect(usdRow.fxRate).toBe('0.8');
    expect(usdRow.fxRateDate).toBe(today);

    const cardRow = nw.accounts.find((a) => a.accountId === card.id)!;
    expect(cardRow.nativeBalance).toBe('-300');
    expect(cardRow.convertedBalance).toBe('-300');
    expect(cardRow.fxRate).toBeNull();

    // Same-currency account is not converted via FX.
    const eurRow = nw.accounts.find((a) => a.accountId === checking.id)!;
    expect(eurRow.convertedBalance).toBe('1000');
    // No FX applied → no rate/date reported.
    expect(eurRow.fxRate).toBeNull();
    expect(eurRow.fxRateDate).toBeNull();
    // getLatestRate only called for the USD account.
    expect(getLatestRate).toHaveBeenCalledTimes(1);
    expect(getLatestRate).toHaveBeenCalledWith('USD', 'EUR');
  });

  it('fetches transactions once for all accounts (no N+1)', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A, 'EUR');

    // Several accounts, each with transactions, so a per-account fetch would
    // be visible as multiple findMany calls.
    for (let i = 0; i < 4; i += 1) {
      const acc = await service.createAccount(USER_A, {
        name: `A${i}`, type: 'checking', currency: 'EUR', openingBalance: '100',
      });
      await service.createTransaction(USER_A, {
        accountId: acc.id, type: 'income', amount: '50', txnDate: today,
      });
    }

    const findManySpy = jest.spyOn(prisma.personalTransaction, 'findMany');
    const nw = await service.getNetWorth(USER_A);

    // 4 accounts × (100 opening + 50 income) = 600.
    expect(nw.total).toBe('600');
    expect(nw.accounts).toHaveLength(4);
    // One preload query drives every account's balance (was one-per-account).
    expect(findManySpy).toHaveBeenCalledTimes(1);
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

  it('filters transactions by account, and includes the incoming transfer leg', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const checking = await service.createAccount(USER_A, {
      name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    const savings = await service.createAccount(USER_A, {
      name: 'Savings', type: 'savings', currency: 'EUR', openingBalance: '0',
    });
    await service.createTransaction(USER_A, {
      accountId: checking.id, type: 'income', amount: '3000', txnDate: today,
    });
    await service.createTransaction(USER_A, {
      accountId: savings.id, type: 'income', amount: '500', txnDate: today,
    });
    await service.createTransaction(USER_A, {
      accountId: checking.id, type: 'transfer', amount: '200',
      transferAccountId: savings.id, txnDate: today,
    });

    // Checking sees its own income + the outgoing transfer leg.
    expect(await service.listTransactions(USER_A, { accountId: checking.id })).toHaveLength(2);
    // Savings sees its own income + the *incoming* transfer leg (transferAccountId).
    expect(await service.listTransactions(USER_A, { accountId: savings.id })).toHaveLength(2);
    // Filtering never leaks the other account's non-transfer postings.
    const savingsTxs = await service.listTransactions(USER_A, { accountId: savings.id });
    expect(savingsTxs.some((t) => t.type === 'income' && t.amount === '3000')).toBe(false);
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

// ── #9 credit-card payoff projection ────────────────────────────────────────
describe('PersonalService, payoff schedule', () => {
  async function creditWithDebt(service: any, prisma: FakePrisma, opts: any) {
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'Visa', type: 'credit_card', currency: 'EUR', openingBalance: '0', ...opts,
    });
    // Spend on the card → negative balance (amount owed).
    await service.createTransaction(USER_A, {
      accountId: acc.id, type: 'expense', amount: '1000', txnDate: today,
    });
    return acc;
  }

  it('rejects payoff for a non-credit account', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'Courant', type: 'checking', currency: 'EUR',
    });
    await expect(service.getPayoffSchedule(USER_A, acc.id, '100')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('clears a 0% debt in ceil(balance / payment) months with no interest', async () => {
    const { service, prisma } = makeService();
    const acc = await creditWithDebt(service, prisma, { interestRate: '0' });
    const res = await service.getPayoffSchedule(USER_A, acc.id, '250');
    expect(res.startingBalance).toBe('1000');
    expect(res.neverPaysOff).toBe(false);
    expect(res.months).toBe(4); // 1000 / 250
    expect(res.totalInterest).toBe('0');
    expect(res.totalPaid).toBe('1000');
    expect(res.schedule[res.schedule.length - 1].balance).toBe('0');
  });

  it('accrues interest and still converges for a positive APR', async () => {
    const { service, prisma } = makeService();
    const acc = await creditWithDebt(service, prisma, { interestRate: '19.99' });
    const res = await service.getPayoffSchedule(USER_A, acc.id, '100');
    expect(res.neverPaysOff).toBe(false);
    expect(res.months).toBeGreaterThan(10); // interest stretches it past 10 payments
    expect(Number(res.totalInterest)).toBeGreaterThan(0);
    expect(Number(res.totalPaid)).toBeCloseTo(1000 + Number(res.totalInterest), 2);
    expect(res.schedule[res.schedule.length - 1].balance).toBe('0');
  });

  it('flags neverPaysOff when the payment is below the monthly interest', async () => {
    const { service, prisma } = makeService();
    const acc = await creditWithDebt(service, prisma, { interestRate: '24' });
    // 24% APR on 1000 = 20/month interest; paying 15 never reduces principal.
    const res = await service.getPayoffSchedule(USER_A, acc.id, '15');
    expect(res.neverPaysOff).toBe(true);
    expect(res.months).toBe(0);
    expect(res.schedule).toHaveLength(0);
  });

  it('returns an empty schedule when nothing is owed', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'Visa', type: 'credit_card', currency: 'EUR', openingBalance: '0', interestRate: '20',
    });
    const res = await service.getPayoffSchedule(USER_A, acc.id, '100');
    expect(res.startingBalance).toBe('0');
    expect(res.neverPaysOff).toBe(false);
    expect(res.months).toBe(0);
  });

  it('persists and returns credit metadata on the account DTO', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'Visa', type: 'credit_card', currency: 'EUR',
      interestRate: '19.99', creditLimit: '5000', minPayment: '35',
    });
    expect(acc.interestRate).toBe('19.99');
    expect(acc.creditLimit).toBe('5000');
    expect(acc.minPayment).toBe('35');
    const cleared = await service.updateAccount(USER_A, acc.id, { interestRate: null });
    expect(cleared.interestRate).toBeNull();
  });
});

// ── #3 net-worth snapshots ──────────────────────────────────────────────────
describe('PersonalService, net-worth snapshots', () => {
  it('captures an idempotent daily snapshot (upsert per day)', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A, 'EUR');
    await service.createAccount(USER_A, {
      name: 'Courant', type: 'checking', currency: 'EUR', openingBalance: '3100',
    });

    const first = await service.captureNetWorthSnapshot(USER_A);
    expect(first.total).toBe('3100');
    expect(first.currency).toBe('EUR');
    await service.captureNetWorthSnapshot(USER_A); // same day again
    expect(prisma.netWorthSnapshots).toHaveLength(1); // upserted, not duplicated
  });

  it('returns history oldest-first and scoped to the owner', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A, 'EUR');
    seedUser(prisma, USER_B, 'EUR');
    prisma.netWorthSnapshots.push(
      { id: 's1', userId: USER_A, snapshotDate: new Date('2026-01-10'), currency: 'EUR', totalBase: '100' },
      { id: 's2', userId: USER_A, snapshotDate: new Date('2026-02-10'), currency: 'EUR', totalBase: '250' },
      { id: 's3', userId: USER_B, snapshotDate: new Date('2026-02-10'), currency: 'EUR', totalBase: '999' },
    );
    const hist = await service.getNetWorthHistory(USER_A, 100000);
    expect(hist.points.map((p: any) => p.total)).toEqual(['100', '250']); // not B's 999
    expect(hist.points[0].date).toBe('2026-01-10');
  });
});

// ── #8 saved filters + amount range ─────────────────────────────────────────
describe('PersonalService, saved filters', () => {
  it('creates, lists (owner-only), and deletes saved filters', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    seedUser(prisma, USER_B);
    const f = await service.createSavedFilter(USER_A, {
      name: 'Restos > 20', filters: { search: 'resto', minAmount: '20' },
    });
    expect(f.filters.search).toBe('resto');
    await service.createSavedFilter(USER_B, { name: 'B private', filters: { type: 'income' } });

    const listA = await service.listSavedFilters(USER_A);
    expect(listA).toHaveLength(1); // never sees B's
    expect(listA[0].name).toBe('Restos > 20');

    await service.deleteSavedFilter(USER_A, f.id);
    expect(await service.listSavedFilters(USER_A)).toHaveLength(0);
  });

  it('refuses to delete another user\'s filter (404)', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    seedUser(prisma, USER_B);
    const f = await service.createSavedFilter(USER_B, { name: 'B', filters: {} });
    await expect(service.deleteSavedFilter(USER_A, f.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.savedFilters).toHaveLength(1); // untouched
  });

  it('filters transactions by inclusive amount range', async () => {
    const { service, prisma } = makeService();
    seedUser(prisma, USER_A);
    const acc = await service.createAccount(USER_A, {
      name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0',
    });
    for (const amount of ['5', '25', '100']) {
      await service.createTransaction(USER_A, {
        accountId: acc.id, type: 'expense', amount, txnDate: today,
      });
    }
    const mid = await service.listTransactions(USER_A, { minAmount: '10', maxAmount: '50' });
    expect(mid.map((t: any) => t.amount).sort()).toEqual(['25']);
  });
});
