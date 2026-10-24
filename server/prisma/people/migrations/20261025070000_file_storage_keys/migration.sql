-- R2 plan: a file's bytes may live in object storage; the row then keeps its key (and empty bytes).
ALTER TABLE "EmployeeDocument" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "PunchPhoto" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "ComplianceTask" ADD COLUMN "evidenceKey" TEXT;
