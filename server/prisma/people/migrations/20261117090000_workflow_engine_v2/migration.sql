-- Workflow engine, phase 2a (docs/people/workflow-engine/SPEC.md sections 5 and 6): rule spec version 2, rule
-- variants and auto-approve, ALL-mode step slots, how a step's deciders were found, and the module record a request
-- decides. Columns only, each with a default, so existing rows read exactly as before: a rule with specVersion 1 is
-- read through normaliseSteps with identical behaviour. No new table, so the existing row-level security policies on
-- these three tables cover the new columns. No rows are updated.

ALTER TABLE "ApprovalRule" ADD COLUMN "specVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ApprovalRule" ADD COLUMN "variantKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ApprovalRule" ADD COLUMN "appliesWhen" JSONB;
ALTER TABLE "ApprovalRule" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApprovalRule" ADD COLUMN "autoApprove" JSONB;
ALTER TABLE "ApprovalRule" ADD COLUMN "presetKey" TEXT;

DROP INDEX IF EXISTS "ApprovalRule_orgId_requestType_version_key";
CREATE UNIQUE INDEX "ApprovalRule_orgId_requestType_variantKey_version_key" ON "ApprovalRule"("orgId", "requestType", "variantKey", "version");

ALTER TABLE "ApprovalRequest" ADD COLUMN "sourceKind" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "ruleVariant" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "ApprovalRequest_orgId_sourceKind_sourceId_key" ON "ApprovalRequest"("orgId", "sourceKind", "sourceId");

ALTER TABLE "ApprovalStep" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApprovalStep" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'ANY';
ALTER TABLE "ApprovalStep" ADD COLUMN "resolvedHow" TEXT;
