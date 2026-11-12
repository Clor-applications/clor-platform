-- Demo requests as a sales pipeline (platform audit, 11 Nov 2026): who looks after the lead,
-- when to call next, and where the visitor came from. Platform data read only by CLOR operators.
ALTER TABLE "DemoRequest" ADD COLUMN "assignedToUserId" TEXT;
ALTER TABLE "DemoRequest" ADD COLUMN "followUpAt" TIMESTAMP(3);
ALTER TABLE "DemoRequest" ADD COLUMN "source" TEXT;
ALTER TABLE "DemoRequest" ADD COLUMN "sourceDetail" JSONB;
CREATE INDEX "DemoRequest_assignedToUserId_followUpAt_idx" ON "DemoRequest"("assignedToUserId", "followUpAt");
CREATE INDEX "DemoRequest_followUpAt_idx" ON "DemoRequest"("followUpAt");
