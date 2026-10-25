# R2 buckets (2026-10-24, through the Cloudflare connection, owner-approved)

| Bucket | Created | Location | Jurisdiction | Public access |
|---|---|---|---|---|
| clor-files-dev | 2026-10-24 12:20 UTC | ENAM | default | none (no r2.dev URL, no custom domain) |
| clor-files-prod | 2026-10-24 12:20 UTC | ENAM | default | none |

Before: R2 enabled, 0 buckets (`r2_buckets_list` → `{"buckets":[],"count":0}`).
The connection cannot set a location hint, so both landed in ENAM (eastern North America).
Owner action: for Indian customer files, delete `clor-files-prod` (empty) and create it again with the
Asia-Pacific (APAC) location hint, private.
Not yet done: an R2 API token (Object Read & Write, this bucket only) in `server/.env` for the live check
(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET=clor-files-dev, FILE_STORE=r2).
