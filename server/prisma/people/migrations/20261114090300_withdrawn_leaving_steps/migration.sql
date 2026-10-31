-- A withdrawn leaving's steps get their own kind (lifecycle/stayOn.ts), so a later leaving starts a fresh plan.
--
-- Every LEAVING step of a withdrawn leaving moves, done or not, not only those closed with the withdrawal's
-- note. Within one stint (since the latest joining day, India time), every leaving plan made before the stint's
-- last withdrawal was withdrawn: a leaving that went through ends the stint. So a step moves when it was made
-- in the current stint, at or before that last withdrawal. Earlier stints' steps (a rehire) stay as they are.
-- Safe to run again: a moved step is no longer LEAVING.
--
-- Data only: ChecklistTask and Employee have row-level security, so this runs with the bypass on.
SET clor.bypass = 'on';

UPDATE "ChecklistTask" AS t
SET "kind" = 'LEAVING_WITHDRAWN'
FROM (
  SELECT w."orgId", w."employeeId", max(w."doneAt") AS "withdrawnAt"
  FROM "ChecklistTask" AS w
  WHERE w."kind" IN ('LEAVING', 'LEAVING_WITHDRAWN')
    AND w."note" = 'Not needed: leaving withdrawn.'
    AND w."doneAt" IS NOT NULL
  GROUP BY w."orgId", w."employeeId"
) AS x
JOIN "Employee" AS e ON e."id" = x."employeeId" AND e."orgId" = x."orgId"
WHERE t."orgId" = x."orgId"
  AND t."employeeId" = x."employeeId"
  AND t."kind" = 'LEAVING'
  AND t."createdAt" <= x."withdrawnAt"
  AND (
    e."dateOfJoining" IS NULL
    OR e."dateOfJoining" !~ '^\d{4}-\d{2}-\d{2}$'
    OR t."createdAt" >= (e."dateOfJoining"::date::timestamp - interval '330 minutes')
  );

RESET clor.bypass;
