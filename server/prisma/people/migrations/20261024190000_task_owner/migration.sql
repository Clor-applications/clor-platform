-- Plan tasks name a person, not only a role (docs/people/02-PRD.md LIFE-02).
ALTER TABLE "ChecklistTask" ADD COLUMN "ownerUserId" TEXT;
CREATE INDEX "ChecklistTask_orgId_ownerUserId_doneAt_idx" ON "ChecklistTask"("orgId", "ownerUserId", "doneAt");
