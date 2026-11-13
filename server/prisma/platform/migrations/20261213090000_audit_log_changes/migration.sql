-- The edit log's before and after values (Rule 3(1)): `{ "field": { "from": …, "to": … } }` for a change to
-- roles, permissions, sign-in, company settings, People and Attendance records (middleware/auditMutations.ts).
-- Secrets, passwords, tokens, Aadhaar, PAN and bank numbers are masked before they are written.
-- Additive and nullable: old rows keep NULL. The append-only trigger (20261028090000) fires on UPDATE and
-- DELETE only, so it covers the new column as it is; nothing here needs a superuser.
ALTER TABLE "AuditLog" ADD COLUMN "changes" JSONB;
