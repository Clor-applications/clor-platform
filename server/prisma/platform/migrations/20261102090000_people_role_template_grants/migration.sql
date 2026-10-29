-- Two grants the People role templates were missing, given to the roles made
-- from those templates before this change.
--
-- 1. People audit 30 Oct 2026, gap 3: HR User, HR Manager and Team Manager gave
--    My attendance VIEW only, so the person saw "Ask for leave" and "Check in"
--    and the server refused both (they need CREATE).
-- 2. People Talent (PR #67): a team manager's goals, reviews and improvement
--    plans for their own team need Performance VIEW, which Team Manager lacked.
--
-- Only a role that is still exactly the old template is changed: same name,
-- same team-only setting, and the same set of permissions, no more and no
-- fewer. The roles screen deletes a permission an administrator unticks (it
-- writes no refusal row), so "still the template" is the only safe sign that
-- nobody chose otherwise. A role anyone has changed, or one made from an older
-- version of the template, is left as it is; its administrator adds the right
-- on the roles screen if they want it.
--
-- One statement, so the first grant cannot change which roles the second one
-- sees. Permission rows are otherwise made lazily at sign-in, after migrations
-- run, so the two this needs are made here first.
SET clor.bypass = 'on';

INSERT INTO "Permission" ("id", "module", "subModule", "action")
VALUES
  (gen_random_uuid()::text, 'ATTENDANCE', 'My Attendance', 'CREATE'),
  (gen_random_uuid()::text, 'PEOPLE', 'Performance', 'VIEW')
ON CONFLICT ("module", "subModule", "action") DO NOTHING;

WITH old_template ("name", "module", "subModule", "action") AS (
  -- The three templates as they were before this change (permissionCatalog.ts).
  VALUES
    ('hr user', 'ATTENDANCE', 'Attendance Requests', 'CREATE'),
    ('hr user', 'ATTENDANCE', 'Attendance Requests', 'VIEW'),
    ('hr user', 'ATTENDANCE', 'Holidays', 'VIEW'),
    ('hr user', 'ATTENDANCE', 'Leave Requests', 'CREATE'),
    ('hr user', 'ATTENDANCE', 'Leave Requests', 'EDIT'),
    ('hr user', 'ATTENDANCE', 'Leave Requests', 'VIEW'),
    ('hr user', 'ATTENDANCE', 'Leave Types', 'VIEW'),
    ('hr user', 'ATTENDANCE', 'My Attendance', 'VIEW'),
    ('hr user', 'PEOPLE', 'Documents', 'CREATE'),
    ('hr user', 'PEOPLE', 'Documents', 'EDIT'),
    ('hr user', 'PEOPLE', 'Documents', 'VIEW'),
    ('hr user', 'PEOPLE', 'Employee Notes', 'CREATE'),
    ('hr user', 'PEOPLE', 'Employee Notes', 'EDIT'),
    ('hr user', 'PEOPLE', 'Employee Notes', 'VIEW'),
    ('hr user', 'PEOPLE', 'Employees', 'CREATE'),
    ('hr user', 'PEOPLE', 'Employees', 'EDIT'),
    ('hr user', 'PEOPLE', 'Employees', 'EXPORT'),
    ('hr user', 'PEOPLE', 'Employees', 'VIEW'),
    ('hr user', 'PEOPLE', 'Lifecycle', 'CREATE'),
    ('hr user', 'PEOPLE', 'Lifecycle', 'EDIT'),
    ('hr user', 'PEOPLE', 'Lifecycle', 'VIEW'),
    ('hr user', 'PEOPLE', 'Org Structure', 'VIEW'),
    ('hr user', 'PEOPLE', 'Policies', 'CREATE'),
    ('hr user', 'PEOPLE', 'Policies', 'EDIT'),
    ('hr user', 'PEOPLE', 'Policies', 'VIEW'),
    ('hr user', 'PEOPLE', 'Requests', 'APPROVE'),
    ('hr user', 'PEOPLE', 'Requests', 'CREATE'),
    ('hr user', 'PEOPLE', 'Requests', 'VIEW'),
    ('hr user', 'PEOPLE', 'Statutory Details', 'VIEW'),
    ('hr manager', 'ATTENDANCE', 'Attendance Requests', 'APPROVE'),
    ('hr manager', 'ATTENDANCE', 'Attendance Requests', 'CREATE'),
    ('hr manager', 'ATTENDANCE', 'Attendance Requests', 'VIEW'),
    ('hr manager', 'ATTENDANCE', 'Employee Portal', 'CREATE'),
    ('hr manager', 'ATTENDANCE', 'Employee Portal', 'DELETE'),
    ('hr manager', 'ATTENDANCE', 'Employee Portal', 'EDIT'),
    ('hr manager', 'ATTENDANCE', 'Employee Portal', 'VIEW'),
    ('hr manager', 'ATTENDANCE', 'Holidays', 'CREATE'),
    ('hr manager', 'ATTENDANCE', 'Holidays', 'DELETE'),
    ('hr manager', 'ATTENDANCE', 'Holidays', 'EDIT'),
    ('hr manager', 'ATTENDANCE', 'Holidays', 'VIEW'),
    ('hr manager', 'ATTENDANCE', 'Leave Requests', 'APPROVE'),
    ('hr manager', 'ATTENDANCE', 'Leave Requests', 'CREATE'),
    ('hr manager', 'ATTENDANCE', 'Leave Requests', 'EDIT'),
    ('hr manager', 'ATTENDANCE', 'Leave Requests', 'EXPORT'),
    ('hr manager', 'ATTENDANCE', 'Leave Requests', 'VIEW'),
    ('hr manager', 'ATTENDANCE', 'Leave Types', 'CREATE'),
    ('hr manager', 'ATTENDANCE', 'Leave Types', 'DELETE'),
    ('hr manager', 'ATTENDANCE', 'Leave Types', 'EDIT'),
    ('hr manager', 'ATTENDANCE', 'Leave Types', 'VIEW'),
    ('hr manager', 'ATTENDANCE', 'My Attendance', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Announcements', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Announcements', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Announcements', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Announcements', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Approvals', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Approvals', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Approvals', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Approvals', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Assets', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Assets', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Assets', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Assets', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Benefits', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Benefits', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Benefits', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Benefits', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Confidential Documents', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Confidential Documents', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Confidential Documents', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Confidential Documents', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Documents', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Documents', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Documents', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Documents', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Employee Notes', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Employee Notes', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Employee Notes', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Employee Notes', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Employees', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Employees', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Employees', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Employees', 'EXPORT'),
    ('hr manager', 'PEOPLE', 'Employees', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Events', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Events', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Events', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Events', 'VIEW'),
    ('hr manager', 'PEOPLE', 'HR Cases', 'CREATE'),
    ('hr manager', 'PEOPLE', 'HR Cases', 'DELETE'),
    ('hr manager', 'PEOPLE', 'HR Cases', 'EDIT'),
    ('hr manager', 'PEOPLE', 'HR Cases', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Learning', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Learning', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Learning', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Learning', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Lifecycle', 'APPROVE'),
    ('hr manager', 'PEOPLE', 'Lifecycle', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Lifecycle', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Lifecycle', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Org Structure', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Org Structure', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Org Structure', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Org Structure', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Performance', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Performance', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Performance', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Performance', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Recruitment', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Recruitment', 'DELETE'),
    ('hr manager', 'PEOPLE', 'Recruitment', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Recruitment', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Requests', 'APPROVE'),
    ('hr manager', 'PEOPLE', 'Requests', 'CREATE'),
    ('hr manager', 'PEOPLE', 'Requests', 'VIEW'),
    ('hr manager', 'PEOPLE', 'Statutory Details', 'EDIT'),
    ('hr manager', 'PEOPLE', 'Statutory Details', 'VIEW'),
    ('team manager', 'ATTENDANCE', 'Attendance Requests', 'APPROVE'),
    ('team manager', 'ATTENDANCE', 'Attendance Requests', 'VIEW'),
    ('team manager', 'ATTENDANCE', 'Leave Requests', 'APPROVE'),
    ('team manager', 'ATTENDANCE', 'Leave Requests', 'VIEW'),
    ('team manager', 'ATTENDANCE', 'My Attendance', 'VIEW'),
    ('team manager', 'PEOPLE', 'Documents', 'VIEW'),
    ('team manager', 'PEOPLE', 'Employees', 'VIEW'),
    ('team manager', 'PEOPLE', 'Lifecycle', 'EDIT'),
    ('team manager', 'PEOPLE', 'Lifecycle', 'VIEW'),
    ('team manager', 'PEOPLE', 'Org Structure', 'VIEW'),
    ('team manager', 'PEOPLE', 'Policies', 'VIEW'),
    ('team manager', 'PEOPLE', 'Requests', 'APPROVE'),
    ('team manager', 'PEOPLE', 'Requests', 'CREATE'),
    ('team manager', 'PEOPLE', 'Requests', 'VIEW')
),
held AS (
  SELECT rp."roleId", p."module", p."subModule", p."action"
  FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE rp."allowed"
),
still_template AS (
  SELECT r."id", r."accountId", r."orgId", lower(r."name") AS "name"
  FROM "Role" r
  WHERE lower(r."name") IN ('hr user', 'hr manager', 'team manager')
    AND r."ownDocumentsOnly" = (lower(r."name") = 'team manager')
    AND NOT EXISTS (
      SELECT 1 FROM held h
      WHERE h."roleId" = r."id"
        AND NOT EXISTS (SELECT 1 FROM old_template t WHERE t."name" = lower(r."name") AND t."module" = h."module" AND t."subModule" = h."subModule" AND t."action" = h."action")
    )
    AND NOT EXISTS (
      SELECT 1 FROM old_template t
      WHERE t."name" = lower(r."name")
        AND NOT EXISTS (SELECT 1 FROM held h WHERE h."roleId" = r."id" AND h."module" = t."module" AND h."subModule" = t."subModule" AND h."action" = t."action")
    )
)
INSERT INTO "RolePermission" ("id", "accountId", "orgId", "roleId", "permissionId", "allowed", "permLevel")
SELECT gen_random_uuid()::text, r."accountId", r."orgId", r."id", p."id", true, 0
FROM still_template r
JOIN "Permission" p
  ON (p."module" = 'ATTENDANCE' AND p."subModule" = 'My Attendance' AND p."action" = 'CREATE')
  OR (r."name" = 'team manager' AND p."module" = 'PEOPLE' AND p."subModule" = 'Performance' AND p."action" = 'VIEW')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

RESET clor.bypass;
