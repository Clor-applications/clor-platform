-- Legal entities, establishments and future-dated job changes (docs/people/02-PRD.md FND-02, FND-07).
ALTER TABLE "Employee" ADD COLUMN "establishmentId" TEXT;
CREATE INDEX "Employee_accountId_orgId_establishmentId_idx" ON "Employee"("accountId", "orgId", "establishmentId");

CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pan" TEXT,
    "cin" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalEntity_orgId_name_key" ON "LegalEntity"("orgId", "name");

CREATE TABLE "Establishment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OFFICE',
    "state" TEXT,
    "address" TEXT,
    "registrations" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Establishment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Establishment_orgId_name_key" ON "Establishment"("orgId", "name");
CREATE INDEX "Establishment_orgId_state_idx" ON "Establishment"("orgId", "state");
ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ScheduledChange" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "fromLabel" TEXT,
    "toLabel" TEXT,
    "effectiveOn" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestId" TEXT,
    "requestedByUserId" TEXT,
    "correlationId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedRunId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduledChange_orgId_status_effectiveOn_idx" ON "ScheduledChange"("orgId", "status", "effectiveOn");
CREATE INDEX "ScheduledChange_orgId_employeeId_status_idx" ON "ScheduledChange"("orgId", "employeeId", "status");
