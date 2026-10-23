-- A-43: a job lease with a fencing token and a heartbeat. The token goes up
-- on every take, so a run that lost its lease can tell; runningSince and
-- heartbeatAt say whether a run is in progress and whether it is still alive.
ALTER TABLE "JobLease" ADD COLUMN "token" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobLease" ADD COLUMN "runningSince" TIMESTAMP(3);
ALTER TABLE "JobLease" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
