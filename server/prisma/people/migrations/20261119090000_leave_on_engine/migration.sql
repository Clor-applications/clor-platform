-- Leave on the approval engine (docs/people/workflow-engine/SPEC.md section 9, phase 2c-i): one switch per
-- company, off by default. Off, leave decides exactly as before and nothing new is written. On, a new leave
-- request on a simple chain opens an ApprovalRequest (sourceKind LEAVE) under a preset rule that seedPresets
-- makes from the stored chain; requests already waiting finish on the old path. Additive; PeopleSetting
-- already has row-level security, and an older API never reads this column.
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "leaveOnEngine" BOOLEAN NOT NULL DEFAULT false;
