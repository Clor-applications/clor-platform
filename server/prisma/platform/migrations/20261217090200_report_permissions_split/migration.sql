-- Reports split into one permission per group (Books, 14 Nov 2026).
--
-- Before, every report outside the financial statements and GST returns sat
-- behind REPORTS::Sales Reports. Books now gates each group on its own
-- permission (Purchase Reports, Inventory Reports, …). Stock roles made from
-- here on carry them from the catalogue; a role that exists already would lose
-- every group but Sales the day this ships. So whatever a role could do with
-- Sales Reports (VIEW, EXPORT) it can now do with each new group, and an
-- administrator narrows it from the roles screen if they want to.

-- Role and RolePermission force row-level security: without the bypass the
-- copy below would read no rows and grant nothing.
SET clor.bypass = 'on';

INSERT INTO "Permission" ("id", "module", "subModule", "action")
SELECT gen_random_uuid()::text, 'REPORTS', g."subModule", a."action"
FROM (VALUES ('Purchase Reports'), ('Inventory Reports'), ('Expense Reports'), ('Receipt Reports'),
             ('Payment Reports'), ('Ledger Reports'), ('Outstanding Registers'), ('GST Reports'),
             ('TDS Reports'), ('TCS Reports')) AS g("subModule")
CROSS JOIN (VALUES ('VIEW'), ('EXPORT')) AS a("action")
ON CONFLICT ("module", "subModule", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "accountId", "orgId", "roleId", "permissionId", "allowed", "permLevel")
SELECT gen_random_uuid()::text, rp."accountId", rp."orgId", rp."roleId", np."id", true, rp."permLevel"
FROM "RolePermission" rp
JOIN "Permission" h ON h."id" = rp."permissionId" AND h."module" = 'REPORTS' AND h."subModule" = 'Sales Reports'
JOIN "Permission" np ON np."module" = 'REPORTS' AND np."action" = h."action"
  AND np."subModule" IN ('Purchase Reports', 'Inventory Reports', 'Expense Reports', 'Receipt Reports',
                         'Payment Reports', 'Ledger Reports', 'Outstanding Registers', 'GST Reports',
                         'TDS Reports', 'TCS Reports')
WHERE rp."allowed"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

RESET clor.bypass;
