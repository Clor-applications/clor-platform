-- Document versions (docs/people/02-PRD.md DOC-02), letters issued from templates (DOC-04)
-- and whether an establishment holds original documents (DOC-07).
ALTER TABLE "EmployeeDocument" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "EmployeeDocument" ADD COLUMN "supersedesId" TEXT;
ALTER TABLE "EmployeeDocument" ADD COLUMN "supersededById" TEXT;
ALTER TABLE "EmployeeDocument" ADD COLUMN "templateId" TEXT;
ALTER TABLE "EmployeeDocument" ADD COLUMN "templateVersion" INTEGER;
CREATE INDEX "EmployeeDocument_orgId_supersededById_idx" ON "EmployeeDocument"("orgId", "supersededById");

ALTER TABLE "Establishment" ADD COLUMN "holdsOriginals" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LetterTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LetterTemplate_orgId_kind_version_key" ON "LetterTemplate"("orgId", "kind", "version");
CREATE INDEX "LetterTemplate_orgId_kind_active_idx" ON "LetterTemplate"("orgId", "kind", "active");
