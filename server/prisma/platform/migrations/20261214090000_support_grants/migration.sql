-- Support grants: how a member of CLOR staff reaches a customer's company.
-- Additive. Nothing reads this table until the grant check ships with it.
CREATE TABLE "SupportGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ticketRef" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "endedByUserId" TEXT,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportGrant_accountId_status_idx" ON "SupportGrant"("accountId", "status");
CREATE INDEX "SupportGrant_orgId_operatorUserId_idx" ON "SupportGrant"("orgId", "operatorUserId");
CREATE INDEX "SupportGrant_operatorUserId_status_idx" ON "SupportGrant"("operatorUserId", "status");

-- Tenant isolation, fail-closed, the same shape OutsideAccess carries. A grant
-- belongs to the company it opens. The lookups that must cross companies — an
-- operator's own grants, the console's list — say so through clor.bypass.
ALTER TABLE "SupportGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportGrant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupportGrant";
CREATE POLICY tenant_isolation ON "SupportGrant"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
