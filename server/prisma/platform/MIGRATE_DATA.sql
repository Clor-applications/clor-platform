-- ============================================================================
-- One-time data move: remove the 27 PLATFORM tables from the accounting DB.
-- ============================================================================
--
-- Run this LAST, against the OLD accounting database (clor_main), and ONLY
-- after the 27 tables have been copied into the new platform database
-- (clor_platform) and their row counts verified equal. See README_MIGRATION.md
-- for the full sequence (pg_dump → restore → verify → this file).
--
-- This file does NOT contain any connection string or secret. Point psql at
-- clor_main yourself, e.g.  psql "$DATABASE_URL" -f MIGRATE_DATA.sql
--
-- CASCADE is deliberate: these tables are referenced by foreign keys from
-- accounting tables (e.g. OrgMaster.accountId → Account, Warehouse.branchId →
-- Branch, DocumentShareLink.orgId → Org). Those cross-database relations no
-- longer exist in the Prisma schema, so dropping the constraint along with the
-- table is exactly the intent — the surviving scalar id columns stay behind on
-- the accounting side. CASCADE drops the dependent FK constraints, never the
-- referencing tables or their rows.
--
-- Wrapped in a transaction: either every platform table leaves clor_main, or
-- none does.

BEGIN;

-- Children before parents is unnecessary with CASCADE, but the order below is
-- leaf-to-root anyway so the intent reads clearly.
DROP TABLE IF EXISTS "RoleProfileRole"        CASCADE;
DROP TABLE IF EXISTS "UserRoleProfile"        CASCADE;
DROP TABLE IF EXISTS "RoleProfile"            CASCADE;
DROP TABLE IF EXISTS "RolePermission"         CASCADE;
DROP TABLE IF EXISTS "UserRoleAssignment"     CASCADE;
DROP TABLE IF EXISTS "UserPermission"         CASCADE;
DROP TABLE IF EXISTS "Permission"             CASCADE;
DROP TABLE IF EXISTS "Role"                   CASCADE;

DROP TABLE IF EXISTS "UserWarehouseAccess"    CASCADE;
DROP TABLE IF EXISTS "UserBranchMembership"   CASCADE;
DROP TABLE IF EXISTS "UserOrgMembership"      CASCADE;

DROP TABLE IF EXISTS "AuditLog"               CASCADE;
DROP TABLE IF EXISTS "FeatureSetting"         CASCADE;
DROP TABLE IF EXISTS "NotificationSetting"    CASCADE;
DROP TABLE IF EXISTS "EmailSetting"           CASCADE;
DROP TABLE IF EXISTS "EmailOutbox"            CASCADE;
DROP TABLE IF EXISTS "EmailVerificationToken" CASCADE;
DROP TABLE IF EXISTS "PasswordResetToken"     CASCADE;
DROP TABLE IF EXISTS "AuthEvent"              CASCADE;
DROP TABLE IF EXISTS "AuthPolicy"             CASCADE;
DROP TABLE IF EXISTS "AuthProvider"           CASCADE;
DROP TABLE IF EXISTS "Session"                CASCADE;
DROP TABLE IF EXISTS "AccountEntitlement"     CASCADE;

DROP TABLE IF EXISTS "Branch"                 CASCADE;
DROP TABLE IF EXISTS "User"                   CASCADE;
DROP TABLE IF EXISTS "Org"                    CASCADE;
DROP TABLE IF EXISTS "Account"                CASCADE;

COMMIT;
