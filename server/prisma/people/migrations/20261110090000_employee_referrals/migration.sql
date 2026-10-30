-- Employee referrals (A20, WORKFLOW-GAP-RESEARCH-2026-10-30): an opening open to referrals with a
-- bonus, the referral and the referrer's own link. Additive only: every default leaves an opening
-- and a candidate as they were. Policies in the next migration.

-- AlterTable
ALTER TABLE "JobOpening" ADD COLUMN     "internalApply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referAudience" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "referBranchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "referDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "referralBonus" DECIMAL(12,2),
ADD COLUMN     "referralBonusDays" INTEGER,
ADD COLUMN     "referralOpen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralOpenedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "internalEmployeeId" TEXT;

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "referrerEmployeeId" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'FORM',
    "relation" TEXT,
    "note" TEXT,
    "phoneKey" TEXT,
    "emailKey" TEXT,
    "bonusAmount" DECIMAL(12,2),
    "bonusDays" INTEGER,
    "bonusStatus" TEXT NOT NULL DEFAULT 'NONE',
    "bonusDueOn" TEXT,
    "bonusNote" TEXT,
    "bonusAdjustmentId" TEXT,
    "bonusPaidAt" TIMESTAMP(3),
    "bonusPaidByUserId" TEXT,
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "referrerEmployeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_candidateId_key" ON "Referral"("candidateId");

-- CreateIndex
CREATE INDEX "Referral_orgId_referrerEmployeeId_idx" ON "Referral"("orgId", "referrerEmployeeId");

-- CreateIndex
CREATE INDEX "Referral_orgId_openingId_idx" ON "Referral"("orgId", "openingId");

-- CreateIndex
CREATE INDEX "Referral_orgId_phoneKey_idx" ON "Referral"("orgId", "phoneKey");

-- CreateIndex
CREATE INDEX "Referral_orgId_emailKey_idx" ON "Referral"("orgId", "emailKey");

-- CreateIndex
CREATE INDEX "Referral_orgId_bonusStatus_idx" ON "Referral"("orgId", "bonusStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_tokenHash_key" ON "ReferralLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ReferralLink_orgId_referrerEmployeeId_idx" ON "ReferralLink"("orgId", "referrerEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_openingId_referrerEmployeeId_key" ON "ReferralLink"("openingId", "referrerEmployeeId");
