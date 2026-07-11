-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'declined');

-- DropIndex
DROP INDEX "invites_token_key";

-- DropIndex
DROP INDEX "invites_email_idx";

-- AlterTable
ALTER TABLE "invites" DROP COLUMN "accepted_at",
DROP COLUMN "email",
DROP COLUMN "expires_at",
DROP COLUMN "token",
ADD COLUMN     "invited_by_id" TEXT NOT NULL,
ADD COLUMN     "invited_user_id" TEXT NOT NULL,
ADD COLUMN     "responded_at" TIMESTAMP(3),
ADD COLUMN     "status" "InviteStatus" NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "invites_invited_user_id_idx" ON "invites"("invited_user_id");

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

