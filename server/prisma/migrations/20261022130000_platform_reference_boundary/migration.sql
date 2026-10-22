-- Platform owns accounts, organisations, branches, users and memberships.
-- Legacy accounting tables are retained for recovery, but operational tables
-- must not reference their stale copies. The current Prisma schema stores
-- these identifiers as strings; tenant and membership guards validate them.
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS "Warehouse_branchId_fkey";
ALTER TABLE "InterBranchTransfer" DROP CONSTRAINT IF EXISTS "InterBranchTransfer_sourceBranchId_fkey";
ALTER TABLE "InterBranchTransfer" DROP CONSTRAINT IF EXISTS "InterBranchTransfer_targetBranchId_fkey";
ALTER TABLE "OrgMaster" DROP CONSTRAINT IF EXISTS "OrgMaster_accountId_fkey";
ALTER TABLE "OrgMaster" DROP CONSTRAINT IF EXISTS "OrgMaster_orgId_fkey";
ALTER TABLE "DocumentShareLink" DROP CONSTRAINT IF EXISTS "DocumentShareLink_orgId_fkey";
ALTER TABLE "BankBookEntry" DROP CONSTRAINT IF EXISTS "BankBookEntry_orgId_fkey";
ALTER TABLE "PosDayClose" DROP CONSTRAINT IF EXISTS "PosDayClose_orgId_fkey";
ALTER TABLE "RecurringSchedule" DROP CONSTRAINT IF EXISTS "RecurringSchedule_orgId_fkey";
