-- AlterTable: credit-account payoff metadata (null except for credit-card accounts)
ALTER TABLE "accounts" ADD COLUMN "interest_rate" DECIMAL(9,6);
ALTER TABLE "accounts" ADD COLUMN "credit_limit" DECIMAL(20,6);
ALTER TABLE "accounts" ADD COLUMN "min_payment" DECIMAL(20,6);
