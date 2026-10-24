# Release runbook — tenant-platform upgrade (branch `claude/subscription-provisioning-gap-003-b84bad`)

What to do, in order, to put Batches 1–10 into production. Everything below was proven on the local dev database (API as the `clor_app` role) and in the test suites; nothing here has been applied to a shared or production database yet.

## 1. Before the deploy

| Check | Why | How |
|---|---|---|
| `MAIL_SECRET_KEY` is set | Share-link copies, SMTP and SSO secrets are encrypted with it; without it they fall back to `JWT_SECRET`. Share links read with either key (A-32), so setting it now is safe | Cloud Run env |
| The runtime database role owns nothing and has no BYPASSRLS (A-36) | Row-level security now fails closed (A-35); an owner or superuser skips it entirely | `scripts/provisionAppRole.mjs`, then the app's `DATABASE_URL`s use that role; migrations keep the owner role |
| The runtime role has default privileges on every schema | New tables (credentials, portal sessions) must be readable by it | `provisionAppRole.mjs` already runs `ALTER DEFAULT PRIVILEGES`; re-run it after the migrations if the role was made by hand |
| Backups / point-in-time recovery on | 17 migrations, one of which rewrites every RLS policy | Cloud SQL |

## 2. Migrations (run as the owner role, `npm run prisma:deploy`)

In timestamp order per schema; all are additive except the policy rewrite.

- platform: `20261023100000_explicit_subscription_default`, `20261023180000_maker_checker_policy`, `20261023200000_job_lease_fencing`, `20261023200100_closure_purge_checkpoint`, `20261023200200_job_runs`, `20261024100000_rls_fail_closed`, `20261024110000_org_closure_code`, `20261024120000_credentials`, `20261024120100_credentials_rls`, `20261024120200_scim_token_status`, `20261024120600_credentials_permission_grant`
- accounting: `20261024100000_rls_fail_closed`, `20261024120300_share_link_hash`
- payroll: `20261024100000_rls_fail_closed`
- people: `20261024100000_rls_fail_closed`, `20261024120400_portal_sessions`, `20261024120500_portal_sessions_rls`

`rls_fail_closed` refuses to run if any `tenant_isolation` policy has an unexpected shape — that is a stop, not something to force.

## 3. Rolling deploy

Two instances run old and new code side by side for a few minutes. Built for it:
- Credentials: a token works only if the registry **and** its own table allow it; revocations are written to both.
- Share links: the plaintext column is still written (dropped next release, U9), so old instances still open new links.
- Portal: tokens keep their shape (plus a session id), so old instances accept them.

Escape valve if something is refused that should not be: `TENANT_STRICT=off` restores the old request-scope behaviour without a rollback.

## 4. After the deploy

- Boot runs the credential backfill once (leased); watch for `[credentials] backfill:` in the logs.
- The daily credential check (expiry warnings, orphans) starts five minutes after boot.
- Smoke: sign in; Company admin → Credentials lists keys; an API key call works; an invoice reminder link opens for a signed-out browser; the employee app signs in and lists its device.

## 5. Next release (do not skip)

- U9: stop writing and drop `DocumentShareLink.token` (plaintext) once every instance runs this release.
- Portal: sign with a separate portal secret, accepting both for one release.
- Pre-session portal tokens stop on 2026-11-25 (fixed in code; `PORTAL_LEGACY_JWT_UNTIL` can only bring it earlier).

## Rollback

- **Within this release** (a bad deploy of these commits): roll the code back to the previous revision of this same branch; no database step.
- **Past this release** (to code from before A-35): that code never sets `clor.bypass`, so under fail-closed policies its token lookups and background jobs see no rows. First run `scripts/rls_fail_open_rollback.sql` in each of the four schemas as the owner (puts the policies back in the old shape), then roll the code back. The other migrations are additive and old code ignores them. Re-apply `20261024100000_rls_fail_closed` when rolling forward.
- Registry-only state (a paused credential, a share link paused because its invoice was cancelled) is not seen by old code until roll-forward; revoke, rather than pause, anything that must stay stopped through a rollback.
