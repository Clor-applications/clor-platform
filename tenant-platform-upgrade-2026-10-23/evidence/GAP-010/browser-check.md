# GAP-010 — browser check (2026-10-24, local dev, web :5173 → API :4002 as clor_app)

Local test company "B11 Webhooks" (generated credentials in the session scratchpad). Accounting →
Cost Centers (feature switched on for this company).

1. Added "Plant Ops" from the screen ("Cost center "Plant Ops" added.").
2. From the page: a payroll employee on a made-up cost centre → 400 "No such cost centre in
   Accounting, or it is switched off."; on Plant Ops → 201. Payroll now uses Plant Ops.
3. Remove Plant Ops → confirm → toast "Payroll uses this cost centre on 1 record. Switch it off
   instead." and the row **stays** (before: the screen dropped it locally and said "Removed on this
   device only").
4. First pass found the message pointed at a control that did not exist: the screen had no way to
   switch a cost centre off. Added "Switch off / Switch on" per row (server `isActive`, already
   supported by PATCH /masters/:id). Switched Plant Ops off → toast "no longer offered on new
   documents or in Payroll"; after reload the row shows "Off" and "Switch on" (hydrated from the
   server).
5. Payroll then refuses Plant Ops for a new hire (400, same message). Invoice and expense pickers
   no longer offer a switched-off centre, but a document already tagged keeps it.
