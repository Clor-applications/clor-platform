-- Talent tables fail closed (A-35, 20261024100000_rls_fail_closed). The talent migration
-- created their tenant_isolation policies in the old form, which let a connection that
-- named no company see every company's openings, candidates, reviews and one-on-ones.
-- Rewritten here to the form every other People table has: a row shows only for its own
-- company, or to background work with `clor.bypass` on. Policies only; safe to run twice.

ALTER TABLE "JobOpening" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobOpening" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JobOpening";
CREATE POLICY tenant_isolation ON "JobOpening"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Candidate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Candidate";
CREATE POLICY tenant_isolation ON "Candidate"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "CandidateEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CandidateEvent";
CREATE POLICY tenant_isolation ON "CandidateEvent"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "Interview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Interview" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Interview";
CREATE POLICY tenant_isolation ON "Interview"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "InterviewFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InterviewFeedback" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InterviewFeedback";
CREATE POLICY tenant_isolation ON "InterviewFeedback"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Goal";
CREATE POLICY tenant_isolation ON "Goal"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "GoalCheckIn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoalCheckIn" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GoalCheckIn";
CREATE POLICY tenant_isolation ON "GoalCheckIn"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "ReviewCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewCycle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReviewCycle";
CREATE POLICY tenant_isolation ON "ReviewCycle"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Review";
CREATE POLICY tenant_isolation ON "Review"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "ImprovementPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImprovementPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ImprovementPlan";
CREATE POLICY tenant_isolation ON "ImprovementPlan"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "TalentNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TalentNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TalentNote";
CREATE POLICY tenant_isolation ON "TalentNote"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "OneOnOne" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OneOnOne" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OneOnOne";
CREATE POLICY tenant_isolation ON "OneOnOne"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "Training" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Training" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Training";
CREATE POLICY tenant_isolation ON "Training"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "TrainingSeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingSeat" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TrainingSeat";
CREATE POLICY tenant_isolation ON "TrainingSeat"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
