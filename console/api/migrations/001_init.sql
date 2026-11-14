-- The Console's own database (clor_console). Two tables, nothing of a customer's.
--
-- A member is a person. They may sign in with an email address and password,
-- with GitHub, with their CLOR staff login, or any of them; each identity
-- belongs to at most one member.
CREATE TABLE IF NOT EXISTS console_member (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('OWNER', 'ENGINEER', 'VIEWER')),
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  github_user_id   BIGINT UNIQUE,            -- GitHub's numeric id: cannot be renamed or claimed
  github_login     TEXT,                     -- shown only; never used to decide access
  clor_user_id     TEXT UNIQUE,              -- the CLOR platform user id, bound at their first CLOR sign-in
  clor_email       TEXT,                     -- the address they were added by; decides access only until the id is bound
  email            TEXT,                     -- for sign-in with a password; lower case
  password_hash    TEXT,
  setup_code_hash  TEXT,                     -- one-time code to choose a password; only its hash
  setup_expires_at TIMESTAMPTZ,
  totp_secret_enc  TEXT,
  totp_enabled_at  TIMESTAMPTZ,
  totp_last_step   BIGINT,
  added_by         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (github_user_id IS NOT NULL OR clor_user_id IS NOT NULL OR clor_email IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS console_member_email ON console_member (lower(email)) WHERE email IS NOT NULL;
-- One waiting invitation per address.
CREATE UNIQUE INDEX IF NOT EXISTS console_member_clor_email_waiting ON console_member (lower(clor_email)) WHERE clor_user_id IS NULL AND clor_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS console_audit_event (
  id               BIGSERIAL PRIMARY KEY,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_id        TEXT NOT NULL,
  actor            TEXT NOT NULL,            -- the member's name when it happened
  action           TEXT NOT NULL,
  target           TEXT NOT NULL,
  reason           TEXT,
  detail           JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip               TEXT
);
CREATE INDEX IF NOT EXISTS console_audit_event_at ON console_audit_event (at DESC);

-- Append-only, whoever connects: the table owner included.
CREATE OR REPLACE FUNCTION console_audit_no_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'console_audit_event is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS console_audit_event_no_change ON console_audit_event;
CREATE TRIGGER console_audit_event_no_change
  BEFORE UPDATE OR DELETE OR TRUNCATE ON console_audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION console_audit_no_change();
