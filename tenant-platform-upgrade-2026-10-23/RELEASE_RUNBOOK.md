# Release runbook — tenant-platform upgrade (branch `claude/subscription-provisioning-gap-003-b84bad`)

What to do, in order, to put Batches 1–10 into production. Everything below was proven on the local dev database (API as the `clor_app` role) and in the test suites; nothing here has been applied to a shared or production database yet.

## 1. Before the deploy

| Check | Why | How |
|---|---|---|
| `MAIL_SECRET_KEY` is set | Share-link copies, SMTP and SSO secrets are encrypted with it; without it they fall back to `JWT_SECRET`. Share links read with either key (A-32), so setting it now is safe | Cloud Run env |
| The runtime database role owns nothing and has no BYPASSRLS (A-36) | Row-level security now fails closed (A-35); an owner or superuser skips it entirely | `scripts/provisionAppRole.mjs`, then the app's `DATABASE_URL`s use that role; migrations keep the owner role |
| The runtime role has default privileges on every schema | New tables (credentials, portal sessions) must be readable by it | `provisionAppRole.mjs` already runs `ALTER DEFAULT PRIVILEGES`; re-run it after the migrations if the role was made by hand |
| Backups / point-in-time recovery on | 20 migrations, one of which rewrites every RLS policy | Cloud SQL |

## 2. Migrations (run as the owner role, `npm run prisma:deploy`)

In timestamp order per schema; all are additive except the policy rewrite.

- platform: `20261023100000_explicit_subscription_default`, `20261023180000_maker_checker_policy`, `20261023200000_job_lease_fencing`, `20261023200100_closure_purge_checkpoint`, `20261023200200_job_runs`, `20261024100000_rls_fail_closed`, `20261024110000_org_closure_code`, `20261024120000_credentials`, `20261024120100_credentials_rls`, `20261024120200_scim_token_status`, `20261024120600_credentials_permission_grant`, `20261024140000_outside_access` (backfills every cross-account membership as an active engagement), `20261024140100_outside_access_rls`
- accounting: `20261024100000_rls_fail_closed`, `20261024120300_share_link_hash`
- payroll: `20261024100000_rls_fail_closed`
- people: `20261024100000_rls_fail_closed`, `20261024120400_portal_sessions`, `20261024120500_portal_sessions_rls`, `20261024130000_webhook_secret_rotation`, `20261025070000_file_storage_keys` (plus the People build's own)

`rls_fail_closed` refuses to run if any `tenant_isolation` policy has an unexpected shape — that is a stop, not something to force.

## 3. Rolling deploy

Two instances run old and new code side by side for a few minutes. Built for it:
- Credentials: a token works only if the registry **and** its own table allow it; revocations are written to both.
- Share links: the plaintext column is still written (dropped next release, U9), so old instances still open new links.
- Portal: tokens keep their shape (plus a session id), so old instances accept them.
- Stored secrets: this release reads the new keyed shape but still writes the old one, so old instances read everything written during the deploy.
- Outside access: old instances ignore `OutsideAccess` and let outside members in as before; new ones need the engagement, which the migration has already written for every existing one. Run the migration before the first new instance serves. An outside person added by an old instance during the deploy window has no engagement: add them again under Users (a fresh grant).
- Webhooks: the old `X-Clor-Signature` header is still sent beside the new timed one; receivers need no change on deploy day.

Escape valve if something is refused that should not be: `TENANT_STRICT=off` restores the old request-scope behaviour without a rollback.

## 4. After the deploy

- Boot runs the credential backfill once (leased); watch for `[credentials] backfill:` in the logs.
- The daily credential check (expiry warnings, orphans) starts five minutes after boot.
- A minute after boot the API gives every company's Owner role any permission this release added (`[permissions] owner sync:` in the logs). Before this release that never ran on Cloud Run, so the first run may grant many.
- The cross-store check (GAP-010) starts fifteen minutes after boot and runs nightly: watch `[integrity]` lines. Before the first run, `npm run integrity:cross-store` (report only) shows what it will repair; Payroll lines are for a person to look at.
- Smoke: sign in; Company admin → Credentials lists keys; an API key call works; an invoice reminder link opens for a signed-out browser; the employee app signs in and lists its device.

## 4a. Files to R2 (after every instance runs this release)

1. Recreate `clor-files-prod` with the APAC location hint if it is still in ENAM (it is empty).
2. Make an R2 API token: Object Read & Write, `clor-files-prod` only. Set on Cloud Run: `FILE_STORE=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (as a secret), `R2_BUCKET=clor-files-prod`. Deploy.
3. New files now go to R2. Move the old ones: `npm run files:to-r2` (owner role, resumable).
4. Next morning: `[integrity]` lines show any row whose object is missing (should be none).
5. Back out: `npm run files:to-r2 -- --back`, then unset `FILE_STORE`. Never unset `FILE_STORE` first: rows that point at R2 would read as empty files.

## 5. Next release (do not skip)

- U9: stop writing and drop `DocumentShareLink.token` (plaintext) once every instance runs this release.
- Portal: sign with a separate portal secret, accepting both for one release.
- Stored secrets: set `SECRET_FORMAT=v2` (or make it the default) once every instance runs this release, so new secrets name their key (A-34). To change `MAIL_SECRET_KEY` later: move the old value to `MAIL_SECRET_KEY_PREVIOUS`, set the new one, deploy; old secrets still open and are rewritten as they are saved.
- Pre-session portal tokens stop on 2026-11-25 (fixed in code; `PORTAL_LEGACY_JWT_UNTIL` can only bring it earlier).

## Rollback

- **Within this release** (a bad deploy of these commits): roll the code back to the previous revision of this same branch; no database step.
- **Past this release** (to code from before A-35): that code never sets `clor.bypass`, so under fail-closed policies its token lookups and background jobs see no rows. First run `scripts/rls_fail_open_rollback.sql` in each of the four schemas as the owner (puts the policies back in the old shape), then roll the code back. The other migrations are additive and old code ignores them. Re-apply `20261024100000_rls_fail_closed` when rolling forward.
- Outside access is enforced only by this release: after a rollback, paused or ended outside people get in again until roll-forward. End their membership under Users (not only their engagement) if they must stay out through a rollback.
- Registry-only state (a paused credential, a share link paused because its invoice was cancelled) is not seen by old code until roll-forward; revoke, rather than pause, anything that must stay stopped through a rollback.
