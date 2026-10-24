# A-22 browser check (local dev, 2026-10-23)

From the app page in the browser pane, signed in through `/api/auth/login` as each local test user, A03 Test Traders:

| Request | Export-only user (`SETTINGS::Company data::EXPORT` only) | Owner (administrator) |
|---|---|---|
| `GET /api/billing/subscription` | 200, `ownedApps` = accounting, payroll, attendance, people; `subscription: null` | 200, plan returned (`status`, `gatewayName`, `items`), no `gatewayCustomerId` / `gatewaySubscriptionId` |
| `GET …/number-series/next/INVOICE` | 403 Permission denied | 200 |
| `GET …/number-series/next/NOT_A_DOCUMENT` | 400 Unknown document type | 400 Unknown document type (no series created) |
| `GET …/payment-modes` | 403 Permission denied | 200 |

The shell reads only `ownedApps` / `restricted` / `status` / dates from the subscription call (Shell.jsx PlanCard and SubscriptionBanner, session.jsx), so the app switcher is unchanged for members. Before the fix every row in the first column answered 200 with the full data (`before-fix.txt`).
