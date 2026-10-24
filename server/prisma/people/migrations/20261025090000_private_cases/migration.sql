-- Private cases (docs/people/02-PRD.md PRIV-01..06): POSH and grievance cases seen only by
-- their named members; summary and evidence encrypted; every open logged; committee set-up.
CREATE TABLE "PrivateCase" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "complainantEmployeeId" TEXT,
    "raisedByUserId" TEXT,
    "onBehalf" BOOLEAN NOT NULL DEFAULT false,
    "respondentEmployeeIds" JSONB NOT NULL,
    "summaryEnc" TEXT NOT NULL,
    "incidentOn" TEXT NOT NULL,
    "receivedOn" TEXT NOT NULL,
    "filingDeadline" TEXT NOT NULL,
    "extendedTo" TEXT,
    "extensionReason" TEXT,
    "inquiryDue" TEXT NOT NULL,
    "inquiryClosedOn" TEXT,
    "reportDue" TEXT,
    "reportOn" TEXT,
    "actionDue" TEXT,
    "actionOn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "outcome" TEXT,
    "excluded" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivateCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrivateCase_orgId_reference_key" ON "PrivateCase"("orgId", "reference");
CREATE INDEX "PrivateCase_orgId_status_idx" ON "PrivateCase"("orgId", "status");

CREATE TABLE "PrivateCaseMember" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateCaseMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrivateCaseMember_caseId_userId_key" ON "PrivateCaseMember"("caseId", "userId");
CREATE INDEX "PrivateCaseMember_orgId_userId_idx" ON "PrivateCaseMember"("orgId", "userId");
ALTER TABLE "PrivateCaseMember" ADD CONSTRAINT "PrivateCaseMember_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "PrivateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PrivateCaseEvidence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "titleEnc" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "dataEnc" TEXT NOT NULL,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateCaseEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrivateCaseEvidence_orgId_caseId_idx" ON "PrivateCaseEvidence"("orgId", "caseId");
ALTER TABLE "PrivateCaseEvidence" ADD CONSTRAINT "PrivateCaseEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "PrivateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PrivateCaseAccess" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "evidenceId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateCaseAccess_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrivateCaseAccess_orgId_caseId_at_idx" ON "PrivateCaseAccess"("orgId", "caseId", "at");

CREATE TABLE "CommitteeSetup" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommitteeSetup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommitteeSetup_orgId_kind_key" ON "CommitteeSetup"("orgId", "kind");
