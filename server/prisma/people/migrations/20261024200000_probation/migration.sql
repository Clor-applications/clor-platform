-- Probation reviews and the confirmation date (docs/people/02-PRD.md LIFE-03).
ALTER TABLE "Employee" ADD COLUMN "confirmedOn" TEXT;
CREATE TABLE "ProbationReview" (
    "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "orgId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL, "goals" TEXT, "observations" TEXT, "recommendation" TEXT, "newEndDate" TEXT, "note" TEXT,
    "requestId" TEXT, "outcome" TEXT, "decidedByUserId" TEXT, "decidedAt" TIMESTAMP(3), "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProbationReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProbationReview_orgId_employeeId_createdAt_idx" ON "ProbationReview"("orgId", "employeeId", "createdAt");
