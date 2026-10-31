-- What a notice is about (docs/people/workflow-engine/SPEC.md 3.6), so a request's "waiting for you" notice can
-- be marked withdrawn, or removed, when the person withdraws it. Additive: older notices have no key and stay as they are.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "subjectKey" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_orgId_subjectKey_idx" ON "Notification"("orgId", "subjectKey");
