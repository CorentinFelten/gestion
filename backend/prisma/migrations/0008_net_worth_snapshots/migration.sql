-- CreateTable
CREATE TABLE "net_worth_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total_base" DECIMAL(20,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "net_worth_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "net_worth_snapshots_user_id_snapshot_date_key" ON "net_worth_snapshots"("user_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "net_worth_snapshots_user_id_snapshot_date_idx" ON "net_worth_snapshots"("user_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
