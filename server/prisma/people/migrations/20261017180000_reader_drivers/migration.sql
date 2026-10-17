-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN "pushTokenHash" TEXT,
ADD COLUMN "pushTokenPrefix" TEXT,
ADD COLUMN "mappingJson" TEXT,
ADD COLUMN "configJson" TEXT,
ADD COLUMN "sourceTimezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN "lastPayload" TEXT,
ADD COLUMN "lastPayloadAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_pushTokenHash_key" ON "AttendanceDevice"("pushTokenHash");
