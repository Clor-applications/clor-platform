-- Attendance readers (platform audit, 11 Nov 2026): a company may name the network
-- addresses or ranges a reader's punches are accepted from. Empty (the default) = no
-- rule of its own, the network lock decides as before. Additive; no row changes.
ALTER TABLE "AttendanceDevice" ADD COLUMN "ipAllowList" TEXT[] DEFAULT ARRAY[]::TEXT[];
