import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { sessionIdleMs } from '../../common/session-timeouts';

export interface CreatedSession {
  id: string;
  expiresAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Server-side session lifecycle against the `sessions` table. Sessions are
 * opaque records; the cookie only carries the session id. The id is generated
 * from a CSPRNG (256-bit `randomBytes`, base64url-encoded) rather than the
 * schema's `cuid()` fallback, so it is unpredictable and not guessable. Each
 * login mints a brand-new record (rotation), we never reuse an id across logins.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get ttlMs(): number {
    const days = Number(process.env.SESSION_TTL_DAYS ?? 30);
    return (Number.isFinite(days) && days > 0 ? days : 30) * DAY_MS;
  }

  /** Create a fresh session for a user (rotation happens by always creating anew). */
  async create(userId: string, meta?: { userAgent?: string; ip?: string }): Promise<CreatedSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    // Session id = 256 bits of CSPRNG entropy (base64url), not Prisma's cuid()
    // default. cuid embeds a timestamp/counter/host fingerprint and is not
    // unpredictable enough for a bearer session token.
    const id = randomBytes(32).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        id,
        userId,
        expiresAt,
        lastActivityAt: now,
        userAgent: meta?.userAgent?.slice(0, 512),
        ip: meta?.ip,
      },
    });
    return { id: session.id, expiresAt: session.expiresAt };
  }

  /** Revoke a single session (logout). Idempotent, no error if already gone. */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  /** Revoke every session for a user (e.g. password change / deactivate). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /**
   * Sweep dead session rows: past their absolute expiry OR idle beyond the
   * sliding window. Sessions are otherwise only removed on logout/password-
   * change, so an abandoned session would linger; AuthGuard already rejects both
   * cases, so this is pure hygiene (returns the number purged for logs).
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const idleCutoff = new Date(now.getTime() - sessionIdleMs());
    const res = await this.prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { lastActivityAt: { lt: idleCutoff } }],
      },
    });
    return res.count;
  }

  /** Hourly cleanup of expired sessions (runs off @nestjs/schedule). */
  @Cron(CronExpression.EVERY_HOUR, { name: 'session-purge-expired' })
  async purgeExpiredScheduled(): Promise<void> {
    try {
      const purged = await this.purgeExpired();
      if (purged > 0) this.logger.log(`Purged ${purged} expired session(s)`);
    } catch (err) {
      this.logger.error(`Session purge failed: ${(err as Error).message}`);
    }
  }
}
