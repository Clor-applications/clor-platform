-- Server picks theme C (hiring and goals, round 53): every change only adds.
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "interviewQuestions" JSONB;
ALTER TABLE "JobPosition" ADD COLUMN IF NOT EXISTS "jobDescription" TEXT;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "heldReason" TEXT;
ALTER TABLE "JobOpening" ADD COLUMN IF NOT EXISTS "screeningQuestions" JSONB;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "screeningAnswers" JSONB;
ALTER TABLE "InterviewFeedback" ADD COLUMN IF NOT EXISTS "answers" JSONB;
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'TEAM';
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "forTeam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "companyGoalId" TEXT;

CREATE TABLE IF NOT EXISTS "CompanyGoal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "measure" TEXT,
    "dueDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CompanyGoal_orgId_status_idx" ON "CompanyGoal"("orgId", "status");

ALTER TABLE "CompanyGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyGoal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CompanyGoal";
-- Fails closed (20261024100000_rls_fail_closed): a row shows only for its own company, or to background work with the bypass on.
CREATE POLICY tenant_isolation ON "CompanyGoal"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
