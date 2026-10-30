-- A withdrawn leaving's steps get their own kind (lifecycle/stayOn.ts), so a later leaving starts a fresh plan.
-- Data only: ChecklistTask has row-level security, so this runs with the bypass on.
SET clor.bypass = 'on';
UPDATE "ChecklistTask" SET "kind" = 'LEAVING_WITHDRAWN' WHERE "kind" = 'LEAVING' AND "note" = 'Not needed: leaving withdrawn.';
