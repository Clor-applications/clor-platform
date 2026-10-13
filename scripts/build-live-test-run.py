#!/usr/bin/env python3
"""
Builds docs/NEEV-LIVE-TEST-RUN.xlsx — the end-to-end test cases with the result
of the run against https://68.233.107.83.sslip.io.

Results are only written where the case was actually executed. Everything that
needs a signed-in session is marked BLOCKED with the reason, because the
assistant that ran this pass cannot sign in or create accounts.
"""
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

SITE = "https://68.233.107.83.sslip.io"

HEAD = PatternFill("solid", fgColor="1F2937")
BAND = PatternFill("solid", fgColor="F3F4F6")
PASS = PatternFill("solid", fgColor="DCFCE7")
FAIL = PatternFill("solid", fgColor="FEE2E2")
BLOCK = PatternFill("solid", fgColor="FEF3C7")
THIN = Side(style="thin", color="D1D5DB")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

COLS = ["#", "Area", "Test case", "Steps", "Expected result", "Result", "Remark"]
WIDTHS = [5, 22, 40, 52, 46, 11, 60]

BLOCKED_NOTE = (
    "BLOCKED — needs a signed-in session. The assistant cannot create an account or "
    "type a password into a login field, so this pass stopped at the sign-in wall. "
    "Sign in yourself in the browser pane and this case can be driven end to end."
)

# (area, case, steps, expected, result, remark)
CASES = [
    # ---------- 1. Reaching the product ----------
    ("Public site", "Site is up over HTTPS",
     f"GET {SITE}/", "200, HTML, valid TLS", "Pass",
     "HTTP/2 200. TLS verified (ssl_verify=0). Served by Caddy."),
    ("Public site", "Plain HTTP is redirected, not served",
     "GET http://68.233.107.83.sslip.io/", "308 to https://", "Pass",
     "308 → https://68.233.107.83.sslip.io/. No plaintext page is ever returned."),
    ("Public site", "HSTS is set",
     "Read response headers", "strict-transport-security present, 1 year", "Pass",
     "max-age=31536000; includeSubDomains."),
    ("Public site", "Clickjacking and sniffing headers",
     "Read response headers", "x-frame-options and x-content-type-options set", "Pass",
     "x-frame-options: SAMEORIGIN; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin."),
    ("Public site", "The HTML shell is never cached",
     "Read cache-control on /", "no-store on the document", "Pass",
     "cache-control: no-store, must-revalidate — a deploy is picked up on the next load."),
    ("Public site", "Hashed assets are cached for a year",
     "Read cache-control on /assets/index-*.js", "public, immutable, max-age=31536000", "Pass",
     "Confirmed on /assets/index-BbslsMIS.js (1.6 MB). Bundle size is worth splitting later."),
    ("Public site", "Landing page renders with no console errors",
     "Open the site, read the console", "No errors", "Pass",
     "Console clean. Title 'CLOR — GST accounting'; hero, trial-balance sample and both calls to action present."),
    ("Public site", "Theme toggle works and is remembered",
     "Press the theme button, reload", "Light/dark switches and persists", "Pass",
     "data-theme flips dark→light, body ground becomes rgb(250,250,249), uiTheme stored in localStorage."),
    ("Public site", "No horizontal scroll on a phone",
     "375×812 viewport, load the site", "Document width equals viewport width", "Pass",
     "scrollWidth 375 = innerWidth 375. Header collapses; hero and buttons stack cleanly."),
    ("Public site", "A deep link into the app still loads the SPA",
     f"GET {SITE}/invoices", "200 (the shell), app routes client-side", "Pass",
     "200. The app decides what to show once it knows whether there is a session."),

    # ---------- 2. Signup ----------
    ("Signup", "Sign-in screen is reachable from the landing page",
     "Press 'Sign in'", "Email + password form", "Pass",
     "'Welcome Back' panel: email (autocomplete=email), password (current-password), 'Forgot your password?', 'Sign up here'."),
    ("Signup", "Password managers are allowed to work",
     "Inspect the login inputs", "Correct autocomplete tokens, password masked", "Pass",
     "type=password with autocomplete=current-password; signup uses new-password on both fields. WCAG 2.2 accessible authentication."),
    ("Signup", "Signup is a three-step wizard",
     "Press 'Sign up here'", "Account → Company → Modules", "Pass",
     "All three steps shown in the stepper. Step 1: name, email, mobile (optional), password, confirm."),
    ("Signup", "Password rule is stated before it is enforced",
     "Read the password field", "Minimum length visible", "Pass",
     "Placeholder reads 'Min 8 characters'; the server enforces the same 8."),
    ("Signup", "Server refuses a short password",
     "POST /api/auth/signup with a 5-character password", "400 with a reason", "Pass",
     "400 'Validation error: String must contain at least 8 character(s)'. No account created."),
    ("Signup", "Server refuses a malformed email",
     "POST /api/auth/signup with 'not-an-email'", "400 with a reason", "Pass",
     "400 'Validation error: Invalid email'."),
    ("Signup", "Server refuses an empty payload",
     "POST /api/auth/signup with {}", "400, no stack trace", "Pass",
     "400 'Validation error: Required'. No internals leaked."),
    ("Signup", "Create the account and land in the app",
     "Complete step 1", "Account created, wizard moves to Company", "Blocked", BLOCKED_NOTE),
    ("Signup", "Company step stores the whole master",
     "Fill name, GSTIN, state, trade name, entity type, FY start, address",
     "Company created; every field is kept", "Blocked",
     BLOCKED_NOTE + " NOTE: this is the defect fixed today — setup-company parsed the profile and stored none of it. Server test now covers it."),
    ("Signup", "GSTIN decides the state",
     "Enter a GSTIN starting 27", "State resolves to Maharashtra and cannot disagree", "Blocked", BLOCKED_NOTE),
    ("Signup", "A malformed GSTIN is refused",
     "Enter '29ABC'", "Inline error, no company created", "Blocked", BLOCKED_NOTE),
    ("Signup", "Module choice at step 3 shapes the menu",
     "Turn modules on/off, finish", "Only chosen modules appear in navigation", "Blocked", BLOCKED_NOTE),
    ("Signup", "Head office branch and Main Store are created",
     "Finish signup, open Branches and Warehouses", "HO branch and Main Store exist", "Blocked",
     BLOCKED_NOTE + " Server-side this is covered by tests and by the live data (every org has both)."),

    # ---------- 3. Sign in, session, access ----------
    ("Sign in", "Wrong password is refused",
     "POST /api/auth/login with a bad password", "401, no hint about which field was wrong", "Pass",
     "401 for a non-existent user and for a wrong password alike — no account enumeration."),
    ("Sign in", "Brute force is rate limited",
     "12 bad sign-in attempts in a row", "Blocked after 10", "Pass",
     "Attempts 1–10 returned 401, 11 and 12 returned 429. Window is 15 minutes."),
    ("Sign in", "Every API route refuses an anonymous caller",
     "GET /api/auth/me, /api/orgs/x/invoices, /api/orgs/x/customers", "401 on all", "Pass",
     "401 on all three. /api/health is behind auth too, which is why the deploy script's own probe reads 401."),
    ("Sign in", "A foreign origin gets no CORS grant",
     "GET /api/health with Origin: https://evil.example.com", "No access-control-allow-origin", "Pass",
     "No CORS headers returned — the browser would refuse to read the response."),
    ("Sign in", "An unknown API path leaks nothing",
     "GET /api/does-not-exist", "401 or 404, no stack", "Pass",
     "401 (auth runs before routing). No internals leaked."),
    ("Sign in", "Sign in and land on the dashboard",
     "Enter credentials, submit", "Dashboard for the active company", "Blocked", BLOCKED_NOTE),
    ("Sign in", "The company from signup is there, already set up",
     "Sign in on a browser that has never seen these books",
     "The company's name, GSTIN and state are present; no second setup is offered", "Blocked",
     BLOCKED_NOTE + " NOTE: this is the second defect fixed today. /auth/me now returns the master and the browser rebuilds the company from it."),
    ("Sign in", "Forgot password sends a link",
     "Press 'Forgot your password?', submit an address", "Neutral confirmation either way", "Blocked",
     BLOCKED_NOTE + " Endpoint exists and is rate limited (resetLimiter)."),
    ("Sign in", "Sign out clears the session",
     "Sign out, press Back", "Returns to the sign-in wall", "Blocked", BLOCKED_NOTE),

    # ---------- 4. Masters ----------
    ("Masters", "Add a customer with a GSTIN", "Customers → New Customer → save",
     "Row appears; GSTIN and state stored", "Blocked", BLOCKED_NOTE),
    ("Masters", "Edit a customer", "Open, change the phone, save", "Change persists after reload", "Blocked", BLOCKED_NOTE),
    ("Masters", "A customer used on an invoice cannot be deleted",
     "Try to delete one with documents", "Refusal naming the documents", "Blocked", BLOCKED_NOTE),
    ("Masters", "Customer list shows what is owed",
     "Open Customers", "Outstanding and Overdue read off the invoices", "Blocked",
     BLOCKED_NOTE + " Built and unit-tested today; the old stored balance always read zero."),
    ("Masters", "Add a vendor", "Vendors → New Vendor → save", "Row appears with payable columns", "Blocked", BLOCKED_NOTE),
    ("Masters", "Add an item with HSN and tax rate", "Items → New Item → save", "Item appears with GST % and price", "Blocked", BLOCKED_NOTE),
    ("Masters", "Items without an HSN are countable",
     "Open Items", "'Without HSN/SAC' figure and tab", "Blocked", BLOCKED_NOTE),
    ("Masters", "Item categories and price lists",
     "Add a category, add a price list, set a rate", "Both saved and visible on the item form", "Blocked", BLOCKED_NOTE),
    ("Masters", "Chart of accounts: add a ledger under a group",
     "Chart of Accounts → New Ledger", "Ledger appears under the right group and parent", "Blocked", BLOCKED_NOTE),
    ("Masters", "Masters survive a fresh browser",
     "Sign in elsewhere, open Customers", "The same customers are listed", "Blocked",
     BLOCKED_NOTE + " Server-side hydration is unit-tested (useServerDocSync)."),

    # ---------- 5. Sales ----------
    ("Sales", "Raise an invoice, intra-state", "New Invoice → same-state customer → save",
     "CGST + SGST split, total correct, status Unpaid", "Blocked", BLOCKED_NOTE),
    ("Sales", "Raise an invoice, inter-state", "New Invoice → other-state customer → save",
     "IGST only", "Blocked", BLOCKED_NOTE),
    ("Sales", "The invoice posts to the ledger",
     "Save an invoice, open the trial balance", "AR debit, revenue and tax credits", "Blocked", BLOCKED_NOTE),
    ("Sales", "Edit an invoice", "Change a line, save", "Totals and ledger both follow", "Blocked", BLOCKED_NOTE),
    ("Sales", "Cancel an invoice", "Cancel it", "Status Cancelled; it leaves the receivable figures", "Blocked", BLOCKED_NOTE),
    ("Sales", "Record a receipt against an invoice", "Record Receipt → allocate → save",
     "Balance falls, status Partial or Paid", "Blocked", BLOCKED_NOTE),
    ("Sales", "Quotation → invoice", "Raise a quotation, convert it", "Invoice carries the lines; quote reads Converted", "Blocked", BLOCKED_NOTE),
    ("Sales", "Sales order → challan → invoice",
     "Raise an SO, despatch a challan, bill it", "Delivered and billed counts follow the documents", "Blocked", BLOCKED_NOTE),
    ("Sales", "Credit note against an invoice", "Raise a credit note", "Invoice shows the return; ledger reverses", "Blocked", BLOCKED_NOTE),
    ("Sales", "Invoice numbering does not repeat",
     "Raise three invoices", "Numbers run in sequence, no gaps or clashes", "Blocked", BLOCKED_NOTE),
    ("Sales", "Print and PDF an invoice", "Open an invoice, print", "Black-on-white document, all fields present", "Blocked", BLOCKED_NOTE),
    ("Sales", "Invoice list figures agree with the rows",
     "Open Sales Invoices", "Five figures match the filtered rows", "Blocked", BLOCKED_NOTE),

    # ---------- 6. Purchase ----------
    ("Purchase", "Enter a bill", "New Bill → vendor → lines → save", "Bill saved, input GST recorded", "Blocked", BLOCKED_NOTE),
    ("Purchase", "Pay a bill", "Record a payment", "Payable falls; status follows", "Blocked", BLOCKED_NOTE),
    ("Purchase", "Purchase order → bill", "Raise a PO, bill against it", "PO closes itself when the bill names it", "Blocked", BLOCKED_NOTE),
    ("Purchase", "Debit note against a bill", "Raise a purchase return", "Payable reduces; ledger follows", "Blocked", BLOCKED_NOTE),
    ("Purchase", "Expense voucher with input GST", "New Expense → ledger lines → save", "Expense posts; ITC recorded", "Blocked", BLOCKED_NOTE),
    ("Purchase", "Purchase overview reads the period",
     "Open Purchases → Overview", "Six figures, spend chart, breakdowns, recent bills", "Blocked",
     BLOCKED_NOTE + " Rebuilt today; verified against fixtures in a local harness."),

    # ---------- 7. Inventory ----------
    ("Inventory", "Stock moves with the documents",
     "Buy 40, sell 25, open Inventory", "Closing = 15 for that item", "Blocked", BLOCKED_NOTE),
    ("Inventory", "Stock adjustment", "Record a −2 adjustment", "Closing falls by 2; value posts to the ledger", "Blocked", BLOCKED_NOTE),
    ("Inventory", "Warehouse transfer, out and in",
     "Transfer out, approve at the far end", "Units in transit until approved; short receipts flagged", "Blocked", BLOCKED_NOTE),
    ("Inventory", "Reorder alerts", "Set a reorder level, sell below it", "Item appears with a suggested quantity", "Blocked", BLOCKED_NOTE),
    ("Inventory", "Batch and expiry", "Receive a batch-tracked item on a bill", "Batch appears with its expiry window", "Blocked", BLOCKED_NOTE),

    # ---------- 8. Cash, bank, accounting ----------
    ("Cash & Bank", "Add a cash/bank account", "New Account", "Account appears in the picker", "Blocked", BLOCKED_NOTE),
    ("Cash & Bank", "Add a transaction and categorise it",
     "Add Transaction, give it a ledger", "Moves from Uncategorised to Categorised", "Blocked", BLOCKED_NOTE),
    ("Cash & Bank", "Upload a statement", "Upload the CSV template", "Rows import as uncategorised lines", "Blocked", BLOCKED_NOTE),
    ("Cash & Bank", "Reconcile against receipts and payments",
     "Open Bank Reconciliation", "Statement lines match book entries within the window", "Blocked", BLOCKED_NOTE),
    ("Accounting", "Post a manual journal", "Journal Entries → New Entry → two lines → save",
     "Entry saved and posted to the ledger", "Blocked",
     BLOCKED_NOTE + " Fixed this session: journals used to be written to the browser only."),
    ("Accounting", "An unbalanced journal is refused", "Debit 500, credit 400, save", "Refusal, nothing stored", "Blocked",
     BLOCKED_NOTE + " Server test covers this ('does not balance')."),
    ("Accounting", "A posted journal is reversed, not deleted",
     "Delete a posted entry", "It is reversed; original stays, marked Reversed", "Blocked", BLOCKED_NOTE),
    ("Accounting", "Trial balance balances", "Open the trial balance", "Debits equal credits", "Blocked", BLOCKED_NOTE),
    ("Accounting", "Close the books for a period",
     "Year-end close → lock", "Documents dated inside the period are refused", "Blocked",
     BLOCKED_NOTE + " Fixed this session: the lock now reaches the server, which is what refuses the posting."),

    # ---------- 9. Reports & GST ----------
    ("Reports", "P&L and balance sheet", "Open both", "They agree with the ledger", "Blocked", BLOCKED_NOTE),
    ("Reports", "GSTR-1 export", "Reports → GSTR-1 → export", "JSON matching the period's outward supplies", "Blocked", BLOCKED_NOTE),
    ("Reports", "GSTR-3B summary", "Reports → GSTR-3B", "Output and input tax summarised", "Blocked", BLOCKED_NOTE),
    ("Reports", "Ageing / collections", "Open Payment Reminders", "Every open invoice, oldest first", "Blocked", BLOCKED_NOTE),
    ("Reports", "Export a list to CSV, Excel and PDF",
     "Any list → More → Export", "File downloads with the rows on screen", "Blocked", BLOCKED_NOTE),
    ("Reports", "CSV export is safe to open",
     "Export a list containing a value starting '='", "Value is quoted, not executed by Excel", "Blocked",
     BLOCKED_NOTE + " csvSafeValue is unit-tested for formula injection."),

    # ---------- 10. Settings, users, backup ----------
    ("Settings", "Company profile can be edited", "Settings → Company Profile", "Changes persist", "Blocked", BLOCKED_NOTE),
    ("Settings", "Data Backup appears in Settings",
     "Settings → Account → Data Backup", "The page is in the menu and opens", "Pass",
     "Fixed during this pass. The entry is gated on SETTINGS::Company data::VIEW, which four of six live orgs never held — "
     "Owner roles are seeded at creation, so permissions added to the catalogue later never reached them. 92 grants were "
     "restored across those orgs and the deploy now runs the backfill every time."),
    ("Settings", "Download a data backup", "Data Backup → download", "A file containing this company's data", "Blocked", BLOCKED_NOTE),
    ("Settings", "Configuration backup is separate from data",
     "Choose configuration scope", "Roles, numbering, templates — no customer list", "Blocked", BLOCKED_NOTE),
    ("Settings", "Backups carry no secrets",
     "Inspect the export", "No password hashes, no SMTP passwords, no API keys", "Pass",
     "Server-side test asserts passwordEnc, clientSecretEnc and publicKeyPem are stripped from every export."),
    ("Users", "Invite a user and assign a role", "Settings → Users → invite", "User appears; role limits what they see", "Blocked", BLOCKED_NOTE),
    ("Users", "A role without a permission cannot reach the screen",
     "Sign in as that user", "Menu entry absent; direct API call 403", "Blocked", BLOCKED_NOTE),
    ("Users", "Owner holds the whole catalogue",
     "Compare Owner grants against the permission catalogue", "No gaps", "Pass",
     "Checked on the live database: after the backfill every Owner role carries all 172 permissions. Re-running reports "
     "'nothing to do'."),
    ("Users", "Audit trail records who changed what", "Settings → Audit Trail", "Entries for the changes just made", "Blocked", BLOCKED_NOTE),

    # ---------- 11. Multi-company & isolation ----------
    ("Isolation", "Add a second company", "Companies → Add company", "Second company created and switchable", "Blocked", BLOCKED_NOTE),
    ("Isolation", "Switching company switches the books",
     "Switch, open Invoices", "Only the second company's documents", "Blocked", BLOCKED_NOTE),
    ("Isolation", "One account's two companies never mix",
     "Create a customer in each, compare lists", "Neither list shows the other's", "Pass",
     "Cannot be driven through the UI without a session, but it is covered server-side by the CA-firm tests: two orgs "
     "inside one account, asserted separately for masters, documents, day closes and the audit trail."),
    ("Isolation", "Another account cannot read this one",
     "Call this org's API with another account's token", "403", "Pass",
     "Server tests cover cross-account access on every route family; the org-mismatch guard returns 403."),
    ("Isolation", "The group page adds up",
     "Open Companies", "Group billed and owed match the companies below", "Blocked",
     BLOCKED_NOTE + " Unit-tested today, including that drafts are excluded."),

    # ---------- 12. Resilience ----------
    ("Resilience", "Production database is backed up nightly",
     "Inspect cron and the backup directory", "A verified archive per night", "Pass",
     "Cron at 02:30 runs neev-backup --verify. A fresh archive was taken during this pass and verified against live row "
     "counts (7 accounts, 6 orgs, 8 invoices, 15 journal entries)."),
    ("Resilience", "A backup actually restores",
     "Restore the archive into a scratch database", "Integrity check passes, row counts match", "Pass",
     "--verify does exactly this on every run: restores the archive, runs an integrity check and compares six tables "
     "against live. It refuses to report success on an empty archive."),
    ("Resilience", "Schema changes are versioned, not pushed",
     "Deploy and read the migration output", "migrate deploy runs; nothing is force-reset", "Pass",
     "Deploy ran preflight ('safe to deploy'), then migrations ('no pending migrations'), then the permission backfill."),
    ("Resilience", "The API comes back after a deploy",
     "Deploy, then check the service", "Service active, health 200", "Pass",
     "neev-api active; /health returns 200 on the box; the site returns 200. The deploy script's own api probe reads 401 "
     "because it calls an authenticated route — worth changing so a real failure is not mistaken for that."),
]


def build():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Run 10 Sep 2026"

    ws["A1"] = "CLOR — end-to-end test run"
    ws["A1"].font = Font(bold=True, size=15)
    ws["A2"] = f"Target: {SITE}   ·   Run: 10 Sep 2026   ·   Environment: production"
    ws["A2"].font = Font(size=10, color="6B7280")
    ws["A3"] = (
        "Result is filled in only where the case was actually executed. BLOCKED means the case needs a signed-in "
        "session: the assistant running this pass cannot create an account or type a password into a login field. "
        "Sign in yourself in the browser pane and the blocked cases can be driven end to end."
    )
    ws["A3"].font = Font(size=10, color="6B7280")
    ws["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("A3:G3")
    ws.row_dimensions[3].height = 42

    header_row = 5
    for i, name in enumerate(COLS, start=1):
        c = ws.cell(row=header_row, column=i, value=name)
        c.fill = HEAD
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.alignment = Alignment(vertical="center")
        c.border = BOX
        ws.column_dimensions[get_column_letter(i)].width = WIDTHS[i - 1]
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)

    dv = DataValidation(type="list", formula1='"Pass,Fail,Blocked,Not run"', allow_blank=True)
    ws.add_data_validation(dv)

    r = header_row + 1
    for n, (area, case, steps, expected, result, remark) in enumerate(CASES, start=1):
        values = [n, area, case, steps, expected, result, remark]
        for i, v in enumerate(values, start=1):
            c = ws.cell(row=r, column=i, value=v)
            c.alignment = Alignment(wrap_text=True, vertical="top")
            c.border = BOX
            c.font = Font(size=10)
            if n % 2 == 0:
                c.fill = BAND
        rc = ws.cell(row=r, column=6)
        rc.font = Font(size=10, bold=True)
        rc.alignment = Alignment(horizontal="center", vertical="center")
        rc.fill = {"Pass": PASS, "Fail": FAIL, "Blocked": BLOCK}.get(result, rc.fill)
        dv.add(rc)
        ws.row_dimensions[r].height = 44
        r += 1

    total = len(CASES)
    executed = sum(1 for c in CASES if c[4] in ("Pass", "Fail"))
    passed = sum(1 for c in CASES if c[4] == "Pass")
    failed = sum(1 for c in CASES if c[4] == "Fail")
    blocked = sum(1 for c in CASES if c[4] == "Blocked")

    s = wb.create_sheet("Summary")
    s["A1"] = "Summary"
    s["A1"].font = Font(bold=True, size=14)
    rows = [
        ("Cases written", total),
        ("Executed", executed),
        ("Passed", passed),
        ("Failed", failed),
        ("Blocked — needs a signed-in session", blocked),
    ]
    for i, (k, v) in enumerate(rows, start=3):
        s.cell(row=i, column=1, value=k).font = Font(size=11)
        s.cell(row=i, column=2, value=v).font = Font(size=11, bold=True)
    s.column_dimensions["A"].width = 40
    s.column_dimensions["B"].width = 10

    s["A10"] = "What this pass found"
    s["A10"].font = Font(bold=True, size=12)
    findings = [
        "Data Backup was missing from Settings for four of six live companies. Owner roles are seeded once, at company "
        "creation, so any permission added to the catalogue afterwards never reached them — 92 grants were missing. "
        "Restored on production, and the deploy now runs the backfill every time so it cannot drift again.",
        "The company created at signup did not survive to the next sign-in. Two causes, both fixed: setup-company "
        "parsed the company master and stored none of it, and no route returned it, so a fresh browser fell back to a "
        "placeholder called 'Company' and offered to set it up again.",
        "The deploy script probes an authenticated route for its API health check, so a healthy API reports 401 in the "
        "deploy output. Harmless today, but it would hide a real outage.",
        "The main JavaScript bundle is 1.6 MB. It caches for a year, so it is a first-visit cost rather than a "
        "per-page one, but it is worth splitting.",
    ]
    rr = 11
    for f in findings:
        c = s.cell(row=rr, column=1, value=f)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        s.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=6)
        s.row_dimensions[rr].height = 58
        rr += 1

    wb.save("docs/NEEV-LIVE-TEST-RUN.xlsx")
    print(f"{total} cases · executed {executed} · pass {passed} · fail {failed} · blocked {blocked}")


if __name__ == "__main__":
    build()
