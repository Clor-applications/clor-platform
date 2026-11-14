-- Notes and tags are CLOR staff's own, about a customer: no customer request
-- may read them. Only the operator console, which works outside any company
-- through clor.bypass, sees them.
ALTER TABLE "AccountNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_only ON "AccountNote";
CREATE POLICY staff_only ON "AccountNote"
  USING (current_setting('clor.bypass', true) = 'on')
  WITH CHECK (current_setting('clor.bypass', true) = 'on');
ALTER TABLE "AccountTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountTag" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_only ON "AccountTag";
CREATE POLICY staff_only ON "AccountTag"
  USING (current_setting('clor.bypass', true) = 'on')
  WITH CHECK (current_setting('clor.bypass', true) = 'on');
