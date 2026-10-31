-- Late marks "rounded" now round each mark DOWN to 15, 30 or 60 minutes, never up: rounding up cut more than the
-- time missed (Payment of Wages Act s.9(2), Code on Wages 2019 s.20). The mode is renamed TIME_MISSED_ROUNDED ->
-- TIME_MISSED_ROUNDED_DOWN in the company settings and in every saved rule version, so a past month worked out
-- again uses round-down too (services/attendance/timeRules.ts reads a stray old value as round-down as well).
-- Both tables have row-level security, so with the bypass on. Safe to run again: the old value, with its closing
-- quote, no longer matches once rewritten.
SET clor.bypass = 'on';

UPDATE "AttendanceSettings"
SET "timeRules" = jsonb_set("timeRules", '{marks,cutMode}', '"TIME_MISSED_ROUNDED_DOWN"'::jsonb)
WHERE "timeRules" #>> '{marks,cutMode}' = 'TIME_MISSED_ROUNDED';

UPDATE "AttendanceRuleVersion"
SET "rulesJson" = replace("rulesJson", '"cutMode":"TIME_MISSED_ROUNDED"', '"cutMode":"TIME_MISSED_ROUNDED_DOWN"')
WHERE "rulesJson" LIKE '%"cutMode":"TIME_MISSED_ROUNDED"%';

RESET clor.bypass;
