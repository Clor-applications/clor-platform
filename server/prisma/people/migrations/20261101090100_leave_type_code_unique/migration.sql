-- O-12: one code per leave type within a company, held by the database and not
-- only by the route's check (routes/leave.ts codeTakenBy), which two saves at
-- the same moment could both pass. Codes print on payslips and reports.
--
-- SQL only: Prisma cannot express a partial or expression index, so
-- schema.prisma carries a comment and server/src/__tests__/globalSetup.ts
-- replays this file after `prisma db push`.
--
-- Existing duplicates are cleaned first, or the index could not be built:
--   * a blank code ('' or spaces) becomes NULL — it was never a code, and two
--     blanks would otherwise clash;
--   * within a company, codes that match ignoring case keep their code on the
--     first type that has it (earliest createdAt, then id) and every later type
--     with the same code has its code set to NULL. The type, its name, its
--     balances and its history are untouched; HR gives it a new code. Only the
--     code column changes, so nothing reads differently but the printed code.
--
-- LeaveType forces row-level security, so without the bypass the owner would
-- see no rows, clean nothing, and the index would fail on the duplicates.
SET clor.bypass = 'on';

UPDATE "LeaveType" SET "code" = NULL WHERE "code" IS NOT NULL AND btrim("code") = '';

UPDATE "LeaveType" t
SET "code" = NULL
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "orgId", lower("code") ORDER BY "createdAt", "id") AS n
  FROM "LeaveType"
  WHERE "code" IS NOT NULL
) d
WHERE t."id" = d."id" AND d.n > 1;

RESET clor.bypass;

CREATE UNIQUE INDEX "LeaveType_orgId_lower_code_key" ON "LeaveType"("orgId", lower("code")) WHERE "code" IS NOT NULL;
