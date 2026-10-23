# TP-00 Discovery and Baseline Tracker

Updated: 2026-10-23

| ID | Task | Status | Evidence now | Change or evidence still needed |
|---|---|---|---|---|
| TP00-01 | Pin source baseline and compare supplied artifacts | PARTIAL | Branch, remote, commit recorded in `EVIDENCE_REGISTER.md`; working tree recorded | No source archive was supplied for byte comparison; dirty files must be attributed before later code changes |
| TP00-02 | Inventory repositories, apps, services, routes, workers, stores, CI/CD, observability | PARTIAL | Source inventory in `CURRENT_ARCHITECTURE.md`; 662 route declarations generated | Verify Cloud Run revisions, Cloudflare routes, secrets, metrics, backups, and physical DB topology live |
| TP00-03 | Build route manifest with auth, tenant, permission, entitlement and audit gates | PARTIAL | CSV covers 662 declared routes; 551 classified as tenant-human, 18 non-human/token, 89 need manual review | Add entitlement/audit fields and resolve all 89 mixed/public/auth/portal routes manually |
| TP00-04 | Inventory non-HTTP entry points and tenant-context propagation | PARTIAL | Startup jobs and services listed in `NON_HTTP_WORKERS.md` | Prove every batch query enumerates tenant scope or uses a justified global lease/query |
| TP00-05 | Map identity, tenant and workforce relationships | PARTIAL | Current IDs and source relations documented | Canonical Worker/Employment and CA Engagement do not yet exist as platform contracts |
| TP00-06 | Document end-to-end journeys | PARTIAL | Existing flows identified from routes/tests | Add sequence evidence for signup, invite, SSO, company switch, employee portal, reader ingest, API key, billing, offboarding |
| TP00-07 | Audit tenant isolation in source, database, storage, cache, jobs and reporting | PARTIAL | Tenant middleware, scoped Prisma wrapper, RLS migrations, cross-tenant tests located | Confirm policies applied in each deployed DB, runtime DB roles cannot bypass RLS, R2/object keys and caches are tenant-bound |
| TP00-08 | Audit authorization and privilege escalation | PARTIAL | Session liveness, RBAC middleware, platform operator separation and tests located | Complete route-by-route maker-checker, ownership, delegated-role and direct-object checks |
| TP00-09 | Run cross-tenant and negative authorization matrix | PARTIAL | Existing isolation/global identity/RLS/permission tests identified | Execute full role matrix and retain test output; add missing non-human principal cases |
| TP00-10 | Verify SSRF, upload, object storage, redirect and parser controls | PARTIAL | Source has URL validation and body caps; webhook/pull paths identified | Validate DNS rebinding/redirect behavior, MIME/content checks, signed URLs, malware process, object-key ownership |
| TP00-11 | Map deployment, secrets, observability, backup and restore | PARTIAL | Render, Docker, Cloud Build and GitHub workflow files located | Live Cloudflare/Cloud Run/DB/backup evidence and restore drill are missing |
| TP00-12 | Produce decision matrix, threat register and implementation order | VERIFIED | `DECISION_LOG.md` and `THREAT_AND_GAP_REGISTER.md` created | Decisions marked PROPOSED still need approval before schema/behavior changes |

## Stage result

- Verified tasks: 1 of 12
- Partial tasks: 11 of 12
- Gaps already requiring implementation: canonical workforce identity contract, entitlement convergence, fail-closed provisioning policy, complete non-human principal model, deployed RLS proof.
- Production changes made: none.

TP-00 cannot be closed from repository inspection alone. The source baseline is strong enough to begin targeted verification and test expansion while live evidence is collected.

