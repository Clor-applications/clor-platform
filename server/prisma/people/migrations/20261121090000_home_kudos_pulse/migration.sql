-- People Home (owner's suite spec, 5–6 Nov 2026): a kudos stream and a one-question pulse. New tables only.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Kudos" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "toEmployeeId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kudos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PulseQuestion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PulseQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PulseAnswer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PulseAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Kudos_orgId_createdAt_idx" ON "Kudos"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PulseQuestion_orgId_closedAt_idx" ON "PulseQuestion"("orgId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PulseAnswer_questionId_userId_key" ON "PulseAnswer"("questionId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PulseAnswer_orgId_questionId_idx" ON "PulseAnswer"("orgId", "questionId");
