-- Batch 5: API keys move from Attendance → Integrations to Company admin →
-- Credentials (SETTINGS::Credentials). Whoever manages integration keys today
-- keeps doing so — revoking included — on the new page.
--
-- Permission rows are otherwise made lazily at sign-in, after migrations run,
-- so the three this grant needs are made here first.
SET clor.bypass = 'on';

INSERT INTO "Permission" ("id", "module", "subModule", "action")
SELECT gen_random_uuid()::text, 'SETTINGS', 'Credentials', a
FROM unnest(ARRAY['VIEW', 'CREATE', 'EDIT']) AS a
ON CONFLICT ("module", "subModule", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "accountId", "orgId", "roleId", "permissionId", "allowed", "permLevel")
SELECT gen_random_uuid()::text, r."accountId", r."orgId", r."roleId", p.id, true, 0
FROM (
  SELECT DISTINCT rp."accountId", rp."orgId", rp."roleId"
  FROM "RolePermission" rp
  JOIN "Permission" old ON old.id = rp."permissionId"
  WHERE old."module" = 'ATTENDANCE' AND old."subModule" = 'Attendance Integrations' AND old."action" IN ('CREATE', 'EDIT') AND rp."allowed"
) r
CROSS JOIN "Permission" p
WHERE p."module" = 'SETTINGS' AND p."subModule" = 'Credentials' AND p."action" IN ('VIEW', 'CREATE', 'EDIT')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

RESET clor.bypass;
