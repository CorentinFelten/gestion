-- AlterTable
ALTER TABLE "users" ALTER COLUMN "locale" SET DEFAULT 'fr-FR';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "country" CHAR(2) NOT NULL DEFAULT 'FR';

