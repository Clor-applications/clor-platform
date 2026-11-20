-- Status incidents (additive): who at CLOR is handling it, and which customer
-- accounts are known to be hit. Both stay inside Ops; clor.in/status never shows them.
ALTER TABLE "StatusIncident" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
ALTER TABLE "StatusIncident" ADD COLUMN IF NOT EXISTS "affectedAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
