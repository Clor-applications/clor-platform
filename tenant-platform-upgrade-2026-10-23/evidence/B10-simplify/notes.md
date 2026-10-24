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
