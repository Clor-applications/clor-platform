-- AlterTable
ALTER TABLE "User" ADD COLUMN "totpSecretEnc" TEXT,
ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN "totpLastStep" INTEGER,
ADD COLUMN "totpRecoveryJson" TEXT;

-- AlterTable
ALTER TABLE "AuthPolicy" ADD COLUMN "requirePayrollStepUp" BOOLEAN NOT NULL DEFAULT false;
