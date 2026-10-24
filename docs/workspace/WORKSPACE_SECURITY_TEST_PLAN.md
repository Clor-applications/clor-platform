# Workspace security test plan

All in `server/src/__tests__/`, run against PostgreSQL as the non-superuser, NOBYPASSRLS application role (CI: `clor_app`).

| Area | Test file | Cases |
|---|---|---|
| Account roles and owners | accountMembership.test.ts | owner on signup; member gates; admin can't touch owners; step-up for ownership; last owner kept; audited refusals; no business data from an account role; two-account isolation incl. forged x-org-id; rename |
| Invitations | accountInvitations.test.ts | hashed single-use token; double accept → one person; revoke/expire/resend; never owner; only admins invite; foreign company; ABOVE_AUTHORITY; other account → outside access; wrong signed-in person; audit order |
| Members and access | accountMembers.test.ts | directory; access detail; suspend blocks real ledger request; reinstate; guards; remove-from-company scope; isolation; /account/me apps; audit list; sign-out revokes at once; admin grant needs step-up |
| Quotas | quotaLock.test.ts | burst of company creates / user adds stays within plan (fails without the lock) |
| Existing | tenantIsolation, rlsFailClosed, outsideAccess, rbacGuards, entitlements, routeManifest | |

Not yet: the two-account tests through the production pooling configuration (A-36 is a production setup step), CA-firm delegation (not built), billing webhooks for a real provider (not chosen).
