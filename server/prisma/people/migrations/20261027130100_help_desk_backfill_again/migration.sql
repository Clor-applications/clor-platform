-- The first help-desk backfill (20261025010000) ran without the RLS bypass, so under a
-- non-superuser it copied nothing. Copied again, with the bypass; rows already copied are skipped.
SET clor.bypass = 'on';
INSERT INTO "DeskRequest" ("id", "accountId", "orgId", "employeeId", "category", "subject", "description", "urgency", "queue", "replyBy", "resolveBy", "status", "resolution", "resolvedAt", "createdAt", "updatedAt")
SELECT 'desk_' || r."id", r."accountId", r."orgId", r."employeeId",
       CASE COALESCE(r."details"->>'category', 'GENERAL') WHEN 'GENERAL' THEN 'OTHER' ELSE r."details"->>'category' END,
       r."title", COALESCE(r."details"->>'description', ''), COALESCE(r."details"->>'priority', 'NORMAL'),
       CASE COALESCE(r."details"->>'category', 'GENERAL') WHEN 'PAYROLL' THEN 'Payroll' ELSE 'HR' END,
       r."createdAt" + INTERVAL '1 day',
       COALESCE(to_timestamp(r."dueDate", 'YYYY-MM-DD'), r."createdAt" + INTERVAL '3 days'),
       CASE r."status" WHEN 'RESOLVED' THEN 'RESOLVED' WHEN 'CLOSED' THEN 'RESOLVED' ELSE 'OPEN' END,
       NULLIF(r."details"->>'resolution', ''),
       CASE WHEN r."status" IN ('RESOLVED', 'CLOSED') THEN r."updatedAt" ELSE NULL END,
       r."createdAt", r."updatedAt"
FROM "PeopleRecord" r
WHERE r."kind" = 'helpdesk' AND r."employeeId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
