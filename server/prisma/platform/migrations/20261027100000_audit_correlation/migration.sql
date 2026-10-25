-- People design v1 (D-V8): the request id on each platform audit row, so a product's own
-- record timeline (People's change log) can be joined to it instead of keeping a second store.
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;
CREATE INDEX "AuditLog_orgId_entityId_idx" ON "AuditLog"("orgId", "entityId");
