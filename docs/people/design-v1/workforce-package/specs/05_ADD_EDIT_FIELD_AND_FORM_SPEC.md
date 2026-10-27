# WF-05 — Add/Edit Employee: forms, fields, validation, step flows

## General contract
Use existing Clor form stack and validators. Create via four steps: **1 Personal → 2 Employment → 3 Organization → 4 Review**. Edit uses tab/section scoped editing rather than forcing the create wizard, unless schema changes warrant a guided update. Form uses labels above controls, controlled validation, standardized date picker, 1 column mobile, up to 2 columns desktop, bottom sticky action bar.

## Field rules (suggested contract; reconcile PRD and live schema)
| Step | Field | UI type | Validation | Privacy |
|---|---|---|---|---|
| Personal | legal first/last name | single-line input | trim, nonempty according to policy, Unicode names; max length per model | ordinary HR |
| Personal | preferred name | single-line optional | no unsupported characters ban | ordinary HR |
| Personal | work email | email optional/conditional | syntax, conflict policy, case-insensitive normalized search; not universal mandatory | work contact |
| Personal | personal email | email optional | verify consent/visibility; not used for dedupe by itself | restricted |
| Personal | phone and country | tel with country selector | E.164 where possible, allow local business rules | restricted by policy |
| Personal | DOB/gender | date/select conditional | no impossible dates; required only when lawful and configured | sensitive |
| Personal | address / emergency contacts | structured repeatable address/contact | relationship and numbers optionally validated; only relevant circumstances | sensitive |
| Employment | employee number | text or configured sequence | unique in **legal company** and episode policy, server enforced | ordinary HR |
| Employment | type/work arrangement | configured select | one of company-authorized options | ordinary HR |
| Employment | joining date | date | legitimate employment date range, effective-date checks | ordinary HR |
| Employment | end / probation date | conditional date | chronological consistency and policy | restricted HR |
| Employment | employment status | configured state | guarded transitions, cannot free-text create | restricted HR |
| Organization | department | search combobox | scoped active department, historical valid if backdated | ordinary HR |
| Organization | designation | search combobox | valid company job role, effective date | ordinary HR |
| Organization | branch/location | scoped select | company/branch access; policy | company scope |
| Organization | manager | async employee lookup | not self; no cycles; only valid scoped candidates | record scope |
| Organization | grade/cost center | conditional select | configured mapping; no silent cross-app default | restricted HR |
| Review | consent/policy acknowledgment | checkboxes when required | explicit text/version evidence | policy sensitive |

Additional government/bank/medical fields are not automatically added; map approved fields and permissions from source PRD. No explicit universal validation rejecting workers without app login.

## Form states and exact actions
`Cancel`: if dirty → discard dialog; else navigate back. `Back`: go to previous step without resetting. `Save Draft`: persist through approved draft endpoint with explicit state and TTL/access policy; if unsupported, omit rather than fake. `Continue`: validate current step, focus first invalid field + show summary. `Create Employee`: validate all steps server-side, use idempotency key and one in-flight request, show progress, then success detail link. `Edit`: mark changed values, explicit Save/Cancel, show pending workflow for fields needing approval. `Enter` in text input is not submit for a multi-step form; `Enter` in focused button may activate it.

## Validation UX
Validate obvious syntax on blur; server is authoritative. Inline error immediately under field with icon + plain text, status red border + accessible description. If multiple errors show top anchor summary with field links. Async selector with loading, no results, denied and retry states. Keyboards: inputmode=email/tel/numeric where appropriate; press Escape closes selector without wiping field.

## Draft/unsaved consistency
- Optional draft persisted to server only with approved endpoint and entitlement; optional encrypted local buffer must avoid highly sensitive fields.
- Offline transient input remains in memory; no promise of offline submission if backend is required.
- Tab close, browser Back, company switch triggers unsaved guard; no silent loss.
- Partial network save failure retains values; retry must be idempotent.
- Competing update 409 shows clear compare/reload. `Cancel` when draft saved distinguishes `Discard unsaved changes` vs `Delete saved draft`.

## Creation business logic to verify
Allow record without a User; prevent duplicate employee numbers in same company; check multi-company/multiple employment scenario according to active data model; never dedupe on same human name alone. If auto-numbering configured, server allocates under transaction; do not predict next ID client-side.
