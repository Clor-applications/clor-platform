-- Finishes 20261027090000_numeric_display_codes for companies.
--
-- "Org" has row-level security that fails closed (20261024100000): without
-- clor.bypass the earlier migration saw no companies at all, so companies kept
-- their KAVE-C100 codes while users got numbers, and every account — finding
-- no company whose old code matched — was given a fresh number of its own.
-- Here, with the bypass on: companies get their numbers, and each account
-- takes the new code of the company whose old code it carried.
--
-- Safe where the first migration already worked (a database without the
-- policy): nothing matches and nothing changes.

SET clor.bypass = 'on';

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
  FOR r IN SELECT id, code FROM "Org" WHERE code IS NULL OR code !~ '^[1-9][0-9]{9}$' LOOP
    LOOP
      c := clor_new_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Org" WHERE code = c) AND NOT EXISTS (SELECT 1 FROM "Account" WHERE code = c);
    END LOOP;
    UPDATE "Org" SET "legacyCode" = r.code, code = c, "codeNumber" = NULL WHERE id = r.id;
  END LOOP;
END $$;

-- The account's old code (its first company's) is in its legacyCode now.
UPDATE "Account" a SET code = o.code
FROM "Org" o
WHERE o."legacyCode" = a."legacyCode" AND a."legacyCode" IS NOT NULL AND a.code IS DISTINCT FROM o.code;

DROP FUNCTION clor_new_code();
DROP FUNCTION clor_luhn(TEXT);

RESET clor.bypass;
