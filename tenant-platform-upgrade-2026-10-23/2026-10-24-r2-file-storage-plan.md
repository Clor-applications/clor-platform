# R2 file storage (GAP-012 follow-on)

Owner decisions (2026-10-24): build it; Claude creates the buckets (`clor-files-dev`, `clor-files-prod`,
private, created through the Cloudflare connection). Files today: `bytea` columns in the people database
(GAP-012 inventory, `evidence/GAP-012/storage-and-edge.txt`).

## Scope

| Data | Today | After |
|---|---|---|
| `EmployeeDocument.data` (documents, letters, policies, help-desk and invite attachments) | bytes in the row | object `org/<orgId>/employee-documents/<id>`; row keeps `storageKey`, empty bytes |
| `PunchPhoto.data` (punch selfies) | bytes in the row | `org/<orgId>/punch-photos/<id>` |
| `ComplianceTask.evidenceData` | bytes in the row | `org/<orgId>/compliance-evidence/<id>`, `evidenceKey` |
| `EmailOutbox.attachmentsJson` | JSON, transient | unchanged (pruned with the outbox; out of scope) |

## Rules

- S1 Private bucket; no public or r2.dev URL, no custom domain. Files are still served only by the API routes
  that check company and person today (GAP-012), with `Cache-Control: private, no-store`. No presigned URLs.
- S2 Every key starts `org/<orgId>/`; the store refuses a read, write or delete whose key does not start with
  the prefix of the company in scope (defence beside RLS on the row).
- S3 Transparent: the people client offloads on create/update/upsert and fills bytes back on reads, so the
  ~16 call sites (several still being built in the People session) need no change. Off unless
  `FILE_STORE=r2` (production) or `memory` (tests); `db` keeps today's behaviour.
- S4 Deleting a row deletes its object after the database write commits; anything missed (a crash, a raw
  delete) is found by the nightly cross-store check (objects with no row → deleted; rows whose object is
  missing → reported).
- S5 Closing a company deletes its whole prefix as a purge step (checkpointed like the other stores).
- S6 Existing bytes are moved by a resumable, leased job (`npm run files:to-r2`): put object, then set the key
  and empty the bytes, one row at a time — safe to stop and re-run.
- S7 Credentials: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — an R2 API token
  scoped to the one bucket, Object Read & Write, made by the owner in the dashboard. Never in the repo.
- S8 Rolling deploy: old instances read bytes from the row; rows offloaded by new instances have empty bytes,
  so `FILE_STORE=r2` is switched on only once every instance runs this release (runbook), and the move job
  runs after that.

## Units

U1 people migration (`storageKey` ×2, `evidenceKey`) · U2 `services/fileStore.ts` (drivers db/memory/r2 via
SigV4, prefix guard, list/delete prefix) · U3 people-client extension · U4 closure purge step · U5 move job +
script · U6 nightly orphan check in `integrity/checks.ts` · U7 tests (vitest runs with `FILE_STORE=memory`
so every People suite exercises the offload) · U8 live check against `clor-files-dev` once the owner has put
an R2 token in `server/.env` · U9 registers, runbook.

## Open for the owner

- Location: both buckets were created in ENAM (the connection cannot set a location hint). For Indian
  customer data, recreate `clor-files-prod` with the Asia-Pacific hint in the dashboard (it is empty).
- The R2 API token (S7).
