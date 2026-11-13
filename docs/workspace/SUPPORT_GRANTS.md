# Support grants: how CLOR staff reach a customer's data

Workspace plan P2/P3, with Ops P3. Built 14 Nov 2026: see "As built" at the end.

Today a CLOR operator can see an account's *shape* in the console — companies,
users, subscription, invoices, tickets — but cannot open the customer's app and
look at the thing the customer is complaining about. So a support question ends
in "send us a screenshot".

## What already exists, and should be reused

| Piece | Where | Why it fits |
|---|---|---|
| Operators, with roles and a required authenticator | `middleware/operator.ts` | Who may ask for a grant at all. SUPPORT and SUPER_ADMIN, not SALES or BILLING |
| `OutsideAccess` | `prisma/platform`, `services/outsideAccess.ts` | The shape of consent: status, scope, `expiresAt`, who granted, who ended, reason. Enforced in `middleware/tenantContext.ts`, which is where a grant must also be checked |
| Explore's read-only session | `middleware/exploreReadOnly.ts` | A token claim (`xp`) that makes a whole session read-only, enforced once for every route before any router. A grant session can carry `sg` the same way |
| Audit trail | `routes/audit.ts`, `AuditEvent` | Where the customer reads what was done, and the place a grant's every use must appear |
| Two-person approval | `routes/opsApprovals.ts` | Already used for money-moving ops actions; the same machinery can gate a grant |

A support grant is **not** an `OutsideAccess` row. That table is the customer's
own engagements — their accountant, their auditor — and CLOR staff appearing in
that list would be both confusing and wrong to revoke by the same button.

## The shape

```
SupportGrant
  accountId, orgId          the company it opens
  operatorUserId            the one member of staff; never a role or "anyone"
  reason                    required, free text, shown to the customer
  ticketRef                 the support ticket it belongs to, when there is one
  status                    PENDING | ACTIVE | ENDED | REVOKED | EXPIRED(worked out)
  scope                     READ_ONLY, and for now only that
  requestedByUserId, requestedAt
  approvedByUserId, approvedAt     the customer's owner/admin, or CLOR's second pair of eyes
  startedAt, expiresAt             short by default
  endedByUserId, endedAt, endReason
```

Expiry is worked out from `expiresAt`, never stored, as `OutsideAccess` does.

## Where it is enforced

1. **`middleware/tenantContext.ts`** — a staff user has no membership in the
   customer's company, so they never reach it today. A live grant is the one
   thing that lets them, and it is checked in the same place the engagement is,
   next to the suspension and entry rules.
2. **A new `supportGrantReadOnly` middleware**, mounted beside
   `exploreReadOnly`, on the `sg` token claim. Writes refused for every route at
   once. Hiding buttons is courtesy; this is the rule.
3. **Never reachable under a grant, even to read**: salary and payslips,
   employee documents, bank and UPI details.
4. **Every request under a grant writes an `AuditEvent`** against the customer's
   account, naming the operator and the grant, so the customer's own audit trail
   shows it without CLOR having to tell them.

## What the customer sees

A panel in Workspace: who, why, which company, when it ends, and **End now**.
Plus a line in the audit trail for the grant and for what was done under it.
The grant is not a secret kept in the console.

## Decided (owner, 14 Nov 2026)

1. **The customer approves each grant.** An owner or admin of the account says
   yes before anything opens. No self-serve path, and no break-glass: if nobody
   answers, nobody looks.
2. **Read by default; writes only where the customer asked for them.** The
   grant carries its scope, so "see it" and "fix it" are different requests and
   the customer chose which one they agreed to.
3. **24 hours by default.** Long enough for a day of back-and-forth across time
   zones without re-approving.
4. **Shut even under a grant, reads included:** salary figures and payslips,
   employee documents, bank and UPI details. Staff can see *that* a pay run
   failed, never what anyone earns. Enforced on the server by path, like
   Explore's closed list, not by hiding buttons.

## Not in the first slice

Standing grants, grants across every company in an account at once, and a
grant that outlives a ticket.

## As built (14 Nov 2026)

| Piece | Where |
|---|---|
| Table, with row-level security on `orgId` | `prisma/platform`, migration `20261214090000_support_grants` |
| Rules: ask, approve (clock starts then, customer may only narrow), end, list | `services/supportGrants.ts` |
| Who gets in: a live grant **and** still being CLOR staff; no membership rows written | `middleware/tenantContext.ts` |
| What they may do: closed paths, read-only, never access changes | `middleware/supportGrantLimits.ts` |
| Permissions on a grant: the company's own administrator roles, narrowed by the limits above | `services/access.ts` `resolveGrantAccess`, `middleware/rbac.ts` |
| Every request under a grant in the customer's audit log (`SupportGrant` / `VIEWED`, `CHANGED`; one line a minute per path read) | `recordGrantUse` |
| Routes: customer `/orgs/:orgId/support-grants`, ops `/ops/accounts/:id/support-grants`, `/ops/support-grants` | `routes/supportGrants.ts` |
| Customer screen: Workspace → Access → CLOR support access | `apps/admin/src/screens/SupportAccess.jsx` |
| Ops: customer page → Support access tab (ask, open in the app, close) | `packages/ops/SupportAccess.jsx` |
| The app lists the company for staff with a live grant, with a banner saying so | `routes/auth.ts` `/auth/me`, `packages/shell` |

Paths are matched on the whole URL (`originalUrl`), because the limits run
inside routers where `req.path` is only the tail.

Closed to a grant even to read: all of Payroll, salary revisions and advances,
the salary question, letters (they carry pay), people documents and form
files, résumés, the statutory record (PAN, Aadhaar, UAN, bank account),
private cases, every export, and the employee portal. Closed to any write,
whatever the scope: users, roles, role profiles, permissions, security,
outside access, support grants themselves, and account membership.

Not closed: Books' bank book (accounting entries, not anybody's account
details). Ask the owner if that should change.

Ending a grant takes effect within the access cache window (a few seconds in
production), as a suspension does.

Not yet: telling the customer by e-mail when support asks (today the request
waits on the Workspace screen and in the account's security activity).
