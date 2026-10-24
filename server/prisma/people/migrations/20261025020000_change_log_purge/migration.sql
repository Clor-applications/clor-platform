-- The change log stays append-only, with one more door: a company being purged
-- after closure (services/companyClosure.ts) deletes its lines under clor.purge.
CREATE OR REPLACE FUNCTION people_refuse_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('clor.bypass', true) = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' AND current_setting('clor.purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'append_only: % rows cannot be changed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
