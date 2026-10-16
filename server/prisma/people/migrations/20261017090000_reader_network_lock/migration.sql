-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN     "allowedNetworks" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "claimNetwork" TEXT,
ADD COLUMN     "networkVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "pendingNetwork" TEXT,
ADD COLUMN     "pendingNetworkAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UnclaimedReader" ADD COLUMN     "network" TEXT;

-- Readers added before the lock existed stay trusted: each keeps the first network it calls from next.
UPDATE "AttendanceDevice" SET "networkVerifiedAt" = CURRENT_TIMESTAMP WHERE "vendor" = 'ADMS';
