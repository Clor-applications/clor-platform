-- Joining & Leaving (docs/people/design-v1/JOINING-LEAVING-DECISIONS.md).
-- Additive: nullable columns and defaults on ChecklistTask, no data rewritten.
--   offsetDays, workingDays: how the due date was counted, so a moved joining
--     date or last day moves the open tasks with it.
--   needsNote: the task closes only with a note (a payment reference, an asset tag).
--   system, systemState, systemRefs: work CLOR does itself and must see
--     confirmed (reader removal: WAITING until every reader answers, CONFIRMED,
--     or FAILED for a person to close by hand), with the command ids it waits on.
--   remindedOn: the last day this task went into its owner's digest.

ALTER TABLE "ChecklistTask" ADD COLUMN "offsetDays" INTEGER;
ALTER TABLE "ChecklistTask" ADD COLUMN "workingDays" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChecklistTask" ADD COLUMN "needsNote" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChecklistTask" ADD COLUMN "system" TEXT;
ALTER TABLE "ChecklistTask" ADD COLUMN "systemState" TEXT;
ALTER TABLE "ChecklistTask" ADD COLUMN "systemRefs" JSONB;
ALTER TABLE "ChecklistTask" ADD COLUMN "remindedOn" TEXT;

CREATE INDEX "ChecklistTask_orgId_system_systemState_idx" ON "ChecklistTask"("orgId", "system", "systemState");
