-- Ops Home queue (additive): a staff member's mark on one row. MINE says who is on it;
-- LATER puts the row away for that staff member until the next morning.
CREATE TABLE IF NOT EXISTS "OpsQueueMark" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsQueueMark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsQueueMark_key_kind_operatorUserId_key" ON "OpsQueueMark"("key", "kind", "operatorUserId");
CREATE INDEX IF NOT EXISTS "OpsQueueMark_kind_key_idx" ON "OpsQueueMark"("kind", "key");

-- CLOR staff's own, like the handover note: only the operator console,
-- which works outside any company through clor.bypass, sees them.
ALTER TABLE "OpsQueueMark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsQueueMark" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_only ON "OpsQueueMark";
CREATE POLICY staff_only ON "OpsQueueMark"
  USING (current_setting('clor.bypass', true) = 'on')
  WITH CHECK (current_setting('clor.bypass', true) = 'on');
