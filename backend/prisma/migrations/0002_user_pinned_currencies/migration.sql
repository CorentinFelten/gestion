-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinned_currencies" TEXT[] DEFAULT ARRAY[]::TEXT[];

