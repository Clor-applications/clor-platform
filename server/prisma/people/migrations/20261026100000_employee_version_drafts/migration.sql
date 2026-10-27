-- People design v1, Module 01 (EMP-02, EMP-04..06): a version to refuse stale edits (409),
-- the preferred name (PRD CORE-02), and add-employee drafts that are real and per user.
ALTER TABLE "Employee" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Employee" ADD COLUMN "preferredName" TEXT;

CREATE TABLE "EmployeeDraft" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeDraft_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeDraft_orgId_userId_idx" ON "EmployeeDraft"("orgId", "userId");
