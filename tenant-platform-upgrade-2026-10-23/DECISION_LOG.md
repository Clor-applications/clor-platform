# Platform Decision Log

| ID | Status | Decision | Reason | Consequence |
|---|---|---|---|---|
| ADR-001 | OBSERVED | `accountId` is the commercial/customer owner; `orgId` is the operational data tenant | Matches Platform model and RLS setting | APIs and events must carry both where ownership matters |
| ADR-002 | OBSERVED | A global User has a home account and can access foreign-account orgs through membership | Supports accountants, auditors and group access | Token account cannot be used as the effective tenant boundary |
| ADR-003 | PROPOSED | Use explicit `homeAccountId` terminology at API/domain boundaries | Removes ambiguity without forcing an immediate destructive rename | Compatibility mapping and API versioning may be required |
| ADR-004 | PROPOSED | Create canonical Worker and Employment contracts owned by People/workforce core | Prevents separate employee masters in Payroll, Attendance, Projects and Timesheet | Requires migration/mapping from current Employee references |
| ADR-005 | PROPOSED | Model CA/delegated access as an engagement/grant lifecycle | Generic membership lacks consent, expiry and delegated scope | Existing memberships need classification and migration |
| ADR-006 | IMPLEMENTED | One effective entitlement decision service | Current Subscription and AccountEntitlement can diverge | GAP-002: `entitlementFor` intersects the Accounting plan with app ownership; RBAC rejects unowned app API calls |
| ADR-007 | IMPLEMENTED | Missing subscription is allowed only for explicit grandfathered accounts | Preserves legacy customers without granting all apps to new accounts | Migration `20261023100000_explicit_subscription_default`, `Account.legacyUnrestrictedAt`, atomic bootstrap subscription in `/signup` |
| ADR-008 | PROPOSED | Scheduled work uses a registered service principal, tenant enumeration contract, distributed lease and idempotency key | In-process timers alone do not prove safe multi-instance execution | Worker registry and common runner required |
| ADR-009 | PROPOSED | TP-09 security tests run after every stage | Tenant regressions can be introduced by any platform change | CI and evidence requirements increase but failures surface early |
| ADR-010 | ACCEPTED (owner, 2026-10-23) | Company administration is a platform workspace on `app.clor.in`, reached before any app: company profile, branches, users/invitations, company and app access, role assignment, role definitions (permissions grouped by app, subscribed apps only), security/2FA/SSO/SCIM, one audit trail, billing, data export and closure. Apps keep only app-specific settings and link to the workspace ("Roles & access", filtered to that app) | Admin pages lived only in Accounting, so a company without Accounting could not manage users; People/Attendance re-exported Accounting screens; two audit feeds | Front door stops auto-forwarding; admin screens move out of `apps/accounting`; one role editor serves every app |

`PROPOSED` decisions are not implemented until the target model and migration impact are reviewed.

