# GAP-006 — outside access (accountant / auditor) — access grant core

Owner decision (2026-10-24): build the **access grant core**, not the partner platform.
Source spec: `Clor R&D/05_CA_PARTNER_ARCHITECTURE.md` §4, §6, §7, §10. Partner accounts, firm staff,
staff × client assignments, partner billing and partner screens are **out of scope**.

## What it is

A person whose home account is not the company's account (ADR-002/003, GAP-011) reaches that
company only through an **engagement**: the company's consent, recorded, with a scope and an end.

| Field | Meaning |
|---|---|
| `orgId`, `accountId` | the company (client) and the account that owns it |
| `userId`, `homeAccountId` | the outside person and where they signed up |
| `status` | ACTIVE, SUSPENDED, REVOKED (expired is derived from `expiresAt`, never stored) |
| `apps` | comma list (accounting, payroll, people, attendance) the person may use here; null = whatever the company has |
| `expiresAt` | optional end |
| `approvedByUserId/At` | who in the company granted it (null = carried over at deploy) |
| `suspended…`, `revoked…`, `reason` | who stopped it, when, why |

## Rules (requirements)

- R1 Every request into a company by an outside person needs a live engagement (ACTIVE, not expired);
  otherwise 403 with `OUTSIDE_ACCESS_ENDED` / `OUTSIDE_ACCESS_SUSPENDED` / `OUTSIDE_ACCESS_EXPIRED`. Checked
  in `resolveTenant`, before any company data is read. Own-account people are unaffected.
- R2 The app ceiling is enforced in the common authorization path beside the subscription ceiling:
  a module of an app outside `apps` → 403 `APP_NOT_IN_ENGAGEMENT`. The company's own subscription still
  applies (a ceiling never grants an app the company does not have — §10 row 5).
- R3 A company (and its branches) with no live engagement is absent from the person's `/auth/me` and
  login lists (§10 row 6).
- R4 An engagement is created when the company's administrator adds an outside person (consent = the
  administrator's act), with optional `apps` and `expiresAt`. Re-adding someone whose engagement was
  revoked is a fresh approval.
- R5 The company's administrators (SETTINGS · Users · EDIT) list, change scope/expiry, suspend, resume
  and revoke. The outside person can never change their own engagement (§6, own-access rule).
- R6 Revoke is final for that grant: memberships, roles and history stay (audit evidence, §7.4); access
  ends on the next request on this instance, within the access-cache TTL (30 s) on the other.
- R7 Every change is in the company audit trail in words; the list shows who granted and who ended it.
- R8 Deploy keeps everyone's access: existing cross-account memberships become ACTIVE engagements with
  no expiry and all apps, `approvedByUserId` null ("carried over").
- R9 Forced RLS on the table (A-35 pattern).

## Units

U1 schema + migration (+ backfill, RLS) · U2 `services/outsideAccess.ts` (live check, create/reactivate,
change, suspend/resume/revoke, list) · U3 enforcement in `tenantContext.resolveTenant` and `rbac.authorize`,
and filtering in `/auth/me` + login · U4 creation in POST /users (and `PUT /users/:id/companies`) · U5 routes
`/orgs/:orgId/outside-access` · U6 Company admin screen "Outside access" (DESIGN.md: list on the page ground,
one primary action — none needed; row actions) · U7 tests (§10 rows 1, 2, 3, 5, 6, 7, 8 as they apply
without partner accounts) + browser check + registers.

## Not in scope (recorded in FIX_CHECKLIST)

Partner accounts and firm staff; partner billing/sponsorship; provisional client workspaces; per-export
link revocation beyond the existing short-lived links; "who accessed what" report beyond the audit trail.
