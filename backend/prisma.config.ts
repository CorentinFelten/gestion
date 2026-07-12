import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * Prisma 7 removed the built-in Rust query engine: the runtime client now talks
 * to Postgres through the `pg` driver adapter (see `src/prisma/prisma.service.ts`),
 * and the connection URL for schema tooling (migrate / introspection) lives here
 * instead of in `schema.prisma`.
 *
 * We read `DATABASE_URL` directly off `process.env` (not the throwing `env()`
 * helper) so that `prisma generate` — which needs no database and runs at Docker
 * build time without a URL — does not fail. Migrate commands still require the
 * variable and will error clearly if it is unset.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
