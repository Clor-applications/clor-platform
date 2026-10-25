# Agent master instruction — Clor People / Workforce (one module, one directory)

Act as Principal Product Designer + Staff Frontend Engineer + People Domain Engineer + QA Lead for **the EXISTING Clor SaaS platform**. Product `People`; main local-sidebar module label `Workforce` (replaces visible `Employees`). Your assignment is to complete the pending **Workforce / Employee management** specification supplied in this directory without redesigning unrelated People modules or other Clor apps.

## First: do a READ-ONLY SOURCE AUDIT (WF-00) and STOP for evidence review
Read `README.md`, `WORKFORCE_MASTER_SPEC.md`, all `specs/*`, `checklists/*`. Inspect current checkout HEAD, approved People PRD, architectural docs, data schemas, all People screens, shared shell and existing Attendance UI icons, backend routes, permissions, API guards, current tests, migrations and event integrations. Produce:
1. A table each requirement ID → EXISTS/PARTIAL/ABSENT/CONFLICT/PROPOSED with exact source file & line/commit evidence.
2. All existing People routes/components/services/models with current paths (do not infer names from this specification).
3. A backward-compatibility map for visible `Employees` → `Workforce` sidebar label, preserved client routes/deep links and unchanged DB employee IDs.
4. Screen-to-API/field/permission matrices and example response/data contracts.
5. Top risks (tenant RLS, entitlements, audit, Payroll/Attendance references, PII) and prerequisites from TP/PE checklists.
6. A minimal vertical-slice implementation plan beginning with navigation/Directory.

**NO edits, migrations, deployments, production operations, hidden permission bypasses or mock-data substitutes in WF-00.** Do not assume uploaded 23 Oct archive equals latest HEAD.

## Architecture invariants
- Reuse `packages/shell` global app rail, company selector, and People local split sidebar; one company selector. Keep existing typography/icon family (Attendance conventions). No third sidebar.
- Preserve React shared shell, current backend Node/Express/TS+Prisma architecture, existing `Org` ID as company key until explicit approved migration, account/company scopes, app entitlement, per-user grants and HR permission/field checks.
- No rebuilding authentication, tenant model, worker identities, or cross-app database join logic.
- People owns HR profile/employment; Attendance owns punch/device evidence; Payroll owns finalized pay. Consumers use approved contracts and versioned events.
- No recruitment/performance/learning/AI/RAG scope expansion. No false release claims.

## Build phase sequence after approval
**WF-01** shared navigation/components/tokens → **WF-02** directory → **WF-03** profile → **WF-04** create/edit → **WF-05** employment operations → **WF-06** import/export/bulk → **WF-07** audit → **WF-08** responsive/state coverage → **WF-09** permissions/regressions → **WF-10** reviewed rollout.

Each phase: propose minimal code diff + planned tests → implement on feature branch after approval → run typecheck/lint/unit/integration/E2E/accessibility/visual checks appropriate to the phase → report exact command/results and commit → update evidence CSV, marking VERIFIED only for proven items. STOP at phase boundary. Never run destructive DB operations without separate signed migration gate.

## Visual reference priority
1. Actual existing Attendance + People shared shell behavior (source of truth for split-sidebar geometry).
2. `assets/visual_references/split_sidebar_canonical.png` for general visual direction (NOT a pixel contract).
3. `assets/visual_references/profile_audit.png`, `employee_form_states.png`, `mobile_workforce.png` for interaction compositions; mock content is fictional and may contain inaccuracies.
4. Precise written `specs/` and checklist acceptance definitions outrank incidental image labels.

## Interaction quality hard stops
Do not mark any screen done with: dead buttons, fake filters, decorative save/import/export, duplicated page responsibilities, incorrect Enter handling, dropdown that remains open after outside click/Escape, missing loading/empty/offline/error state, unsaved edits lost on retry, unauthorized fields rendered in API response/DOM, company data leaking after switch, unscoped export, audit diff containing raw PII, mobile horizontal overflow, missing keyboard focus, API conflict overwritten silently.

## Delivery format per phase
```
Phase / source SHA / PRD version:
Audit matrix with source references:
Changed paths + reason:
Permissions/tenant impact:
Exact visual screenshots (desktop/tablet/mobile):
Test commands + pass/fail counts (not fabricated):
Known gaps and residual risks:
Next safe gate:
```

This directory is a requirements package, **not** a claim that the Workforce application is finished.
