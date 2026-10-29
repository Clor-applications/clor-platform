-- Two grants the People role templates were missing.
--
-- 1. People audit 30 Oct 2026, gap 3: the HR User, HR Manager and Team Manager
-- templates gave My attendance VIEW only, so the person saw "Ask for leave" and
-- "Check in" and the server refused both (they need CREATE). The templates now
-- carry CREATE; this brings the roles already made from them up to the same.
--
-- Only roles still named as the template and still holding My attendance VIEW
-- are touched. A role with an explicit row for CREATE (allowed or not) is left
-- as its administrator set it (ON CONFLICT DO NOTHING).
--
-- Permission rows are otherwise made lazily at sign-in, after migrations run,
-- so the one this needs is made here first.
SET clor.bypass = 'on';

INSERT INTO "Permission" ("id", "module", "subModule", "action")
VALUES (gen_random_uuid()::text, 'ATTENDANCE', 'My Attendance', 'CREATE')
ON CONFLICT ("module", "subModule", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "accountId", "orgId", "roleId", "permissionId", "allowed", "permLevel")
SELECT gen_random_uuid()::text, r."accountId", r."orgId", r."id", p."id", true, 0
FROM "Role" r
JOIN "RolePermission" held ON held."roleId" = r."id" AND held."allowed"
JOIN "Permission" v ON v."id" = held."permissionId"
  AND v."module" = 'ATTENDANCE' AND v."subModule" = 'My Attendance' AND v."action" = 'VIEW'
CROSS JOIN "Permission" p
WHERE lower(r."name") IN ('hr user', 'hr manager', 'team manager')
  AND p."module" = 'ATTENDANCE' AND p."subModule" = 'My Attendance' AND p."action" = 'CREATE'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 2. People Talent (PR #67): a team manager's goals, reviews and improvement plans
-- for their own team need Performance VIEW, which the Team Manager template
-- lacked. Roles still named Team Manager and still holding the template's
-- People Employees VIEW get it, unless an explicit row already says otherwise.
INSERT INTO "Permission" ("id", "module", "subModule", "action")
VALUES (gen_random_uuid()::text, 'PEOPLE', 'Performance', 'VIEW')
ON CONFLICT ("module", "subModule", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "accountId", "orgId", "roleId", "permissionId", "allowed", "permLevel")
SELECT gen_random_uuid()::text, r."accountId", r."orgId", r."id", p."id", true, 0
FROM "Role" r
JOIN "RolePermission" held ON held."roleId" = r."id" AND held."allowed"
JOIN "Permission" v ON v."id" = held."permissionId"
  AND v."module" = 'PEOPLE' AND v."subModule" = 'Employees' AND v."action" = 'VIEW'
CROSS JOIN "Permission" p
WHERE lower(r."name") = 'team manager'
  AND p."module" = 'PEOPLE' AND p."subModule" = 'Performance' AND p."action" = 'VIEW'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

RESET clor.bypass;
