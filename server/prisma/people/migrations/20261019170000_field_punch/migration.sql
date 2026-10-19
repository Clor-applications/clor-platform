-- Field punches: phone punches from anywhere for people allowed to, with the
-- address recorded, marked outside a site, and reviewed before they count.
ALTER TABLE "Employee" ADD COLUMN "phonePunchMode" TEXT NOT NULL DEFAULT 'SITE';
ALTER TABLE "Employee" ADD COLUMN "selfieRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DevicePunch" ADD COLUMN "outsideSite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DevicePunch" ADD COLUMN "address" TEXT;
ALTER TABLE "DevicePunch" ADD COLUMN "reviewStatus" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN "fieldPunchApproval" BOOLEAN NOT NULL DEFAULT true;
