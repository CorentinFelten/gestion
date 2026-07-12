import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Real, shared database client. Feature agents inject this everywhere they
 * need DB access, do NOT instantiate PrismaClient directly elsewhere.
 *
 * Prisma 7 is engine-free: the client connects through the `pg` driver adapter
 * rather than a bundled Rust query engine. The adapter owns the connection pool,
 * so pool sizing is controlled via the `DATABASE_URL` (`?connection_limit=`) or
 * `pg` pool options here rather than a Prisma engine flag.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // The pg driver adapter owns the connection pool. `pg` sizes it via `max`
    // (Prisma's old `connection_limit` URL param is NOT read by the adapter),
    // so pool size is set here from DB_POOL_MAX (default 10 — pg's own default,
    // ample for a single-replica household LAN). Keep the total across replicas
    // under Postgres' max_connections (default 100).
    const poolMax = Number(process.env.DB_POOL_MAX) || 10;
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: poolMax }),
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
