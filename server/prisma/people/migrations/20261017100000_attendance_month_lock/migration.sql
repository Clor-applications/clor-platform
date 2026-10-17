-- CreateTable
CREATE TABLE "AttendanceMonthLock" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lockedByUserId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceMonthLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceMonthLock_accountId_orgId_idx" ON "AttendanceMonthLock"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMonthLock_orgId_month_key" ON "AttendanceMonthLock"("orgId", "month");
