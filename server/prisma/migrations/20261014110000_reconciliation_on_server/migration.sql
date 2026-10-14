-- Bank reconciliation kept on the server: a contra journal's reconciled state
-- and bank date, and the history of every bank-date change. Both lived only
-- in the browser and were lost on reload.
--
-- IF NOT EXISTS throughout: the test suite builds tables with `prisma db push`
-- and then replays this file for its policy.

ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "reconciled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "bankDate" TIMESTAMP(3);
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "statementRef" TEXT;

CREATE TABLE IF NOT EXISTS "BankDateAudit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "voucherNo" TEXT,
    "ledgerAccountId" TEXT,
    "transactionDate" TEXT NOT NULL,
    "previousBankDate" TEXT,
    "bankDate" TEXT,
    "action" TEXT NOT NULL,
    "statementRef" TEXT,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankDateAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankDateAudit_accountId_orgId_kind_sourceId_idx" ON "BankDateAudit"("accountId", "orgId", "kind", "sourceId");
CREATE INDEX IF NOT EXISTS "BankDateAudit_accountId_orgId_at_idx" ON "BankDateAudit"("accountId", "orgId", "at");

ALTER TABLE "BankDateAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankDateAudit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BankDateAudit";
CREATE POLICY tenant_isolation ON "BankDateAudit"
  USING (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  )
  WITH CHECK (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  );
