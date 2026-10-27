-- Notice period (Workforce final audit W15). Additive: notice owed per employment type, and on the person when the resignation came and whether notice was waived.
ALTER TABLE "EmployeeType" ADD COLUMN "noticeDays" INTEGER;
ALTER TABLE "Employee" ADD COLUMN "resignedOn" TEXT;
ALTER TABLE "Employee" ADD COLUMN "noticeWaived" BOOLEAN NOT NULL DEFAULT false;
