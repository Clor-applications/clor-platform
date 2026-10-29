-- Talent (docs/people/design-v1/TALENT-DECISIONS.md): job openings, candidates, interviews and
-- feedback; goals and check-ins, review cycles and reviews, improvement plans, one-on-ones;
-- trainings and attendees. New tables only, each with the tenant policy every People table has.
-- The four old registers (recruitment, candidates, performance, learning) are copied in with
-- their ids kept, so offers already sent to a candidate still find them. The register rows
-- themselves are left in place, unread, so this can be rolled back by dropping the new tables.

-- CreateTable
CREATE TABLE "JobOpening" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "jobPositionId" TEXT,
    "branchId" TEXT,
    "employeeTypeId" TEXT,
    "location" TEXT,
    "places" INTEGER NOT NULL DEFAULT 1,
    "hiringManagerId" TEXT,
    "description" TEXT,
    "targetDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requestedByUserId" TEXT,
    "openedByUserId" TEXT,
    "applyOpen" BOOLEAN NOT NULL DEFAULT false,
    "applyTokenHash" TEXT,
    "closedReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'OTHER',
    "sourceDetail" TEXT,
    "currentEmployer" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'APPLIED',
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedReason" TEXT,
    "resumeName" TEXT,
    "resumeMime" TEXT,
    "resumeSize" INTEGER,
    "resumeData" BYTEA,
    "resumeUrl" TEXT,
    "offerAcceptedOn" TEXT,
    "employeeId" TEXT,
    "anonymisedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "text" TEXT,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 45,
    "mode" TEXT NOT NULL DEFAULT 'IN_PERSON',
    "place" TEXT,
    "interviewerUserIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewFeedback" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "measure" TEXT,
    "dueDate" TEXT,
    "weight" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "health" TEXT NOT NULL DEFAULT 'ON_TRACK',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalCheckIn" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "health" TEXT NOT NULL,
    "note" TEXT,
    "byUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'FORM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "selfDue" TEXT,
    "managerDue" TEXT,
    "departmentIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerEmployeeId" TEXT,
    "selfRating" INTEGER,
    "selfText" TEXT,
    "selfAt" TIMESTAMP(3),
    "managerRating" INTEGER,
    "managerText" TEXT,
    "managerAt" TIMESTAMP(3),
    "managerByUserId" TEXT,
    "finalRating" INTEGER,
    "finalReason" TEXT,
    "finalByUserId" TEXT,
    "sharedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementPlan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerEmployeeId" TEXT,
    "reason" TEXT NOT NULL,
    "expectations" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "outcomeNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentNote" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneOnOne" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "managerEmployeeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "notes" TEXT,
    "actions" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneOnOne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Training" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'INTERNAL',
    "startDate" TEXT,
    "endDate" TEXT,
    "hours" DECIMAL(7,2),
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "validMonths" INTEGER,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Training_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSeat" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "completedOn" TEXT,
    "expiresOn" TEXT,
    "certName" TEXT,
    "certMime" TEXT,
    "certSize" INTEGER,
    "certData" BYTEA,
    "certUrl" TEXT,
    "remindedStage" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobOpening_applyTokenHash_key" ON "JobOpening"("applyTokenHash");

-- CreateIndex
CREATE INDEX "JobOpening_orgId_status_idx" ON "JobOpening"("orgId", "status");

-- CreateIndex
CREATE INDEX "Candidate_orgId_openingId_stage_idx" ON "Candidate"("orgId", "openingId", "stage");

-- CreateIndex
CREATE INDEX "Candidate_orgId_stage_stageAt_idx" ON "Candidate"("orgId", "stage", "stageAt");

-- CreateIndex
CREATE INDEX "CandidateEvent_orgId_candidateId_createdAt_idx" ON "CandidateEvent"("orgId", "candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "Interview_orgId_candidateId_idx" ON "Interview"("orgId", "candidateId");

-- CreateIndex
CREATE INDEX "Interview_orgId_at_idx" ON "Interview"("orgId", "at");

-- CreateIndex
CREATE INDEX "InterviewFeedback_orgId_candidateId_idx" ON "InterviewFeedback"("orgId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewFeedback_interviewId_byUserId_key" ON "InterviewFeedback"("interviewId", "byUserId");

-- CreateIndex
CREATE INDEX "Goal_orgId_employeeId_status_idx" ON "Goal"("orgId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "GoalCheckIn_orgId_goalId_createdAt_idx" ON "GoalCheckIn"("orgId", "goalId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewCycle_orgId_status_idx" ON "ReviewCycle"("orgId", "status");

-- CreateIndex
CREATE INDEX "Review_orgId_employeeId_idx" ON "Review"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_cycleId_employeeId_key" ON "Review"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "ImprovementPlan_orgId_employeeId_status_idx" ON "ImprovementPlan"("orgId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "TalentNote_orgId_subject_subjectId_idx" ON "TalentNote"("orgId", "subject", "subjectId");

-- CreateIndex
CREATE INDEX "OneOnOne_orgId_managerEmployeeId_employeeId_idx" ON "OneOnOne"("orgId", "managerEmployeeId", "employeeId");

-- CreateIndex
CREATE INDEX "Training_orgId_status_idx" ON "Training"("orgId", "status");

-- CreateIndex
CREATE INDEX "TrainingSeat_orgId_employeeId_idx" ON "TrainingSeat"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "TrainingSeat_orgId_expiresOn_idx" ON "TrainingSeat"("orgId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSeat_trainingId_employeeId_key" ON "TrainingSeat"("trainingId", "employeeId");


ALTER TABLE "JobOpening" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobOpening" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JobOpening";
CREATE POLICY tenant_isolation ON "JobOpening"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Candidate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Candidate";
CREATE POLICY tenant_isolation ON "Candidate"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "CandidateEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CandidateEvent";
CREATE POLICY tenant_isolation ON "CandidateEvent"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "Interview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Interview" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Interview";
CREATE POLICY tenant_isolation ON "Interview"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "InterviewFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InterviewFeedback" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InterviewFeedback";
CREATE POLICY tenant_isolation ON "InterviewFeedback"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Goal";
CREATE POLICY tenant_isolation ON "Goal"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "GoalCheckIn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoalCheckIn" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GoalCheckIn";
CREATE POLICY tenant_isolation ON "GoalCheckIn"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "ReviewCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewCycle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReviewCycle";
CREATE POLICY tenant_isolation ON "ReviewCycle"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Review";
CREATE POLICY tenant_isolation ON "Review"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "ImprovementPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImprovementPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ImprovementPlan";
CREATE POLICY tenant_isolation ON "ImprovementPlan"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "TalentNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TalentNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TalentNote";
CREATE POLICY tenant_isolation ON "TalentNote"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "OneOnOne" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OneOnOne" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OneOnOne";
CREATE POLICY tenant_isolation ON "OneOnOne"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "Training" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Training" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Training";
CREATE POLICY tenant_isolation ON "Training"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

ALTER TABLE "TrainingSeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingSeat" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TrainingSeat";
CREATE POLICY tenant_isolation ON "TrainingSeat"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));

-- Copy the old registers across (every company, so outside any one tenant).
SET clor.bypass = 'on';

INSERT INTO "JobOpening" ("id", "accountId", "orgId", "title", "departmentId", "location", "places", "description", "targetDate", "status", "createdByUserId", "createdAt", "updatedAt")
SELECT r."id", r."accountId", r."orgId", r."title",
  (SELECT d."id" FROM "Department" d WHERE d."orgId" = r."orgId" AND lower(d."name") = lower(trim(r."details"->>'department')) LIMIT 1),
  NULLIF(trim(r."details"->>'location'), ''),
  CASE WHEN (r."details"->>'openings') ~ '^[0-9]+$' THEN GREATEST(1, (r."details"->>'openings')::int) ELSE 1 END,
  NULLIF(r."details"->>'description', ''), r."dueDate",
  CASE r."status" WHEN 'OPEN' THEN 'OPEN' WHEN 'ON_HOLD' THEN 'ON_HOLD' WHEN 'CLOSED' THEN 'CLOSED' ELSE 'DRAFT' END,
  r."createdBy", r."createdAt", r."updatedAt"
FROM "PeopleRecord" r WHERE r."kind" = 'recruitment'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Candidate" ("id", "accountId", "orgId", "openingId", "name", "email", "phone", "stage", "stageAt", "offerAcceptedOn", "employeeId", "createdByUserId", "createdAt", "updatedAt")
SELECT r."id", r."accountId", r."orgId", r."details"->>'jobId', r."title",
  NULLIF(r."details"->>'email', ''), NULLIF(r."details"->>'phone', ''),
  CASE r."status" WHEN 'SHORTLISTED' THEN 'SCREENING' WHEN 'INTERVIEW' THEN 'INTERVIEW' WHEN 'OFFERED' THEN 'OFFER' WHEN 'HIRED' THEN 'HIRED' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'APPLIED' END,
  r."updatedAt", NULLIF(r."details"->>'offerAcceptedOn', ''), r."employeeId", r."createdBy", r."createdAt", r."updatedAt"
FROM "PeopleRecord" r
WHERE r."kind" = 'candidates' AND EXISTS (SELECT 1 FROM "JobOpening" o WHERE o."id" = r."details"->>'jobId')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "CandidateEvent" ("id", "accountId", "orgId", "candidateId", "kind", "toStage", "text", "byUserId", "createdAt")
SELECT c."id" || '_applied', c."accountId", c."orgId", c."id", 'APPLIED', 'APPLIED', 'Moved from the old candidates list', c."createdByUserId", c."createdAt"
FROM "Candidate" c WHERE NOT EXISTS (SELECT 1 FROM "CandidateEvent" e WHERE e."candidateId" = c."id");

INSERT INTO "CandidateEvent" ("id", "accountId", "orgId", "candidateId", "kind", "text", "byUserId", "createdAt")
SELECT r."id" || '_notes', r."accountId", r."orgId", r."id", 'NOTE', r."details"->>'notes', r."updatedBy", r."updatedAt"
FROM "PeopleRecord" r
WHERE r."kind" = 'candidates' AND COALESCE(trim(r."details"->>'notes'), '') <> '' AND EXISTS (SELECT 1 FROM "Candidate" c WHERE c."id" = r."id")
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Goal" ("id", "accountId", "orgId", "employeeId", "title", "measure", "dueDate", "progress", "health", "status", "description", "createdByUserId", "createdAt", "updatedAt")
SELECT r."id", r."accountId", r."orgId", r."employeeId", r."title", NULLIF(r."details"->>'measure', ''), r."dueDate",
  CASE WHEN (r."details"->>'progress') ~ '^[0-9]+(\.[0-9]+)?$' THEN LEAST(100, round((r."details"->>'progress')::numeric)::int) ELSE 0 END,
  'ON_TRACK',
  CASE r."status" WHEN 'COMPLETED' THEN 'DONE' WHEN 'CANCELLED' THEN 'DROPPED' ELSE 'ACTIVE' END,
  NULLIF(concat_ws(E'\n\n', NULLIF(r."details"->>'description', ''), CASE WHEN COALESCE(r."details"->>'feedback', '') <> '' THEN 'Manager feedback: ' || (r."details"->>'feedback') END), ''),
  r."createdBy", r."createdAt", r."updatedAt"
FROM "PeopleRecord" r WHERE r."kind" = 'performance' AND r."employeeId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Training" ("id", "accountId", "orgId", "title", "provider", "endDate", "hours", "description", "status", "createdByUserId", "createdAt", "updatedAt")
SELECT r."id", r."accountId", r."orgId", r."title", NULLIF(r."details"->>'provider', ''), r."dueDate",
  CASE WHEN (r."details"->>'hours') ~ '^[0-9]+(\.[0-9]+)?$' THEN (r."details"->>'hours')::numeric ELSE NULL END,
  NULLIF(r."details"->>'description', ''),
  CASE r."status" WHEN 'COMPLETED' THEN 'DONE' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'PLANNED' END,
  r."createdBy", r."createdAt", r."updatedAt"
FROM "PeopleRecord" r WHERE r."kind" = 'learning'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TrainingSeat" ("id", "accountId", "orgId", "trainingId", "employeeId", "status", "completedOn", "certUrl", "createdAt", "updatedAt")
SELECT r."id" || '_seat', r."accountId", r."orgId", r."id", r."employeeId",
  CASE r."status" WHEN 'COMPLETED' THEN 'COMPLETED' ELSE 'ASSIGNED' END,
  CASE WHEN r."status" = 'COMPLETED' THEN COALESCE(r."dueDate", to_char(r."updatedAt", 'YYYY-MM-DD')) END,
  NULLIF(r."details"->>'certificateUrl', ''), r."createdAt", r."updatedAt"
FROM "PeopleRecord" r WHERE r."kind" = 'learning' AND r."employeeId" IS NOT NULL
ON CONFLICT DO NOTHING;
