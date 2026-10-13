# CLOR — Manual QA Test Plan

**Build:** v0.1.0+ (main) · **Environments:** local dev (`npm run dev:all`, app on :5173) or Docker (`npm run docker:up`, app on :8080) · **Browsers:** Chrome + Firefox, plus one mobile viewport pass (375px) · **Themes:** run the smoke suite once in light, once in dark (toggle: moon icon, top right).

Every test states steps and expected result. Log failures with: test ID, browser, theme, screenshot, and what actually happened.

---

## 0. Smoke (run first, ~10 min)

| ID | Steps | Expected |
|----|-------|----------|
| S1 | Open app URL logged out | Landing page: "Books that balance themselves", orange branding, CLOR name, theme toggle works |
| S2 | Sign up with a fresh email → password ≥8 chars with upper/lower | Lands in company setup, then app shell |
| S3 | First sign-in on a new company | **Onboarding wizard** appears: Company → First customer → First invoice. Complete it; "Create first invoice" opens the invoice editor |
| S4 | Dashboard | KPI cards (Billed/Collected/Outstanding/Average) with ₹ compact figures; charts render; no console errors |
| S5 | Toggle dark theme | Every surface flips; no white cards on dark, no unreadable text |
| S6 | Resize to phone width or use a phone | Hamburger appears; nav is a drawer; no page-level horizontal scrolling anywhere |

## 1. Authentication & session

| ID | Steps | Expected |
|----|-------|----------|
| A1 | Sign out → wrong password ×6 | Lockout message after limit ("Try again in N minutes") |
| A2 | Forgot password → submit email | Success message; reset link flow works (capture transport in dev: check server log/outbox) |
| A3 | Reset link reused twice | Second use rejected: "already been used" |
| A4 | Sign in on second browser, delete session from Settings → Security → Sessions (if listed) | Other session invalidated on next request |

## 2. Sales

| ID | Steps | Expected |
|----|-------|----------|
| SL1 | Quick Create (+) → Invoice | Editor opens directly from anywhere |
| SL2 | Save invoice with no customer | Toast "Customer is required" — no browser alert boxes anywhere in the app |
| SL3 | Create invoice: customer, 2 line items, GST rate 18, intra-state | CGST+SGST split equally; totals foot; invoice number allocated (INV-…) |
| SL4 | Same but customer in another state | IGST only |
| SL5 | Invoices list | Columns: orange mono invoice #, teal customer, muted dates, right-aligned totals; row hover; overdue due-dates tinted |
| SL6 | Row menu → Change Status | Status dialog works; list reflects change |
| SL7 | Row menu → Record Receipt | Receipt form pre-filled with customer + outstanding amount; saving reduces outstanding |
| SL8 | Row menu → Repeat monthly | Toast confirms; menu now shows "Stop repeating" |
| SL9 | Row menu → Duplicate / Cancel / Delete | Each works; Delete shows styled confirm (Cancel focused), not browser confirm |
| SL10 | Grid: select 2 rows via checkboxes | Bulk bar appears: Export CSV (opens in Excel with ₹ intact), Delete (single confirm) |
| SL11 | Grid: Columns popover → hide Warehouse; Views → save as "My view" | Column disappears; view persists after reload; Views button shows active view name |
| SL12 | Estimates: create one | EST- number; appears in list; **survives a different browser** (see §8) |

## 3. Purchases & Expenses

| ID | Steps | Expected |
|----|-------|----------|
| P1 | Purchases → Overview | KPIs (Purchased/Paid out/Owed/Average) + spend charts in deep rust |
| P2 | Create bill for a vendor with GST | BILL- number; Purchase module lists it |
| P3 | Purchase Orders → Convert to Bill | Bill editor opens with vendor, lines, PO number in reference; PO shows "Billed" and can't convert twice |
| P4 | Expenses → New Expense (e.g. Rent 10,000 + 18% GST) | EXP- number; appears with KPI tiles updating |
| P5 | Trial Balance after P2+P4 | Balanced; Indirect Expenses and Purchase Accounts rows present with correct debits; Accounts Payable credited |
| P6 | Record Payment against the bill | Outstanding drops; Cash & Bank reflects movement |

## 4. Cash & Bank

| ID | Steps | Expected |
|----|-------|----------|
| C1 | Module opens | Money in / Money out / Net / To-categorise tiles with real figures |
| C2 | Upload statement (template download → fill 2 rows → upload) | Rows appear uncategorised |
| C3 | Row menu → Knock-off invoices | Can match a receipt against open invoices |
| C4 | Row menu → Reconcile | Categorisation flow completes; To-categorise count drops |

## 5. Inventory

| ID | Steps | Expected |
|----|-------|----------|
| I1 | Overview tiles | Stock value, item count, out-of-stock, negative-stock counts |
| I2 | Create batch-tracked item → receive lot with expiry | Lot listed; soonest-expiry ordering |
| I3 | Serial-tracked item → register 3 serials → sell 1 | Sold serial can't be sold again (error names the serial) |
| I4 | Feature off: Settings → Features → Batch & serial OFF | Batch/serial screens refuse with "switched off" message; turn back ON |

## 6. Reports & GST

| ID | Steps | Expected |
|----|-------|----------|
| R1 | Reports hub | Tile grid with icons + descriptions, grouped Financials/GST/Sales |
| R2 | Trial Balance → click any account row | Ledger drill-down opens below: dated lines, running balance |
| R3 | TB: set date range + Compare | Prior-period and Change columns appear |
| R4 | GSTR-1 → pick month → Portal JSON | JSON downloads; b2b entries per registered buyer, b2cs aggregated (open in editor to verify shape) |
| R5 | GSTR-3B → Portal JSON | osup_det matches on-screen outward summary |
| R6 | Ledger export: CSV + PDF + Print | CSV opens in Excel (₹ intact); PDF renders (first click loads pdf chunk); print window opens |
| R7 | e-Invoice: Settings → Features → e-Invoice ON, set company GSTIN → invoice menu | "e-Invoice JSON" and "e-Way Bill JSON" download NIC-schema files |

## 7. Roles & permissions

| ID | Steps | Expected |
|----|-------|----------|
| G1 | Settings → Users → create user with role "Sales User" | Default roles exist (Admin/Accountant/Sales/Store/Viewer) |
| G2 | Sign in as Sales User | Nav shows only permitted modules; can create invoice; **cannot** open Roles settings (403 surfaces as denied UI) |
| G3 | Viewer role | Read-only everywhere; create buttons absent or denied |
| G4 | Approval threshold (Governance): set invoice limit, exceed it as non-approver | Document routes to Approvals inbox; approver can approve/reject |

## 8. Data integrity (the big one)

| ID | Steps | Expected |
|----|-------|----------|
| D1 | Create one of each: invoice, bill, expense, estimate, PO. Note the numbers. | All succeed with server-allocated numbers |
| D2 | Open a **different browser** (or incognito), sign in same account | All five documents appear after load (pull-hydration) — nothing lost with the browser profile |
| D3 | Delete the bill in browser B → check browser A after reload | Gone in both; Trial Balance still balanced (posting was reversed, not erased) |
| D4 | Kill the API server → try saving an invoice | Clear error toast; document NOT saved locally-only (books can't drift from server) |

## 9. PWA & performance

| ID | Steps | Expected |
|----|-------|----------|
| W1 | Production build/Docker: browser address bar | Install icon available; installs as "CLOR" with orange icon |
| W2 | Second load | Shell assets from cache (Network tab: served by service worker); /api always network |
| W3 | First load | Main JS ~253KB gzip; Cash & Bank / PDF chunks load only when visited |

## 10. Accessibility spot-checks

| ID | Steps | Expected |
|----|-------|----------|
| X1 | Keyboard only: Tab through header → nav → content | Visible orange focus ring on every stop; order follows visual order; Skip-link appears on first Tab |
| X2 | Confirm dialog via keyboard | Cancel focused first; Escape cancels; Enter never deletes by default |
| X3 | Both themes: status pills, buttons, banners | No pale-on-pale text (contrast was measured to zero WCAG failures — regressions here are bugs) |

---

## Known limitations (don't file as bugs)

- Demo/dummy data created before server wiring is browser-local by design; only new documents round-trip.
- Direct IRP/GSP submission not implemented — e-invoice JSON targets the portals' bulk tools.
- Payroll/TDS not in product scope yet.
- Credit/debit notes write locally; server API exists but UI write-through is pending.
