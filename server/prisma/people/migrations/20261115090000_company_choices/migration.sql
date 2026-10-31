-- Company choices (docs/people/workflow-engine/SPEC.md 3.2, 3.3, 3.5, 3.6): four of the six pending decisions
-- become company settings on PeopleSetting, which already has row-level security. Additive, with today's
-- behaviour as the default; correctionApproval is null until chosen here, so AttendanceSettings keeps deciding.
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "correctionApproval" TEXT;
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "hrSeesSalaryRevisions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "leavingsForReadOnly" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "leavingReasonForReadOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "withdrawnNotices" TEXT NOT NULL DEFAULT 'SHOW_WITHDRAWN';
