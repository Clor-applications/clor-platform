# Authorization and Entitlements Baseline

## Existing enforcement layers

1. Authentication: JWT signature, issuer/audience, active user and live session.
2. Tenant selection: organization membership plus branch/warehouse access.
3. RBAC: module/action/resource permissions and route-specific guards.
4. Feature settings: organization-level product switches.
5. Commercial subscription: account-level app ownership, standing and optional seats.
6. Accounting plan entitlement: legacy account plan, feature extras and company/user limits.

## Completed fix: Accounting entitlement convergence

### Two entitlement authorities

`Subscription`/`SubscriptionItem` remains the app-ownership authority and `AccountEntitlement` remains the plan ceiling inside Accounting. Effective features now require Accounting ownership, and the shared RBAC authorization path returns `402 APP_NOT_SUBSCRIBED` for Accounting permission modules when the app is absent. A direct invoice endpoint test proves role permissions cannot reopen removed commercial access.

## Remaining gap: fail-open legacy provisioning

Accounts without a subscription receive all sellable apps. That protected existing customers during rollout, but it is unsafe as the permanent provisioning rule. The upgrade needs an explicit legacy grandfather state and a fail-closed rule for newly created accounts.

### Seats are advisory at service boundaries

Seat checking exists, but route-by-route enforcement and the meaning of a seat differ across platform users, People employees, Payroll employees, and portal users. The platform must define a meter per app and enforce it transactionally.

### Delegated access lacks a first-class lifecycle

Cross-account membership enables an accountant/auditor scenario, but it does not by itself model engagement owner, client consent, expiry, revocation reason, evidence, or restricted scope.

## Target effective-access decision

For every request or job, access should be the intersection of:

`authenticated principal` + `active grant/membership` + `selected org/branch scope` + `RBAC/ABAC permission` + `account subscription` + `org feature switch` + `seat/capacity rule` + `resource ownership` + `step-up/maker-checker when required`.

Denials should carry a stable reason code and an audit-safe correlation ID, without revealing whether a foreign object exists.

