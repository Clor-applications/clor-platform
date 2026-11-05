-- The ledger's rules, held by the database as well as by services/ledger.ts.
--
-- postEntry refuses an unbalanced entry and reverseEntry never edits a posted
-- one, but nothing below the service said so: any other code path (a script,
-- a route written later, a bug) could write a one-sided line, edit an amount
-- after posting or delete a posted entry and its lines with it. These are the
-- same rules, enforced where every writer has to pass.
--
--   1. A line is never negative and never carries both a debit and a credit.
--   2. A POSTED (or REVERSED) entry's lines balance, checked at commit so an
--      entry and its lines can be written in any order inside one transaction.
--   3. A posted entry is append-only: its lines, its hashed fields and its
--      identity cannot change, and it cannot be deleted. Status may only go
--      POSTED -> REVERSED, and the link to its reversal is written once. The
--      bank-reconciliation fields (reconciled, bankDate, statementRef) and the
--      document link stay writable: they are not part of the hash.
--   4. One contra per entry: "reversesId" on the contra is unique, so a
--      retried reversal cannot post a second one.
--
-- A closed company's purge (services/companyClosure.ts) is the one time posted
-- rows go, and it deletes under clor.purge for that transaction only, as the
-- other append-only tables do. Nothing honours clor.bypass here: background
-- jobs run under the bypass and are exactly the writers these rules are for.
--
-- The guard functions read the parent entry with clor.bypass set for their own
-- duration only, so row security can never hide the row they are checking and
-- let a change through by default.
--
-- IF NOT EXISTS / OR REPLACE throughout: the test suite builds tables with
-- `prisma db push` and then replays this file.

-- 4. The contra knows what it reverses.
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "reversesId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_reversesId_key" ON "JournalEntry"("reversesId");

-- 1. Per line.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalLine_amounts_check') THEN
    ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amounts_check"
      CHECK ("debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0));
  END IF;
END $$;

-- 2. Balance, at commit.
CREATE OR REPLACE FUNCTION ledger_entry_balances() RETURNS trigger
LANGUAGE plpgsql
SET clor.bypass = 'on'
AS $$
DECLARE
  eid text;
  st text;
  dr numeric;
  cr numeric;
  n integer;
BEGIN
  IF current_setting('clor.purge', true) = 'on' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'JournalEntry' THEN
    eid := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    eid := OLD."entryId";
  ELSE
    eid := NEW."entryId";
  END IF;
  EXECUTE format('SELECT "status" FROM %I."JournalEntry" WHERE "id" = $1', TG_TABLE_SCHEMA) INTO st USING eid;
  IF st IS NULL OR st NOT IN ('POSTED', 'REVERSED') THEN RETURN NULL; END IF;
  EXECUTE format('SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*) FROM %I."JournalLine" WHERE "entryId" = $1', TG_TABLE_SCHEMA)
    INTO dr, cr, n USING eid;
  IF n < 2 OR dr <> cr THEN
    RAISE EXCEPTION 'ledger_unbalanced: entry % has debits % and credits % over % lines', eid, dr, cr, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS ledger_line_balances ON "JournalLine";
CREATE CONSTRAINT TRIGGER ledger_line_balances
  AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_balances();

DROP TRIGGER IF EXISTS ledger_entry_balances ON "JournalEntry";
CREATE CONSTRAINT TRIGGER ledger_entry_balances
  AFTER INSERT OR UPDATE OF "status" ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_balances();

-- 3a. A posted entry.
CREATE OR REPLACE FUNCTION ledger_entry_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" NOT IN ('POSTED', 'REVERSED') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_setting('clor.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ledger_append_only: posted entry % cannot be deleted; reverse it instead', OLD."entryNo"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."orgId" IS DISTINCT FROM OLD."orgId"
     OR NEW."branchId" IS DISTINCT FROM OLD."branchId"
     OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
     OR NEW."fiscalYearId" IS DISTINCT FROM OLD."fiscalYearId"
     OR NEW."entryNo" IS DISTINCT FROM OLD."entryNo"
     OR NEW."date" IS DISTINCT FROM OLD."date"
     OR NEW."prevHash" IS DISTINCT FROM OLD."prevHash"
     OR NEW."hash" IS DISTINCT FROM OLD."hash"
     OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
     OR NEW."postedByUserId" IS DISTINCT FROM OLD."postedByUserId"
     OR NEW."reversesId" IS DISTINCT FROM OLD."reversesId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'ledger_append_only: posted entry % cannot be changed; reverse it instead', OLD."entryNo"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."reversedById" IS NOT NULL AND NEW."reversedById" IS DISTINCT FROM OLD."reversedById" THEN
    RAISE EXCEPTION 'ledger_append_only: entry % is already reversed', OLD."entryNo"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED' AND NEW."reversedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'ledger_append_only: entry % cannot go from % to %', OLD."entryNo", OLD."status", NEW."status"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ledger_entry_append_only ON "JournalEntry";
CREATE TRIGGER ledger_entry_append_only
  BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_append_only();

-- 3b. The lines of a posted entry. A line whose entry is already gone is being
-- removed by that entry's own (guarded) delete cascading to it.
CREATE OR REPLACE FUNCTION ledger_line_append_only() RETURNS trigger
LANGUAGE plpgsql
SET clor.bypass = 'on'
AS $$
DECLARE
  st text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('clor.purge', true) = 'on' THEN RETURN OLD; END IF;
  EXECUTE format('SELECT "status" FROM %I."JournalEntry" WHERE "id" = $1', TG_TABLE_SCHEMA) INTO st USING OLD."entryId";
  IF st IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'ledger_append_only: a line of a posted entry cannot be %', lower(TG_OP) || 'd'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ledger_line_append_only ON "JournalLine";
CREATE TRIGGER ledger_line_append_only
  BEFORE UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION ledger_line_append_only();

-- Every change to a period lock, with who made it and why. Reopening closed
-- books is the act an auditor asks about, so a reason is required for it
-- (routes/ledger.ts) and kept here beside the lock it changed.
CREATE TABLE IF NOT EXISTS "PeriodLockChange" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "fiscalYearName" TEXT NOT NULL,
    "previousLockedThrough" TEXT,
    "lockedThrough" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PeriodLockChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PeriodLockChange_accountId_orgId_at_idx" ON "PeriodLockChange"("accountId", "orgId", "at");
CREATE INDEX IF NOT EXISTS "PeriodLockChange_orgId_fiscalYearId_idx" ON "PeriodLockChange"("orgId", "fiscalYearId");

ALTER TABLE "PeriodLockChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PeriodLockChange" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PeriodLockChange";
CREATE POLICY tenant_isolation ON "PeriodLockChange"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

-- The history is append-only too, except for a closed company's purge.
CREATE OR REPLACE FUNCTION ledger_lock_history_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('clor.purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'append_only: % rows cannot be changed', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS period_lock_change_append_only ON "PeriodLockChange";
CREATE TRIGGER period_lock_change_append_only
  BEFORE UPDATE OR DELETE ON "PeriodLockChange"
  FOR EACH ROW EXECUTE FUNCTION ledger_lock_history_append_only();
