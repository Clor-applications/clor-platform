-- Night-work consent (review of PR #78, blocker 1): a company already using CLOR when the check arrives
-- is put on WARN, so no shift it plans is refused on deploy day: the shift is saved and whoever lacks
-- consent is listed on the Night work report and People Home. A company made after this keeps the
-- default, ENFORCE. HR can switch either way in Settings, Attendance rules. Every company that has
-- people gets a settings row if it had none. Safe to run twice: a mode already set is left alone.
SET clor.bypass = 'on';
INSERT INTO "AttendanceSettings" ("id", "accountId", "orgId", "timeRules", "updatedByUserId", "updatedAt")
SELECT 'nightwarn_' || md5(e."orgId"), e."accountId", e."orgId", '{"night":{"mode":"WARN"}}'::jsonb, 'system', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT ON ("orgId") "orgId", "accountId" FROM "Employee" ORDER BY "orgId", "createdAt") e
ON CONFLICT ("orgId") DO NOTHING;
UPDATE "AttendanceSettings"
SET "timeRules" = jsonb_set(
  COALESCE("timeRules", '{}'::jsonb),
  '{night}',
  COALESCE("timeRules"->'night', '{}'::jsonb) || '{"mode":"WARN"}'::jsonb
)
WHERE COALESCE("timeRules"->'night'->>'mode', '') = '';
RESET clor.bypass;
