-- Enforce the v1 single-household invariant at the DB level: a user may belong
-- to at most one household. Replaces the non-unique user_id index with a unique
-- one so concurrent invite-accepts / household-creates cannot race a user into
-- two households (the application check-then-write was a TOCTOU).
DROP INDEX "household_members_user_id_idx";
CREATE UNIQUE INDEX "household_members_user_id_key" ON "household_members"("user_id");
