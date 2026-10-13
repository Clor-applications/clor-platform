-- Display codes (LD-09). Internal ids (cuid) are unchanged and remain the only join keys.
--   Company  INNO-C100       3–4 letters from the name, C, number: 100 unless the
--                            letters are already taken (Innovate -> INNO-C101).
--                            The C keeps it from reading like a document number.
--   Account  INNO-C100       the code of the account's first company.
--   User     INNO-C100-U01   home company code + U + number within that company.
--                            One per person; a user invited into other companies
--                            (e.g. a CA) keeps it everywhere.

ALTER TABLE "Account" ADD COLUMN "code" TEXT;
ALTER TABLE "Org" ADD COLUMN "code" TEXT;
ALTER TABLE "Org" ADD COLUMN "codeNumber" INTEGER;
ALTER TABLE "User" ADD COLUMN "code" TEXT;
ALTER TABLE "User" ADD COLUMN "codeNumber" INTEGER;
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");
CREATE UNIQUE INDEX "Org_code_key" ON "Org"("code");
CREATE UNIQUE INDEX "User_code_key" ON "User"("code");

-- Prefix rule, kept identical to services/displayCodes.ts codePrefix():
-- first word's first 4 letters, upper case; fewer than 3 letters there takes
-- letters from the whole name; fewer than 3 letters in total -> CLOR.
CREATE OR REPLACE FUNCTION clor_code_prefix(n TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN length(left(upper(regexp_replace(split_part(btrim(coalesce(n, '')), ' ', 1), '[^A-Za-z]', '', 'g')), 4)) >= 3
      THEN left(upper(regexp_replace(split_part(btrim(coalesce(n, '')), ' ', 1), '[^A-Za-z]', '', 'g')), 4)
    WHEN length(left(upper(regexp_replace(coalesce(n, ''), '[^A-Za-z]', '', 'g')), 4)) >= 3
      THEN left(upper(regexp_replace(coalesce(n, ''), '[^A-Za-z]', '', 'g')), 4)
    ELSE 'CLOR'
  END
$$;

-- Companies: oldest first within each prefix, from 100.
WITH numbered AS (
  SELECT id, clor_code_prefix(name) AS prefix,
         99 + row_number() OVER (PARTITION BY clor_code_prefix(name) ORDER BY "createdAt" ASC, id ASC) AS n
  FROM "Org"
)
UPDATE "Org" o SET "codeNumber" = numbered.n, code = numbered.prefix || '-C' || numbered.n::text
FROM numbered WHERE o.id = numbered.id AND o.code IS NULL;

-- Accounts: their first company's code.
UPDATE "Account" a SET code = (
  SELECT o.code FROM "Org" o WHERE o."accountId" = a.id AND o.code IS NOT NULL ORDER BY o."createdAt" ASC, o.id ASC LIMIT 1
) WHERE a.code IS NULL;

-- Users: home company = the first company they were added to; numbered within it.
WITH home AS (
  SELECT DISTINCT ON (m."userId") m."userId", m."orgId"
  FROM "UserOrgMembership" m
  ORDER BY m."userId", m."createdAt" ASC, m.id ASC
), numbered AS (
  SELECT u.id, o.code AS org_code,
         row_number() OVER (PARTITION BY home."orgId" ORDER BY u."createdAt" ASC, u.id ASC) AS n
  FROM "User" u JOIN home ON home."userId" = u.id JOIN "Org" o ON o.id = home."orgId"
  WHERE o.code IS NOT NULL
)
UPDATE "User" u SET "codeNumber" = numbered.n, code = numbered.org_code || '-U' || lpad(numbered.n::text, 2, '0')
FROM numbered WHERE u.id = numbered.id AND u.code IS NULL;

DROP FUNCTION clor_code_prefix(TEXT);
