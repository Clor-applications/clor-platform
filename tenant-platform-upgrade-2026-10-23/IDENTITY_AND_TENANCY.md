# Identity and Tenancy Baseline

## Observed model

| Concept | Current source of truth | Current identifier | Finding |
|---|---|---|---|
| Account | Platform `Account` | `accountId` | Commercial/customer boundary; owns organizations and users |
| Organization/company | Platform `Org` | `orgId` | Operational tenant boundary used by RLS and most product rows |
| Branch | Platform `Branch` | `branchId` | Sub-scope inside an organization |
| Login person | Platform `User` | `userId` | Global email identity; `User.accountId` is the home account |
| Organization access | Platform `UserOrgMembership` | membership ID plus account/org/user | Resolves the effective account for the selected organization |
| Role grant | Platform role assignment | user/org/role references | Separate from membership; membership alone should not grant business permission |
| Workforce person | People `Employee` | `employeeId` | Current workforce reference used by People/Attendance/Payroll integrations |
| Employee portal identity | People portal records | employee-scoped credential/session | Separate authentication path from platform User |
| External service principal | Multiple token tables/route-specific credentials | route-specific | No single platform principal/grant abstraction yet |

## Verified behavior

1. One email maps to one `User` globally.
2. A user has a home `accountId`, but can work in another account through an organization membership.
3. `requireTenantContext` resolves `req.tenant.accountId` from membership and validates organization, branch, and warehouse scope.
4. Product databases store platform IDs as scalar strings because cross-database foreign keys do not exist.
5. RLS uses `orgId` as the database tenant setting, while application checks also carry `accountId`, branch, warehouse, user, role and permission.

## Required platform decisions

- Keep `User.accountId` explicitly named and documented as `homeAccountId` semantically, even if a physical rename is deferred for compatibility.
  Done (GAP-011, Batch 11): `/auth/me` returns `user.homeAccountId` and `activeAccountId` (the account owning the active company); server code reads the token's account only for the person's own sessions and for creating a company in their own account.
- Make `orgId` the canonical data-tenant key and `accountId` the commercial/customer owner key.
- Introduce a canonical Worker plus Employment contract before Projects/Timesheet and deeper Payroll integration. `Employee` can migrate into or map to that contract, but duplicate workforce masters are forbidden.
- Define CA/delegated access as an explicit engagement/grant with lifecycle, scope, expiry and audit, instead of treating it as a normal membership forever.
- Unify human, employee-self-service, API key, device, agent, SCIM and scheduled-work identities under a principal vocabulary, while retaining credential-specific authentication.
- Every cross-store reference needs ownership validation at write time, reconciliation, and an auditable repair path.

## Identity invariants to test

- A token’s home account cannot override the account owning the selected organization.
- A membership in organization A cannot read or mutate organization B, including when both share one account.
- A user invited across accounts remains one global identity and receives only explicitly assigned roles.
- `employeeId`, `userId`, and external-directory IDs cannot be substituted for each other.
- Deactivation, session revocation, membership removal, employee termination and delegated-access expiry each remove the correct access without deleting historical records.

