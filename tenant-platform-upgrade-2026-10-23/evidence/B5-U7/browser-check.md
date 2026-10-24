# B5-U7 (and U5 portal) browser check (2026-10-24, local dev, API as `clor_app`)

Throwaway company "B5U4 Traders ut7d58" (BUTR-C100), owner signed in through the sign-in form.

| Step | Result | Evidence |
|---|---|---|
| Company admin → Security → Credentials, empty | Header, one primary action (New API key), filters, empty state, customer-link count | — |
| New API key "greytHR sync", expiry default a year | Token shown once with Copy / I have copied it; row Active, expires 24 Oct 2027, Pause/Extend/Rotate/Revoke | `key-shown-once.jpg` |
| A connector switched off + a directory-sync token | Connector row "Blocked — Switched off where it is set up"; SCIM row Active | `list-states.jpg` |
| Pause the key (reason dialog) | Row "Paused", actions become Resume/Extend/Rotate/Revoke; audit trail shows "Paused api key clor_b9018f3…" with the reason | `after-pause.jpg`, `audit-trail-pause.jpg` |
| Phone width, dark theme | Tokens hold; filters and captions keep a 16px gutter; table scrolls | `phone-dark.jpg` |
| SSO settings | SCIM token shows its status, expiry and "Manage in Credentials" | — |
| Employee app → Me → Signed-in devices (two sign-ins) | Two devices, "This device" marked, other has Sign out | `portal-devices.jpg` |
| Sign the other device out | Its token gets 401 PORTAL_SIGNIN; list shows one device | `portal-device-signed-out.jpg` |
| HR → Employee Portal Access → Sign out everywhere | Confirm explains the difference from Forget password; toast "signed out on 1 device"; the portal token gets 401 | `hr-sign-out-everywhere.jpg` |

Fixed during the check: row actions wrapped into a column (kept on one line); filters had no phone gutter (added).
Not changed (older pattern, noted): other Company admin screens also run flush to the phone edge.
