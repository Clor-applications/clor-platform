-- A single sign-on session opens only the company whose identity provider vouched for the
-- person (platform audit, 11 Nov 2026). Null for password sign-ins and every session made before.
ALTER TABLE "Session" ADD COLUMN "ssoOrgId" TEXT;
