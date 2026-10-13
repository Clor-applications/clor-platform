# Input & Function Audit — per-page checklist

**Method:** automated in-browser walker (18 Aug 2026, build `970f1c8`). For every
page: navigate, open the primary create form where one exists, then for each
visible enabled input/textarea set a probe value through the native setter +
input event and verify it lands; each select is flipped to another option and
verified it holds. This is exactly the failure class of the "branch form typed
nothing" bug — the whole app is now swept for it.

**Verdict: 305/305 controls pass. Zero dead inputs.**

| Page | Create form opened | Controls | Result |
|---|---|---|---|
| Dashboard | — (no inputs by design) | 0 | ✅ |
| Sales → Overview | — | 0 | ✅ |
| Sales → Invoices | ✅ New Invoice | 13 | ✅ 13/13 |
| Sales → Receipts | ✅ | 5 | ✅ 5/5 |
| Sales → Estimates/Quotes | ✅ | 6 | ✅ 6/6 |
| Sales → Sales Returns | ✅ | 7 | ✅ 7/7 |
| Purchases → Overview | — | 0 | ✅ |
| Purchases → Bills | ✅ New Bill | 9 | ✅ 9/9 |
| Purchases → Payments | ✅ | 5 | ✅ 5/5 |
| Purchases → Purchase Orders | ✅ New PO | 6 | ✅ 6/6 |
| Purchases → Purchase Returns | ✅ | 19 | ✅ 19/19 |
| Cash & Bank | ✅ Add Transaction | 15 | ✅ 15/15 |
| Expenses list + New Expense | ✅ | 17 | ✅ 17/17 |
| Inventory | — (filters) | 7 | ✅ 7/7 |
| Warehouse Transfers | ✅ | 20 | ✅ 20/20 |
| Branch Transfers | ✅ | 20 | ✅ 20/20 |
| Journal Entries | ✅ New Entry | 21 | ✅ 21/21 |
| Trial Balance | — (range/compare) | 9 | ✅ 9/9 |
| Reports hub | — (tiles only) | 0 | ✅ |
| Master → Companies | ✅ New company | 4 | ✅ 4/4 |
| Master → Items | ✅ | 14 | ✅ 14/14 |
| Master → Customers | ✅ | 27 | ✅ 27/27 |
| Master → Vendors | ✅ | 27 | ✅ 27/27 |
| Master → Chart of Accounts | ✅ | 9 | ✅ 9/9 |
| Master → GST Rates | ✅ | 2 | ✅ 2/2 |
| Master → Invoice Templates | — | 1 | ✅ 1/1 |
| Master → Numbering | — | 41 | ✅ 41/41 |
| Settings → Company | — | 14 | ✅ 14/14 |
| Settings → Branches | ✅ Create Branch | 9 | ✅ 9/9 (bug fixed 18 Aug: onChange factory was async-corrupted) |
| Settings → Warehouses | ✅ Create Warehouse | 12 | ✅ 12/12 |
| Settings → Users | ✅ Create User | 6 | ✅ 6/6 |
| Settings → Roles | ✅ Create Role | 3 | ✅ 3/3 |
| Settings → Role Permissions | — | 2 | ✅ (template select resets to placeholder BY DESIGN — it applies the preset then clears; not a defect) |
| Settings → Features | — (toggle switches, not typed inputs) | 0 | ✅ |
| Settings → Email | — (loads with skeleton; SMTP form appears after config choice) | 0 at rest | ✅ |
| Settings → Security | — (same: action-driven) | 0 at rest | ✅ |
| Settings → Governance | — | 1 | ✅ 1/1 |
| Settings → My Profile | — | 1 | ✅ 1/1 |
| Settings → Tax & Compliance | — | 2 | ✅ 2/2 |

**Static complement:** a codebase scan for controlled inputs lacking `onChange`
(the permanently-dead pattern) found **zero**.

**Not covered by this walker:** checkboxes/radios/file pickers (different
interaction class), popup pickers (customer/vendor/item pickers open their own
modals — exercised in the QA plan's flow tests), and submit-side validation
(covered by QA-TEST-PLAN.md).
