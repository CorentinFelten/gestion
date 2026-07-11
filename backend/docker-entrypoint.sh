#!/bin/sh
set -e

# Apply pending migrations idempotently on startup (PLAN.md §8). The schema is
# fully described by the migration history in prisma/migrations, so there is
# always a migration to apply. If deploy fails we exit non-zero (fail loud, via
# `set -e`) instead of silently `db push`-ing, which could drift the live schema
# away from the recorded migration history.
echo "[entrypoint] Running prisma migrate deploy..."
npx prisma migrate deploy
echo "[entrypoint] Migrations applied."

echo "[entrypoint] Starting backend..."
exec node dist/main.js
