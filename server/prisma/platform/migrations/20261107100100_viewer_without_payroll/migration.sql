-- The Viewer role no longer reads Payroll (audit 7 Nov 2026, #8).
--
-- The preset ("read-only across the product") granted VIEW on every module,
-- Payroll included: every payslip, CTC, payroll report and full PAN. The
-- preset now leaves Payroll out (permissionCatalog.ts VIEWER); this takes the
-- same grants back from the Viewer roles already made from it.
--
-- Only a role that still looks like the preset is changed: named Viewer, not an
-- administrator role, and holding nothing on Payroll but VIEW. A Viewer role
-- somebody also gave a Payroll create, edit or approve right was shaped on
-- purpose, and is left as it is. An administrator who wants a viewer to see
-- salaries gives them a Payroll role, or ticks the rights on the roles screen.
--
-- Role and RolePermission force row-level security, so without the bypass the
-- owner (clor_app at API start) would see no rows and change nothing.
SET clor.bypass = 'on';

WITH viewer AS (
  SELECT r."id"
  FROM "Role" r
  WHERE lower(r."name") = 'viewer'
    AND r."roleType" <> 'ADMIN'
    AND NOT EXISTS (
      SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId"
      WHERE rp."roleId" = r."id" AND rp."allowed" AND p."module" = 'PAYROLL' AND p."action" <> 'VIEW'
    )
)
DELETE FROM "RolePermission" rp
USING "Permission" p, viewer v
WHERE rp."permissionId" = p."id"
  AND rp."roleId" = v."id"
  AND p."module" = 'PAYROLL'
  AND p."action" = 'VIEW';

RESET clor.bypass;
