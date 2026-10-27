# WF-13 — Functional/visual QA and evidence gates

## Gate WF-00 — Source audit (read only)
Pin live git SHA and PRD version; manifest People routes, screens, models, company selectors, permission and product guards, imports, audit and integrations. Snapshot current UI desktop/mobile. Map each workbook item to EXISTS/PARTIAL/ABSENT/CONFLICT/PROPOSED. List blockers, compatibility routes, migrations and return before coding dependent data/auth changes.

## Gate WF-01 — Shell + design system
Existing global app rail preserved across Books/People/Payroll/Attendance; People local nav label Workforce; exactly one company switcher; responsive collapse test; no duplicate sidebar route for employee forms.

## Gate WF-02 — Directory
Page data matches current account/company/employee scope; filters and selections work, sensible performance at scale, mobile cards, saved views and bulk toolbar working when supported. Hover/focus/keyboard correct; empty/offline/retry views tested.

## Gate WF-03 — Profile
Tabs deep-link, independent field visibility, sensitive masking, no duplicated panels, async documents/activity properly authorized, employment history effective-dated.

## Gate WF-04 — Forms
Field map reconciled against approved PRD/model; creates employee without platform login, uniqueness and date rules; server validation; dirty/409 conflict; retries safe; no accidental Enter creation.

## Gate WF-05 — Employment operations
Manager changes and transfers respect hierarchy/approval, preserve historical validity; archive does not hard-delete; payroll and attendance references unchanged. Failure and partial event publishing tests.

## Gate WF-06 — Import/Export/Bulk
Dry-run works; row-level validation and idempotent processing, restricted fields absent from unauthorized exports; cross-company job downloads denied; formula injection prevented.

## Gate WF-07 — Audit
Every material successful change yields actor/action/date/effective-date/diff in server event; failed attempts follow security policy; events are scoped/redacted; no client-only history.

## Gate WF-08 — Responsive + states
1440 desktop, 1024 tablet, 390 & 360 mobile, 200% zoom, keyboard-only, VoiceOver/TalkBack where available. 401,403,404,409,422,429, 500/503, offline/slow, import partial and upload failure states. No hidden state that destroys unsaved input.

## Gate WF-09 — Security and regressions
Run positive and negative account/company/app/user/field/document/event tests and shared shell regressions; RLS/entitlement/maker-checker Tenant Platform dependencies proven. Attendance biometric/punch ingestion and Payroll reference regression preserved.

## Gate WF-10 — Signoff & rollout
Evidence register has commit/PR, executed test command and output, reviewer, date, exact screenshot, residual risks. Fix critical a11y/security issues, document rollback/flag, no destructive production migration without staging+approved rehearsal. Completion only when evidence verified.

## Evidence definition
Screenshot alone = visual evidence only; cannot mark functional tasks done. A generated design asset = concept. Code presence = implementation candidate, not deployed behavior. A passing unit test with mocks = limited evidence, not backend authorization coverage. Any checkbox remains TODO without explicit verifiable test artifact.
