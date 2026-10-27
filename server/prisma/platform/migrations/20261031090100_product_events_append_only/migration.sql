-- Tenant isolation on ProductEvent, fail-closed (A-35), and append-only like
-- AuditLog (20261028090000): nothing edits or removes an event, except the
-- purge of a closed company (services/companyClosure.ts) under clor.purge.
ALTER TABLE "ProductEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductEvent";
CREATE POLICY tenant_isolation ON "ProductEvent"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

CREATE OR REPLACE FUNCTION product_event_refuse_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('clor.purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'append_only: % rows cannot be changed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS product_event_append_only ON "ProductEvent";
CREATE TRIGGER product_event_append_only BEFORE UPDATE OR DELETE ON "ProductEvent"
  FOR EACH ROW EXECUTE FUNCTION product_event_refuse_change();
