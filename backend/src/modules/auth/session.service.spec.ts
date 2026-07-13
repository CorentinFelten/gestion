import { Logger } from '@nestjs/common';
import { SessionService } from './session.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Session lifecycle. The scheduled cleanup sweeps expired rows so abandoned
 * sessions don't accumulate forever (they were previously only removed on
 * logout / password-change).
 */
describe('SessionService', () => {
  function build(deleteResult = { count: 0 }) {
    const deleteMany = jest.fn().mockResolvedValue(deleteResult);
    const prisma = {
      session: { deleteMany },
    } as unknown as PrismaService;
    return { service: new SessionService(prisma), deleteMany };
  }

  it('purgeExpired deletes rows past their absolute expiry OR idle beyond the window', async () => {
    const { service, deleteMany } = build({ count: 3 });
    const now = new Date('2026-07-11T00:00:00.000Z');

    const purged = await service.purgeExpired(now);

    expect(purged).toBe(3);
    // 30-minute idle window before `now`.
    const idleCutoff = new Date(now.getTime() - 30 * 60 * 1000);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: { lt: now } }, { lastActivityAt: { lt: idleCutoff } }] },
    });
  });

  it('scheduled purge swallows errors (never crashes the cron)', async () => {
    const { service, deleteMany } = build();
    deleteMany.mockRejectedValueOnce(new Error('db down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.purgeExpiredScheduled()).resolves.toBeUndefined();

    jest.restoreAllMocks();
  });
});
