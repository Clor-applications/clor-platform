# Batch 10 — simplify: App.jsx split (behaviour unchanged)

`apps/accounting/src/App.jsx` 15,157 → 4,507 lines. Moved by a script that parses the module (Babel), follows every top-level reference, and:
- moves the named screens plus every helper only they use;
- puts helpers the rest of App.jsx also uses in `appShared.jsx`, imported by both;
- copies the imports the moved code needs with paths rewritten (static and `import()`);
- has App.jsx import what it still uses and re-export what it exported, so other files and tests importing from `App` keep working.

| New file | What |
|---|---|
| `features/expenses/ExpenseScreens.jsx` | Expenses list and form, journal entry |
| `features/masters/AccountingMasters.jsx` | Chart of accounts, items, categories, GST rates, units |
| `features/reports/FinancialStatements.jsx` | Ledger, P&L, balance sheet, cash flow |
| `features/gst/GstCompliance.jsx` | GSTR-1/3B, GST and MSME workspaces, tax compliances |
| `features/settings/AccountingSettingsView.jsx` | Settings view, company profile, templates, GST registrations |
| `appShared.jsx` | Account form, account-group form, ledger states, id helpers |

Proof: Accounting web tests before (`accounting-web-before.txt`) and after each move — the same 47 baseline failures by name, 911 passing, every time; `vite build` passes (`build.txt`); browser: Expenses, Settings → GST registrations render.
What stays in App.jsx: the app shell (navigation, view switch, data loading) — next to split, with care, since every screen hangs off it.

## Sales and Purchase (same method)

- `features/sales/index.jsx` 6,819 → re-exports only: `InvoiceForm.jsx` (2,730), `InvoicesList.jsx` (1,699), `Estimates.jsx` (1,181), `CreditNotes.jsx` (401), `salesShared.jsx` (880).
- `features/purchase/index.jsx` 4,657 → re-exports only: `Bills.jsx` (2,195), `PurchaseOrders.jsx` (1,077), `DebitNotes.jsx`, `purchaseShared.jsx` (1,043).
- Two tests read source by path: `oneEngine.test.js` now reads the bill and invoice form files that use `resolveTds`; `expectedVsActual.test.js` now scans every sales file (it would otherwise have passed on an empty index).
- Accounting web tests: the same 47 baseline failures by name, 911 pass (`accounting-web-after-sales-purchase.txt`); `vite build` passes.

## Full web suite and source-reading tests

The full web suite found three tests reading moved code by its old path (`branch-reaches-every-document-form`, `masters-open-as-screens`, `design-rules`). Fixed, and more:
- `apps/accounting/src/testing/appSource.js` returns App.jsx plus every file split out of it; the ten tests that read App.jsx now use it, so a "never written here" check still sees the code that moved (it would otherwise pass on an emptier file).
- `design-rules` had exempted all of App.jsx because its only palette literals were the printed-template preview. The preview now has its own file and its own exemption, and App.jsx is held to the rule again — which exposed a real one: the GST export menu used `hover:bg-slate-100`, a light-mode colour in dark mode. It now uses the `ui-hover-sunken` token.
- Full web suite: 57 failed / 1502 passed, none new against the baseline (`BATCH-10/full-web-suite.txt`) — the same as Batch 8.
