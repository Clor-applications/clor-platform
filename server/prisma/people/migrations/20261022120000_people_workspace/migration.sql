CREATE TABLE "PeopleRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "employeeId" TEXT,
  "dueDate" TEXT,
  "details" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PeopleRecord_accountId_orgId_kind_status_idx" ON "PeopleRecord"("accountId", "orgId", "kind", "status");
ALTER TABLE "PeopleRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PeopleRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PeopleRecord"
USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));
