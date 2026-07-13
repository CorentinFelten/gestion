-- Sliding idle timeout for sessions: track the last registered activity so a
-- session can be revoked a fixed window (default 30 min) after it goes idle,
-- independent of its absolute expiry. Existing rows are backfilled to the
-- migration time (they then idle-expire normally on the next window).
ALTER TABLE "sessions" ADD COLUMN "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "sessions_last_activity_at_idx" ON "sessions"("last_activity_at");
