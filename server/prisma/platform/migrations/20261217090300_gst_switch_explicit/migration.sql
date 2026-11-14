-- GST is on only when it is switched on (Books, owner 15 Nov 2026).
--
-- Until now a company with a GSTIN on file and no GST switch was treated as
-- GST-on. Books now reads the switch alone, so companies made before the
-- switch existed get it written down as on, exactly as they behaved before.
-- A company whose switch is already set, either way, is left alone. A
-- profile that is not a JSON object is skipped rather than failing the
-- release. Running this twice changes nothing.
SET clor.bypass = 'on';

DO $$
DECLARE
  r RECORD;
  p jsonb;
BEGIN
  FOR r IN SELECT "id", "profileJson" FROM "Org" WHERE "profileJson" IS NOT NULL LOOP
    BEGIN
      p := r."profileJson"::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF jsonb_typeof(p) <> 'object' THEN CONTINUE; END IF;
    IF coalesce(trim(p->>'gstin'), '') = '' THEN CONTINUE; END IF;
    IF jsonb_typeof(p->'taxCompliances') = 'object' AND p->'taxCompliances' ? 'gstEnabled' THEN CONTINUE; END IF;
    p := jsonb_set(
      p,
      '{taxCompliances}',
      (CASE WHEN jsonb_typeof(p->'taxCompliances') = 'object' THEN p->'taxCompliances' ELSE '{}'::jsonb END)
        || '{"gstEnabled": true}'::jsonb
    );
    UPDATE "Org" SET "profileJson" = p::text WHERE "id" = r."id";
  END LOOP;
END $$;

RESET clor.bypass;
