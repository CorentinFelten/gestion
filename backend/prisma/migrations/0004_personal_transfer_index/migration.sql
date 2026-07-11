-- CreateIndex
-- computeBalance() filters personal_transactions on transfer_account_id (the
-- destination leg of a transfer); index it to match the existing account_id
-- index and keep balance/net-worth reads fast.
CREATE INDEX "personal_transactions_transfer_account_id_idx" ON "personal_transactions"("transfer_account_id");
