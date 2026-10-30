-- Tenant isolation, fail closed (A-35), for shift swaps and request types (20261109150000),
-- as every other People table. Policies only; safe to run twice.
ALTER TABLE "ShiftSwap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftSwap" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ShiftSwap";
CREATE POLICY tenant_isolation ON "ShiftSwap"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "RequestForm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestForm" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RequestForm";
CREATE POLICY tenant_isolation ON "RequestForm"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "RequestFormFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestFormFile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RequestFormFile";
CREATE POLICY tenant_isolation ON "RequestFormFile"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
