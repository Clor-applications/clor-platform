-- CreateTable
CREATE TABLE "TaxDeclaration" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'NEW',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "monthlyRent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "metroCity" BOOLEAN NOT NULL DEFAULT false,
    "landlordPan" TEXT,
    "seniorSelf" BOOLEAN NOT NULL DEFAULT false,
    "seniorParents" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxDeclaration_orgId_employeeId_financialYear_key" ON "TaxDeclaration"("orgId", "employeeId", "financialYear");
-- CreateIndex
CREATE INDEX "TaxDeclaration_accountId_orgId_financialYear_status_idx" ON "TaxDeclaration"("accountId", "orgId", "financialYear", "status");
