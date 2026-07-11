import { ConflictException } from '@nestjs/common';
import { HouseholdsService } from './households.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UpdateHouseholdDto } from './dto/household.dto';

/**
 * Base-currency change guard: changing a household's base currency is only safe
 * on an empty ledger. Once any transaction or settlement exists, its frozen
 * `amount_base` is never re-converted, so a base-currency change would leave
 * history denominated in the old base while new rows freeze against the new one
 * (TallyService would then sum incompatible bases). The change must be rejected.
 */
describe('HouseholdsService.update, base-currency guard', () => {
  const now = new Date('2026-03-14T10:00:00.000Z');

  function build(opts: {
    baseCurrency: string;
    txnCount?: number;
    settlementCount?: number;
  }) {
    const auditCreate = jest.fn().mockResolvedValue({ id: 'a1' });
    const householdUpdate = jest.fn().mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'hh1',
          name: (data.name as string) ?? 'Home',
          baseCurrency: (data.baseCurrency as string) ?? opts.baseCurrency,
          createdById: 'u1',
          createdAt: now,
        }),
    );
    const prisma = {
      household: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'hh1',
          name: 'Home',
          baseCurrency: opts.baseCurrency,
          createdById: 'u1',
          createdAt: now,
        }),
        update: householdUpdate,
      },
      transaction: { count: jest.fn().mockResolvedValue(opts.txnCount ?? 0) },
      settlement: { count: jest.fn().mockResolvedValue(opts.settlementCount ?? 0) },
      householdMember: {
        findUnique: jest.fn().mockResolvedValue({ role: 'owner' }),
      },
      auditLog: { create: auditCreate },
    } as unknown as PrismaService;
    return { service: new HouseholdsService(prisma), prisma, auditCreate, householdUpdate };
  }

  it('rejects a base-currency change when transactions exist (409)', async () => {
    const { service, householdUpdate } = build({ baseCurrency: 'EUR', txnCount: 1 });
    const dto: UpdateHouseholdDto = { baseCurrency: 'CAD' };
    await expect(service.update('hh1', dto, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(householdUpdate).not.toHaveBeenCalled();
  });

  it('rejects a base-currency change when settlements exist (409)', async () => {
    const { service } = build({ baseCurrency: 'EUR', settlementCount: 2 });
    await expect(
      service.update('hh1', { baseCurrency: 'USD' }, 'u1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows a base-currency change on an empty ledger (audited)', async () => {
    const { service, auditCreate, householdUpdate } = build({ baseCurrency: 'EUR' });
    const result = await service.update('hh1', { baseCurrency: 'CAD' }, 'u1');
    expect(result.baseCurrency).toBe('CAD');
    expect(householdUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('household.base_currency_changed');
  });

  it('allows a name-only change even with existing transactions (no currency change)', async () => {
    const { service, householdUpdate, auditCreate } = build({ baseCurrency: 'EUR', txnCount: 5 });
    const result = await service.update('hh1', { name: 'New Name' }, 'u1');
    expect(result.name).toBe('New Name');
    expect(householdUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('is a no-op guard when the base currency is unchanged', async () => {
    const { service, householdUpdate, auditCreate } = build({ baseCurrency: 'EUR', txnCount: 5 });
    await expect(service.update('hh1', { baseCurrency: 'EUR' }, 'u1')).resolves.toBeDefined();
    expect(householdUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
