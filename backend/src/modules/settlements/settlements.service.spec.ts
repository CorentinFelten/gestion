import { Decimal } from 'decimal.js';
import { SettlementsService } from './settlements.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FxService } from '../fx/fx.service';
import type { TallyService } from '../tally/tally.service';
import type { CreateSettlementDto } from './dto/settlement.dto';

/**
 * Multi-currency settlement nets correctly + reset/direction logic, with a
 * MOCKED FxService (no network, no DB).
 */
describe('SettlementsService.create', () => {
  let created: Record<string, unknown> | undefined;

  function build(opts: {
    convert: { amount: string; rate: string; rateDate: string; source: string };
    outstanding: string; // net_pair(from,to,category) before this settlement
  }) {
    created = undefined;
    const prisma = {
      householdMember: { findUnique: jest.fn().mockResolvedValue({ role: 'member' }) },
      household: { findUnique: jest.fn().mockResolvedValue({ baseCurrency: 'EUR' }) },
      // Category scoped to the target household (SEC-11): passes the scope check.
      category: {
        findUnique: jest.fn().mockResolvedValue({ householdId: 'hh1', userId: null }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit1' }) },
      settlement: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          created = data;
          // Echo back a Settlement-like row (Decimals + Dates).
          return Promise.resolve({
            id: 's1',
            householdId: data.householdId,
            fromUserId: data.fromUserId,
            toUserId: data.toUserId,
            categoryId: data.categoryId ?? null,
            amountOriginal: new Decimal(String(data.amountOriginal)),
            currencyOriginal: data.currencyOriginal,
            paymentDate: new Date(`${'2026-03-14'}T00:00:00.000Z`),
            fxRate: new Decimal(String(data.fxRate)),
            fxRateDate: data.fxRateDate,
            fxSource: data.fxSource,
            amountBase: new Decimal(String(data.amountBase)),
            isFullReset: data.isFullReset,
            note: data.note ?? null,
            createdById: data.createdById,
            createdAt: new Date('2026-03-14T10:00:00.000Z'),
          });
        }),
      },
    } as unknown as PrismaService;

    const fx = {
      convert: jest.fn().mockResolvedValue({
        amount: new Decimal(opts.convert.amount),
        rate: new Decimal(opts.convert.rate),
        rateDate: opts.convert.rateDate,
        source: opts.convert.source,
      }),
    } as unknown as FxService;

    const tally = {
      netPair: jest.fn().mockResolvedValue(new Decimal(opts.outstanding)),
      netCategoryBucket: jest.fn().mockResolvedValue(new Decimal(opts.outstanding)),
    } as unknown as TallyService;

    return { service: new SettlementsService(prisma, fx, tally), fx, prisma };
  }

  const baseDto: CreateSettlementDto = {
    fromUserId: 'bob',
    toUserId: 'alice',
    categoryId: 'c1',
    amountOriginal: '50',
    currencyOriginal: 'USD',
    paymentDate: '2026-03-14',
    note: null,
    linkToAccountId: null,
  };

  it('freezes FX and stores the converted amount_base', async () => {
    // 50 USD → 45 EUR at 0.9; outstanding 45 → full reset.
    const { service, fx } = build({
      convert: { amount: '45', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '45',
    });
    const res = await service.create('hh1', 'bob', baseDto);

    expect(fx.convert).toHaveBeenCalledWith(
      expect.any(Decimal),
      'USD',
      'EUR',
      '2026-03-14',
    );
    expect(res.amountBase).toBe('45');
    expect(res.fxRate).toBe('0.9');
    expect(res.isFullReset).toBe(true);
    expect(res.directionWarning).toBe(false);
  });

  it('partial payment is not a full reset and reduces the tally', async () => {
    // 20 USD → 18 EUR at 0.9; outstanding 45 → partial.
    const { service } = build({
      convert: { amount: '18', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '45',
    });
    const res = await service.create('hh1', 'bob', { ...baseDto, amountOriginal: '20' });
    expect(res.amountBase).toBe('18');
    expect(res.isFullReset).toBe(false);
    expect(res.directionWarning).toBe(false);
    expect(res.outstandingBefore).toBe('45');
  });

  it('warns when the payer is not the debtor (wrong direction)', async () => {
    // outstanding negative → `from` is actually owed; paying creates reverse debt.
    const { service } = build({
      convert: { amount: '45', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '-10',
    });
    const res = await service.create('hh1', 'bob', baseDto);
    expect(res.directionWarning).toBe(true);
    expect(res.isFullReset).toBe(false);
  });

  it('rejects a settlement between the same user', async () => {
    const { service } = build({
      convert: { amount: '45', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '45',
    });
    await expect(
      service.create('hh1', 'bob', { ...baseDto, toUserId: 'bob' }),
    ).rejects.toThrow();
  });

  it('rejects a future payment date', async () => {
    const { service } = build({
      convert: { amount: '45', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '45',
    });
    await expect(
      service.create('hh1', 'bob', { ...baseDto, paymentDate: '2999-01-01' }),
    ).rejects.toThrow();
  });

  // SEC-04: every money-affecting settlement write records the actor.
  it('writes an audit_log row for the settlement create (actor + after)', async () => {
    const { service, prisma } = build({
      convert: { amount: '45', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '45',
    });
    await service.create('hh1', 'bob', baseDto);
    const auditCreate = (prisma as unknown as {
      auditLog: { create: jest.Mock };
    }).auditLog.create;
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const arg = auditCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('settlement.created');
    expect(arg.data.entity).toBe('settlement');
    expect(arg.data.actorUserId).toBe('bob');
    expect(arg.data.entityId).toBe('s1');
    expect(arg.data.after).toBeDefined();
  });

  // SEC-11: a category from another household / a private category is rejected.
  it('rejects a settlement whose category is not in the household', async () => {
    const { service, prisma } = build({
      convert: { amount: '45', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '45',
    });
    (prisma as unknown as {
      category: { findUnique: jest.Mock };
    }).category.findUnique.mockResolvedValueOnce({ householdId: 'other-hh', userId: null });
    await expect(service.create('hh1', 'bob', baseDto)).rejects.toThrow(
      /not available in this household/,
    );
  });

  // SEC-11: a global shared default category (householdId=null,userId=null) is allowed.
  it('accepts a global shared default category', async () => {
    const { service, prisma } = build({
      convert: { amount: '45', rate: '0.9', rateDate: '2026-03-13', source: 'frankfurter' },
      outstanding: '45',
    });
    (prisma as unknown as {
      category: { findUnique: jest.Mock };
    }).category.findUnique.mockResolvedValueOnce({ householdId: null, userId: null });
    const res = await service.create('hh1', 'bob', baseDto);
    expect(res.amountBase).toBe('45');
  });
});
