-- Decision record (docs/people/02-PRD.md TRACE-05): what an approved change rested on, frozen when it was decided.
CREATE TABLE "DecisionRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "policyVersions" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DecisionRecord_requestId_key" ON "DecisionRecord"("requestId");
CREATE INDEX "DecisionRecord_orgId_employeeId_idx" ON "DecisionRecord"("orgId", "employeeId");

-- TRACE-03: a help desk request raised from the Why panel names the change it is about.
ALTER TABLE "DeskRequest" ADD COLUMN "changeRef" TEXT;
