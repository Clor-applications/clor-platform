-- Display codes, second scheme (services/displayCodes.ts): ten random digits,
-- the last a Luhn check digit, saying nothing about whom they name — the way
-- Zoho numbers organisations. Replaces LD-09 (KAVE-C100, KAVE-C100-U01).
--
-- Every existing code moves to "legacyCode", which is still looked up, so a
-- link or bookmark saved before this keeps opening the same company. Internal
-- ids are untouched. Deleted companies' codes (OrgClosure."orgCode") stay as
-- they were: numeric codes can never equal them.

ALTER TABLE "Account" ADD COLUMN "legacyCode" TEXT;
ALTER TABLE "Org" ADD COLUMN "legacyCode" TEXT;
ALTER TABLE "User" ADD COLUMN "legacyCode" TEXT;
CREATE UNIQUE INDEX "Account_legacyCode_key" ON "Account"("legacyCode");
CREATE UNIQUE INDEX "Org_legacyCode_key" ON "Org"("legacyCode");
CREATE UNIQUE INDEX "User_legacyCode_key" ON "User"("legacyCode");

-- Same rule as checkDigit() / newDisplayCode() in services/displayCodes.ts.
CREATE OR REPLACE FUNCTION clor_luhn(body TEXT) RETURNS INT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s INT := 0; d INT; i INT;
BEGIN
  FOR i IN 0 .. length(body) - 1 LOOP
    d := substr(body, length(body) - i, 1)::INT;
    IF i % 2 = 0 THEN d := d * 2; IF d > 9 THEN d := d - 9; END IF; END IF;
    s := s + d;
  END LOOP;
  RETURN (10 - s % 10) % 10;
END $$;

CREATE OR REPLACE FUNCTION clor_new_code() RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE body TEXT;
BEGIN
  body := (1 + floor(random() * 9))::INT::TEXT || lpad(floor(random() * 100000000)::BIGINT::TEXT, 8, '0');
  RETURN body || clor_luhn(body)::TEXT;
END $$;

DO $$
DECLARE r RECORD; c TEXT;
BEGIN
  -- Companies.
  FOR r IN SELECT id, code FROM "Org" WHERE code IS NULL OR code !~ '^[1-9][0-9]{9}$' LOOP
    LOOP
      c := clor_new_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Org" WHERE code = c);
    END LOOP;
    UPDATE "Org" SET "legacyCode" = r.code, code = c, "codeNumber" = NULL WHERE id = r.id;
  END LOOP;

  -- Users.
  FOR r IN SELECT id, code FROM "User" WHERE code IS NOT NULL AND code !~ '^[1-9][0-9]{9}$' LOOP
    LOOP
      c := clor_new_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE code = c);
    END LOOP;
    UPDATE "User" SET "legacyCode" = r.code, code = c, "codeNumber" = NULL WHERE id = r.id;
  END LOOP;
END $$;

-- Accounts: the new code of the company whose old code they carried (their
-- first company); an account whose company is gone gets a fresh one.
UPDATE "Account" a SET "legacyCode" = a.code, code = o.code
FROM "Org" o
WHERE o."legacyCode" = a.code AND a.code IS NOT NULL AND a.code !~ '^[1-9][0-9]{9}$';

DO $$
DECLARE r RECORD; c TEXT;
BEGIN
  FOR r IN SELECT id, code FROM "Account" WHERE code IS NOT NULL AND code !~ '^[1-9][0-9]{9}$' LOOP
    LOOP
      c := clor_new_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Org" WHERE code = c) AND NOT EXISTS (SELECT 1 FROM "Account" WHERE code = c);
    END LOOP;
    UPDATE "Account" SET "legacyCode" = r.code, code = c WHERE id = r.id;
  END LOOP;
END $$;

DROP FUNCTION clor_new_code();
DROP FUNCTION clor_luhn(TEXT);
