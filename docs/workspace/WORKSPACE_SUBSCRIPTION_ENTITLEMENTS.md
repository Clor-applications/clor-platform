# Subscriptions and entitlements

What exists:
- `Subscription` / `SubscriptionItem` per account; customers cannot set them (operator only, with step-up).
- `AccountEntitlement` planKey → `planCatalog.ts` limits (maxCompanies, maxUsers). **Limits are still code**, not configuration (W-6.1 follow-up).
- Limits are now enforced under a per-account quota lock (`AccountQuotaLock`): bursts cannot exceed them (quotaLock.test.ts).
- Seat policy: a pending invitation reserves no seat; the user limit is enforced when it is accepted.
- Legacy accounts (`legacyUnrestrictedAt`, no subscription) keep every app until billing goes live (decision D-4).

Not built / blocked:
- Payment provider (webhook signature, idempotency): BLOCKED until the gateway is chosen.
- Signup still switches every available app on (spec rule 2.2.5 says it must not). Changing it changes what new customers get; needs a product decision.
- Usage page per product: Account & plan shows companies and people against the plan's limits; no per-product usage metrics yet.
