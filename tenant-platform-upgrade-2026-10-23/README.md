# CLOR Tenant Platform Upgrade

Started: 2026-10-23  
Scope: platform identity, tenant isolation, account/org/branch/user identifiers, authorization, entitlements, non-human principals, database boundaries, and evidence-led upgrades.  
Reference checklist: `/Users/suresh/Desktop/CLOR_TENANT_PLATFORM_CHECKLIST.md`  
Source baseline: `main` at `1b8eaecbe6ed495547da718b12a39af1738140aa`

This folder is the control room for the platform upgrade. The reference checklist is an input, not proof. A task is complete only when its acceptance criteria, evidence, tests, and change record are present here.

## Current stage

`TP-00 — Discovery and Baseline` is in progress. No platform behavior or production configuration was changed in this stage. The first pass verified the source architecture and created a reproducible route inventory. Live deployment, real-database topology, and production RLS enforcement still require environment evidence.

## Status vocabulary

- `VERIFIED`: source plus an appropriate test or runtime artifact supports the claim.
- `PARTIAL`: some implementation/evidence exists, but the exit criteria are not met.
- `GAP`: required control is absent or a current rule conflicts with the target architecture.
- `BLOCKED`: the evidence needs an unavailable archive, environment, role, or external system.
- `NOT STARTED`: no verification work has begun.

## Folder map

- `TP00_CHECKLIST_STATUS.md` — task-by-task status, next action, evidence, and change need.
- `CURRENT_ARCHITECTURE.md` — observed source architecture and trust boundaries.
- `IDENTITY_AND_TENANCY.md` — authoritative IDs, relationships, and unresolved decisions.
- `AUTHORIZATION_AND_ENTITLEMENTS.md` — RBAC, app access, feature access, and commercial controls.
- `NON_HTTP_WORKERS.md` — schedulers, retries, purges, and tenant-context risks.
- `DATA_BOUNDARY_AND_RLS.md` — Prisma stores, request scoping, RLS evidence, and deployment caveats.
- `TEST_PLAN.md` — required automated and live evidence before later stages can close.
- `THREAT_AND_GAP_REGISTER.md` — prioritized risks and implementation backlog.
- `EVIDENCE_REGISTER.md` — commands and artifacts used for each conclusion.
- `DECISION_LOG.md` — accepted, proposed, and unresolved platform decisions.
- `CHANGE_LOG.md` — every change made during this upgrade.
- `evidence/route-inventory.csv` — generated HTTP surface inventory.
- `scripts/inventory-routes.mjs` — repeatable inventory generator.

## Stage gates

1. Finish TP-00 evidence and approve the target identity/tenancy decisions.
2. Implement TP-01 identity and session changes with migration, rollback, and tests.
3. Implement tenant, entitlement, authorization, database, and interoperability stages in dependency order.
4. Run TP-09 security validation continuously after each stage, not only at the end.

The current docs intentionally distinguish source-observed facts from deployed facts. Four Prisma clients are confirmed in source; four physically separate production databases are not yet confirmed.

