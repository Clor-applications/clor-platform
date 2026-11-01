-- Attendance on the approval engine (docs/people/workflow-engine/SPEC.md section 9, phase 2d): one switch per
-- company, off by default. Off, attendance requests (missed punch, work from home, on duty, permission, shift
-- change), overtime and comp-off, and field punches are decided exactly as before and nothing new is written. On, a
-- new one opens an ApprovalRequest (sourceKind ATTENDANCE, OVERTIME or FIELD_PUNCH) under a preset rule made from
-- the stored chain; requests already waiting finish on the old path. Additive; PeopleSetting already has row-level
-- security, and an older API never reads this column.
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "attendanceOnEngine" BOOLEAN NOT NULL DEFAULT false;
