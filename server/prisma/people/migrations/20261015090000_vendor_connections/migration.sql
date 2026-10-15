-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN     "apiCorporateId" TEXT,
ADD COLUMN     "apiSecret" TEXT,
ADD COLUMN     "apiUrl" TEXT,
ADD COLUMN     "apiUsername" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastFetchedAt" TIMESTAMP(3),
ADD COLUMN     "vendor" TEXT NOT NULL DEFAULT 'ADMS';

