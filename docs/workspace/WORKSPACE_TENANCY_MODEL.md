# Workspace tenancy model

| Concept | Where it lives | Notes |
|---|---|---|
| User (global identity) | platform `User` (email unique) | `User.accountId` is the home account (where they signed up). |
| Account (tenant) | platform `Account` | Hard boundary; companies, members and plan belong to it. |
| Account membership | `AccountMembership` (W-1) | role OWNER / ADMIN / BILLING_ADMIN / MEMBER, status ACTIVE / SUSPENDED; one per person per account; only for people whose home is that account. |
| Company | platform `Org` | `/o/<CODE>/` in the address. |
| Company membership | `UserOrgMembership`, `UserBranchMembership` | what lets a person into a company and its branches. |
| Person from another account | `OutsideAccess` (GAP-006) | per company, apps, time-bound, revocable; shown as "outside access". |
| Application entitlement | `Subscription` / `SubscriptionItem`, `AccountEntitlement` | server-side in `rbac.authorize` (402) and `requireApp`. |
| Application access (personal) | the person's roles in the company → permissions → apps | shown on the Workspace as "Access not assigned" when absent. No separate assignment table (decision pending, W-4.2). |
| Application role | `Role`, `RolePermission`, `UserRoleAssignment`, role profiles | per company; presets in `permissionCatalog.ts`. |
| Clor Operator | `CLOR_OPERATOR_USER_IDS` allowlist + operator step-up | not a customer role; no console yet. |

Rules enforced (tests in `server/src/__tests__/account*.test.ts`):
- Signup creates the account and its OWNER membership in one transaction.
- An invitation never makes an owner; owners are made by owners with step-up; the last active owner cannot step down or be suspended.
- No account role opens business data; a company role does.
- A suspended member opens no company of the account (`tenantContext`, `ACCOUNT_MEMBER_SUSPENDED`).
- Every query runs under fail-closed RLS keyed on the company; account-level reads name their account explicitly (`outsideTenant`).
