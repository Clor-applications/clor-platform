-- Compliance in one place (People audit 30 Oct 2026, gaps 10 and 16): an obligation
-- says where it came from (the rule library, Payroll's statutory deadlines, a work
-- site's registration, or the company's own), may be owned by someone outside CLOR,
-- keeps the challan or receipt number, and holds its proof files. Columns and a new
-- table only; safe to run twice.
ALTER TABLE "Obligation" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'RULE';
ALTER TABLE "Obligation" ADD COLUMN IF NOT EXISTS "ownerName" TEXT;
ALTER TABLE "Obligation" ADD COLUMN IF NOT EXISTS "reference" TEXT;
ALTER TABLE "Obligation" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;

CREATE TABLE IF NOT EXISTS "ObligationProof" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "data" BYTEA NOT NULL,
    "storageKey" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObligationProof_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ObligationProof_orgId_obligationId_idx" ON "ObligationProof"("orgId", "obligationId");
