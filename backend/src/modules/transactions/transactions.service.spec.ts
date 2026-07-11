import { Decimal } from 'decimal.js';
import { TransactionsService } from './transactions.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FxService } from '../fx/fx.service';
import type { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';

/**
 * SEC-04 (audit log + creator/admin-only mutation), SEC-10 (upload metadata
 * hardening) and SEC-11 (household-scoped category) for the shared ledger, with
 * a MOCKED PrismaService + FxService (no network, no DB).
 */

/** A Prisma-like Transaction row (Decimals + Dates), overridable per test. */
function txnRow(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    householdId: 'hh1',
    payerUserId: 'alice',
    description: 'Groceries',
    categoryId: 'cat1',
    notes: null,
    amountOriginal: new Decimal('100'),
    currencyOriginal: 'USD',
    paymentDate: new Date('2026-03-14T00:00:00.000Z'),
    baseCurrency: 'EUR',
    fxRate: new Decimal('0.9'),
    fxRateDate: new Date('2026-03-13T00:00:00.000Z'),
    fxSource: 'frankfurter',
    amountBase: new Decimal('90'),
    createdById: 'alice',
    createdAt: new Date('2026-03-14T10:00:00.000Z'),
    updatedAt: new Date('2026-03-14T10:00:00.000Z'),
    deletedAt: null,
    splits: [
      { id: 'sp1', userId: 'alice', splitType: 'equal', shareValue: new Decimal('1'), amountBase: new Decimal('45') },
      { id: 'sp2', userId: 'bob', splitType: 'equal', shareValue: new Decimal('1'), amountBase: new Decimal('45') },
    ],
    ...over,
  };
}

function build(cfg: {
  member?: unknown; // householdMember.findUnique result
  members?: string[]; // householdMember.findMany participants
  existing?: unknown; // transaction.findFirst result
  category?: unknown; // category.findUnique result
  created?: unknown; // transaction.create result
  updated?: unknown; // transaction.update (inside $transaction) result
} = {}) {
  const auditCreate = jest.fn().mockResolvedValue({ id: 'a1' });
  const attachmentCreate = jest.fn().mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'att1',
        transactionId: data.transactionId,
        filename: data.filename,
        mime: data.mime,
        size: data.size,
        createdAt: new Date('2026-03-14T10:00:00.000Z'),
      }),
  );
  const memberIds = cfg.members ?? ['alice', 'bob'];
  const updatedRow = cfg.updated ?? txnRow();

  const prisma = {
    household: { findUnique: jest.fn().mockResolvedValue({ baseCurrency: 'EUR' }) },
    householdMember: {
      findUnique: jest.fn().mockResolvedValue(
        Object.prototype.hasOwnProperty.call(cfg, 'member')
          ? cfg.member
          : { role: 'member', userId: 'x' },
      ),
      findMany: jest.fn().mockResolvedValue(memberIds.map((userId) => ({ userId }))),
    },
    category: {
      findUnique: jest.fn().mockResolvedValue(cfg.category ?? { householdId: 'hh1', userId: null }),
    },
    transaction: {
      findFirst: jest.fn().mockResolvedValue(cfg.existing ?? null),
      create: jest.fn().mockResolvedValue(cfg.created ?? txnRow()),
      update: jest.fn().mockResolvedValue(updatedRow),
    },
    attachment: { create: attachmentCreate },
    auditLog: { create: auditCreate },
    $transaction: jest.fn().mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          transactionSplit: { deleteMany: jest.fn().mockResolvedValue({}) },
          transaction: { update: jest.fn().mockResolvedValue(updatedRow) },
        }),
    ),
  } as unknown as PrismaService;

  const fx = {
    convert: jest.fn().mockResolvedValue({
      amount: new Decimal('90'),
      rate: new Decimal('0.9'),
      rateDate: '2026-03-13',
      source: 'frankfurter',
    }),
  } as unknown as FxService;

  return { service: new TransactionsService(prisma, fx), prisma, fx, auditCreate, attachmentCreate };
}

const createDto: CreateTransactionDto = {
  payerUserId: 'alice',
  description: 'Groceries',
  categoryId: 'cat1',
  notes: null,
  amountOriginal: '100',
  currencyOriginal: 'USD',
  paymentDate: '2026-03-14',
  splits: [
    { userId: 'alice', splitType: 'equal', shareValue: '0' },
    { userId: 'bob', splitType: 'equal', shareValue: '0' },
  ],
  linkToAccountId: null,
};

describe('TransactionsService, SEC-04 audit log', () => {
  it('writes an audit row on create (actor + after, before null)', async () => {
    const { service, auditCreate } = build();
    await service.create('hh1', 'alice', createDto);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const arg = auditCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('transaction.created');
    expect(arg.data.entity).toBe('transaction');
    expect(arg.data.actorUserId).toBe('alice');
    expect(arg.data.entityId).toBe('t1');
    expect(arg.data.before ?? null).toBeNull();
    expect(arg.data.after).toBeDefined();
  });

  it('writes an audit row on update (before + after captured)', async () => {
    const { service, auditCreate } = build({ existing: txnRow() });
    const dto: UpdateTransactionDto = { description: 'New name' };
    await service.update('t1', 'alice', dto);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const arg = auditCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('transaction.updated');
    expect(arg.data.actorUserId).toBe('alice');
    expect(arg.data.before).toBeDefined();
    expect(arg.data.after).toBeDefined();
  });

  it('writes an audit row on delete (prior state as before)', async () => {
    const { service, auditCreate } = build({ existing: txnRow() });
    await service.remove('t1', 'alice');
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const arg = auditCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('transaction.deleted');
    expect(arg.data.before).toBeDefined();
    expect(arg.data.after ?? null).toBeNull();
  });
});

describe('TransactionsService, SEC-04 mutation authorization', () => {
  it('allows the creator/payer to update their own transaction', async () => {
    // caller alice IS the creator/payer, only a plain member.
    const { service } = build({ existing: txnRow(), member: { role: 'member' } });
    await expect(service.update('t1', 'alice', { description: 'x' })).resolves.toBeDefined();
  });

  it('allows a household admin to update another member’s transaction', async () => {
    const { service } = build({ existing: txnRow(), member: { role: 'admin' } });
    await expect(service.update('t1', 'carol', { description: 'x' })).resolves.toBeDefined();
  });

  it('forbids a non-creator, non-admin member from updating another’s transaction', async () => {
    const { service } = build({ existing: txnRow(), member: { role: 'member' } });
    await expect(service.update('t1', 'carol', { description: 'x' })).rejects.toThrow();
  });

  it('forbids a non-creator, non-admin member from deleting another’s transaction', async () => {
    const { service } = build({ existing: txnRow(), member: { role: 'member' } });
    await expect(service.remove('t1', 'carol')).rejects.toThrow();
  });

  it('hides a transaction from a non-member on mutate (404)', async () => {
    const { service } = build({ existing: txnRow(), member: null });
    await expect(service.update('t1', 'carol', { description: 'x' })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('TransactionsService, SEC-11 category scope', () => {
  it('rejects a category from another household on create', async () => {
    const { service } = build({ category: { householdId: 'other-hh', userId: null } });
    await expect(service.create('hh1', 'alice', createDto)).rejects.toThrow(
      /not available in this household/,
    );
  });

  it('rejects a private/personal category on create', async () => {
    const { service } = build({ category: { householdId: null, userId: 'alice' } });
    await expect(service.create('hh1', 'alice', createDto)).rejects.toThrow(
      /not available in this household/,
    );
  });

  it('accepts a global shared default category on create', async () => {
    const { service } = build({ category: { householdId: null, userId: null } });
    await expect(service.create('hh1', 'alice', createDto)).resolves.toBeDefined();
  });
});

describe('TransactionsService, SEC-10 attachment hardening', () => {
  const okTxn = { id: 't1', householdId: 'hh1' };

  it('rejects a disallowed MIME type (400)', async () => {
    const { service } = build({ existing: okTxn, member: { userId: 'alice' } });
    await expect(
      service.addAttachment('t1', 'alice', {
        originalname: 'evil.html',
        mimetype: 'text/html',
        size: 10,
        path: '/data/uploads/abc123',
      }),
    ).rejects.toThrow(/Unsupported attachment type/);
  });

  it('rejects an oversize upload (400)', async () => {
    const { service } = build({ existing: okTxn, member: { userId: 'alice' } });
    await expect(
      service.addAttachment('t1', 'alice', {
        originalname: 'big.png',
        mimetype: 'image/png',
        size: 5 * 1024 * 1024 + 1,
        path: '/data/uploads/abc123',
      }),
    ).rejects.toThrow(/maximum allowed size/);
  });

  it('sanitizes the client filename (strips path components)', async () => {
    const { service, attachmentCreate } = build({ existing: okTxn, member: { userId: 'alice' } });
    await service.addAttachment('t1', 'alice', {
      originalname: '../../etc/passwd',
      mimetype: 'application/pdf',
      size: 100,
      path: '/data/uploads/deadbeef',
    });
    const arg = attachmentCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.filename).toBe('passwd');
    // The persisted path is the randomized on-disk path, never the client name.
    expect(arg.data.storagePath).toBe('/data/uploads/deadbeef');
  });
});
