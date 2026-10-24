-- Company-wide People settings (docs/people/02-PRD.md CORE-03, D-02): one row per company.
CREATE TABLE "PeopleSetting" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "selfServiceChanges" TEXT NOT NULL DEFAULT 'CONTACT_DIRECT',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PeopleSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PeopleSetting_orgId_key" ON "PeopleSetting"("orgId");
