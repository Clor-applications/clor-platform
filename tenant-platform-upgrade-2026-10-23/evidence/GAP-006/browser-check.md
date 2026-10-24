# GAP-006 — browser check (2026-10-24, local dev: web :5176 → API :4003 as clor_app)

Two local test accounts (generated, credentials in the session scratchpad): the client "B11 Webhooks"
(owner) and a firm "Menon & Co" whose owner, Ravi Menon, plays the accountant (address confirmed).
Port 4002 belonged to another checkout's API, so a dedicated preview (`clor-web-4003`) was used.

1. Company admin → Users → Create User with Ravi's address: added, keeps his own user ID (MENO-…).
2. Company admin → Access → Who → **Outside access** (new): "Ravi Menon · from Menon & Co …",
   May use "Everything the company has", Active, Until "No end", Granted by B11 Owner, 24 Oct 2026;
   Pause · Change · End.
   - Fault found and fixed: "from" first showed the account's name, which is the person's own sign-up
     name ("from Ravi Menon"); it now names the firm's company. Test updated.
3. Change → untick Payroll, People, Attendance; Until 31 Mar 2027 → row: "Books", "31 Mar 2027".
4. As Ravi (API, his own login): the client is listed; Books (ledger accounts) 200 once the client gave
   him the Accountant role (inviting and giving a role are two steps in Users, as before); Payroll 403
   `APP_NOT_IN_ENGAGEMENT`.
5. Pause with reason "Year-end audit on hold" → row "Paused / B11 Owner, 24 Oct 2026 — Year-end audit
   on hold", toast "Paused." As Ravi: Books 403 `OUTSIDE_ACCESS_SUSPENDED`, the client gone from his
   company list.
6. Resume → Active; as Ravi: listed again, Books 200, Payroll still 403 `APP_NOT_IN_ENGAGEMENT`.
7. Desktop width: the item sits under Access → Who beside Users; the table uses the shared table styles
   (tokens only; `test/design-rules.test.js` passes).
