-- A role may be limited to the documents its holder raised.
--
-- Odoo's "Sales / User: Own Documents Only" and ERPNext's "if owner" on a
-- role permission: the role grants the same actions, but list and single-
-- document reads are filtered to rows whose createdByUserId is the caller.
-- Additive across roles — one unrestricted role lifts the restriction.
ALTER TABLE "Role" ADD COLUMN "ownDocumentsOnly" BOOLEAN NOT NULL DEFAULT false;
