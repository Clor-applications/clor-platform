# A-50 / A-51 browser check (2026-10-24, local dev)

| Step | Result |
|---|---|
| Make a role "Billing desk" (Company admin) | Trail: "Made a role", body `name · roleType · permissions` |
| Make a ledger account | Trail: "Made a ledger account" (Accounting tab) |
| HR signs someone out everywhere | "Signed Ravi Kumar out of the employee app on every device", action pill cut short with the full name on hover |

Fixed during the check: the trail printed request bodies as "[object Object]" for every entry the general recorder wrote (older, Payroll/Attendance included) — it now shows `field: value`; a long action name overflowed its pill and covered the message — pills now truncate, and SIGN_OUT replaces the long name. `trail-before-readable.jpg` is before these fixes, `trail-after.jpg` after.
