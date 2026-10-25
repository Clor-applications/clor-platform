# WF-00 — Scope, architecture and non-negotiables

## Product definition
`People` is the app; `Workforce` is the navigation module; `Employee Directory` is its default screen. A worker can exist with no authenticated platform User. An employee may participate in one or more employment episodes; a company name alone must never be treated as a cross-tenant worker identity.

## Ownership boundaries
| Area | Source of truth | Workforce UI responsibility |
|---|---|---|
| Login / session / company switch / app access | Clor platform shared shell + API | Consume existing context, do not implement separately |
| Canonical worker identity and employee mapping | Existing People IDs + agreed thin Workforce Core contract (target) | Preserve stable identifiers, surface controlled mappings |
| Rich person/HR profile / employment history / manager changes | People | Authoritative HR CRUD, authorization, effective-date history |
| Time punches, device health, shifts, clock events | Attendance | Only authorized summary/deep links when subscribed |
| Leave ledger | Existing shared People/Workforce leave path (canonical ownership to be reconciled) | Link to Leave & Holidays, no duplicate balances |
| Salary, payroll run, final settlement | Payroll | Show references only with entitlement; never calculate or edit finalized pay |
| Documents | People + R2 signed access layer | Secure versioned upload, review and download |
| Audit and approval inbox | Platform audit/workflow plus People product events | Record timelines and contextual action statuses |

## Current system guardrails (per 23 Oct archive audit; recheck live)
- Shared shell examples: `packages/shell/Shell.jsx`, `session.jsx`, `registry.js`, `appHosts.js`; People manifest and existing People screens already exist.
- Node/Express/TypeScript API and separate Prisma models for Platform, People and Payroll. Attendance product code currently uses People database in audited snapshot; do NOT assert physically independent DB.
- Persisted `Org` currently represents legal company. Do not replace with `Company` by global search/replace.
- Historical audit identified fail-open RLS if tenant context absent and partial subscription/seat/SoD enforcement. **WF release cannot be certified until platform gates are independently verified.**
- Review up-to-date source before deciding employee route, IDs, enum names, API path, or migration.

## In scope
Directory; search/filters/saved views; employee details; personal/contact/emergency fields; job/employment/organization; documents; effective-dated events; add/edit/drafts; transfers/promotion/manager/status change; archive/reactivation; controlled import/export/bulk; record timeline; permissions; responsive UX; keyboard and networking/error states; QA and evidence.

## Out of scope / integrations
Recruitment pipelines, performance, learning, AI, payroll calculations, biometric ingestion, independent leave ledger, app billing management, new tenant/auth architecture. If needed, create a separately approved ADR and delivery ticket rather than ship under Workforce.

## Vertical-slice implementation policy
WF-00 is read-only: compare latest PRD + current HEAD + migration history + deployed behavior. Build path-by-path EXISTS/PARTIAL/ABSENT/CONFLICT matrix with screenshots. Wait for Tenant Platform gate evidence before writes that touch scope/authz models. For each feature: UX contract → API/data mapping → authorization test → UI → test → visual diff → evidence.

## Terminology rules
`Workforce` visible module label; `Employee` record type and natural language in page names; `Employee ID` company-specific identifier; `User` is login principal; `Person/Worker` only when established in approved source; `Employment` is episode/assignment, not equivalent to User. Keep established API/DB nomenclature unless explicitly approved.
