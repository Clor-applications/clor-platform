-- A-48: one row per background-job run, so a scheduler that has stopped (no
-- recent run) or keeps failing is visible. Platform maintenance data with no
-- orgId, like JobLease: no row-level security.
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "worker" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "token" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL DEFAULT 'RUNNING',
    "counts" TEXT,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobRun_worker_startedAt_idx" ON "JobRun"("worker", "startedAt");
