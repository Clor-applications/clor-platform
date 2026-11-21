# Interaction, type and colour audit — 21 Nov 2026

The audit covers clor.in, the shell and shared UI, the Admin center, the Ops console, People, Payroll and Attendance. Books was left out because it belongs to the other developer.

**How it was done:**
- Eight read-only code audits were checked against `DESIGN.md`: motion, type, colour, components and feedback.
- The biggest claims were then checked by hand in the code and in the running app. Where a claim did not hold, this report says so.

**Totals:** about 230 findings. 49 are High, 113 Medium and 75 Low.

| Area | High | Medium | Low |
|---|---|---|---|
| Shared UI and shell | 4 | 12 | 10 |
| clor.in | 1 | 8 | 14 |
| Admin center | 9 | 15 | 7 |
| Ops console | 9 | 14 | 9 |
| People | 5 | 15 | 14 |
| Payroll | 6 | 14 | 10 |
| Attendance | 9 | 18 | 11 |
| Fonts, type and palette (all areas) | 6 | 9 | 4 |

**Checked by hand:**
- Confirmed: Ops money writes have no idempotency key. `packages/platform/http.js:203` guards only `/orgs/...` paths.
- Confirmed: a `#` link on clor.in jumps to the top. `website/src/router.jsx:26` scrolls to `state?.scrollY ?? 0`.
- Confirmed: `--panel` and `--surface-sunken` are white (`rnd.css:52,67`).
- Confirmed: body text and fields render at 13px rather than 14px (computed in People).
- **Not confirmed:** People table rows do show the #F7F7F7 hover in the browser, because a later rule wins. The other white-token hovers are unverified: roster keyboard cursor, calendar off-days, `MyLeave.css`, org chart and People panels. Check each in the browser before fixing it.

---

## Fix order

Each batch is one PR, or a few small ones. The batches are ordered by harm: money first, then trust, then keyboard use, then looks.

### Batch 1: money and records made twice, or changed without asking

These can cost a customer money or create bad records.

**Payroll:**
- "Start pay run" can be sent twice and make two runs: `PayRuns.jsx:182,407`.
- "Send to Tally" can be sent twice: `PayRuns.jsx:1394`.
- "Close period" closes on one click: `PayrollPeriods.jsx:120`.
- There are two "Post to accounts" primary buttons and neither asks first: `PayRuns.jsx:780,1574`.
- The "Lock" dialog shows no amount or head count: `round59.jsx:25`.
- The paise tick on a payment line has no confirm: `PayrollPayments.jsx:668`.
- Paise are dropped by `wholeRupees` in 11 files.

**People:**
- "Send to Payroll" on a salary advance can be sent twice and make two loans: `money/Expenses.jsx:319`.
- The abscond notice and the abscond record go through with no confirm: `time/Absences.jsx:224`.

**Ops:**
- Money writes have no idempotency key: manual payment, invoice issue and mark-paid, renewals run. Fix by adding them to `GUARDED_WRITE`.
- These change things in one click with no confirm:
  - switching the active payment gateway: `Payments.jsx:286`
  - issuing all due renewal invoices: `InvoiceSettings.jsx:172`
  - saving the GST rate: `Settings.jsx:47`
  - replacing every plan with sample prices: `Pricing.jsx:447`
- "Mark paid" activates the subscription even when the amount is short: `Invoices.jsx:787`.
- The Issue and Cancel invoice confirms don't name the amount or the customer.
- Deals can confirm a stale quote: `Deals.jsx:70`.
- A confirm can be closed while its request is still running: `kit.jsx:136`.

**Attendance:** 14 saves have no busy state, so they can make duplicate holidays, readers and geofences. Remove schedule has no confirm: `ShiftAssignments.jsx:104`, `TemporarySchedule.jsx:171`, `DepartmentSchedule.jsx:141`. Bulk Validate and Transfer have no confirm.

**Admin center:** member actions have no busy state, so suspend and remove can be sent twice: `Members.jsx:120`. "Withdraw invitation" has no confirm: `Invitations.jsx:232`.

**Pattern:** about 591 buttons outside Books build their own busy state. Seven use the shared `<Button loading>`, which already does busy, double-click lock and "Saved". Moving screens to it fixes this whole class of bug.

### Batch 2: a failed load that looks like "nothing here"

**Admin center:**
- Members, Invitations, Companies, Users and Activity show "Nobody is in the account yet" when a load fails, which invites re-inviting people who already exist.
- Home shows "Nothing needs your action" when the load fails.
- SSO shows a skeleton forever: `SsoSettings.jsx:107`.

**People:** 56 `.catch(() => [])` calls. For example, Interviews shows "Nobody is in the running".

**Attendance:** the calendar side panel shows "Nobody employed that day" on error.

**Payroll:** a failed run load is a skeleton forever, and a failed payment load is a blank page. Five screens show an error with no retry.

**Ops:** any failure at the console gate (a 503, say) shows "This page is for CLOR staff" with no retry: `OpsConsole.jsx:471`.

**Fix:** `LoadError` / `LoadFailed` with `onRetry`, and never an empty state after an error.

### Batch 3: keyboard, focus and lost edits (mostly shared code, so one fix reaches every app)

**Escape is handled in several places with no agreement on who goes first** (Drawer window capture, Modal window bubble, confirm on document, code prompt):
- Escape in a dialog opened from a drawer closes the drawer.
- Escape on a confirm opened from a Modal closes the Modal too.
- Escape on the 2FA code prompt closes the form under it, which loses Ops payments and invoices.
- Fix: one stack of open layers, and only the top one handles Escape.

**Fields lose their focus ring after a mouse click:** `legibility.css:89`.

**Drawers lose edits on Escape:**
- Ops: no drawer has an unsaved-changes guard.
- Attendance: 33 of 34 drawers.
- Payroll: 18 of 20.
- Admin center: role editor, invite, branch, SSO and new ticket.
- Fix: pass the `dirty` value the screens already compute. The role switch in `RolePermissionManager.jsx:251` also drops unsaved ticks.

**Rows only a mouse can open** (Attendance: Shifts, Geofences, Contractors, Devices): make the name cell a button.

**Form errors not tied to their fields:**
- Sign-up, sign-in, company setup and reset password show one line at the bottom.
- The new GSTIN error appears under the app checkboxes.
- Ops has zero `aria-invalid`; Payroll screens have zero.
- Fix: `useFieldErrors`, which already exists but is unused outside Books.

**Smaller fixes:**
- Toasts have no close button: add `closeButton` to the Toaster.
- The confirm, code prompt and search palette don't trap Tab or return focus.
- Sign out skips the unsaved-changes check.

**Money inputs:** 39 in Payroll plus others in Ops use `type="number"`, so the mouse wheel changes amounts. Use text with `inputMode="decimal"`.

### Batch 4: type and palette

**Fonts and type size:**
- **Body is 13px, not 14/20.** `index.css:4938` sets `--type-body: 0.8125rem` for body and every field. Only Admin pages and table cells were moved to 14. This is the largest visual gap.
- **Inter still ships.** It is imported in `index.css:8`, used as a fallback in about 30 stacks, and named in the charts (`CircularCharts.jsx:22`), so chart text renders in Inter. The `@fontsource/sora` package is unused.
- **Titles are not one rule.** A bare `h1` is 24/28.8, the gate `h1` is 28/36, and `.ws-title` is 600 weight with tracking.
- **Section headings are 700, not 600:** 8 People rules. Figures are 700 with negative tracking. People figures grow to 24 on phones. One Attendance figure is 32/40; one data-health figure is 40px at 800.
- **Uppercase and letter-spacing remain:** 28 uppercase rules in `index.css`; `.ui-th` base is 11px/700 uppercase; about 90 non-zero letter-spacing values; People figure labels are uppercase.
- **People turns off JetBrains Mono:** `people.css:788` makes `.ui-mono` inherit, so PAN, IFSC and employee numbers show in Figtree in People only.

**Colour:**
- **The app colour has more than four jobs.**
  - Charts default to it: `CircularCharts.jsx`.
  - Tinted icon chips, 17 tints and gradients in `index.css`.
  - The roster selection fill.
  - The Attendance ring chart and the portal icon.
  - The goal ring, department bars and the toggle fill in People.
  - The month to-do marker in Payroll.
- **Hover grey is not one value.** `--surface-sunken` and `--panel` are now white, but some hover rules still use them (see "Checked by hand"). Admin center uses `#F4F5F2` (`--ws-stone`) instead of #F7F7F7.
- **Ops has no app colour.** No `data-portal="ops"` block exists, so it falls back to the default orange `#C95000`.
- **Three oranges are live:**
  - `#FF5400`: the logo as rendered, the PWA icons and the site.
  - `#FF6B00`: what DESIGN.md names.
  - `#C95000`: the default `--act`.

  The old `#E54F38` and `#D9222A` are gone.
- **Figure tiles break the rules:** they are shown at zero, there are more than four, or they are tinted. This affects People Overview and Home, Payroll (7 separate tile implementations), Attendance Insights, Readiness and Data protection, and Admin center's four-colour tiles.
- **Tags appear on rows in the expected state:** People Talent lists, plus many in Payroll (Open, Done, Yes, Balanced).

**Stylesheet cascade:** `legibility.css` and `picks.css` beat the token file because of id selectors and `!important`, the reverse of DESIGN.md migration step 1. There are duplicate tokens (`--brand` ×7, `--tint` ×12) and dead palette blocks (sky, blaze, payroll, dark).

**Components differ by app:**
- Admin center buttons are 40px tall; everywhere else they are 36.
- Ops table rows are 48px; elsewhere 44.
- Page gutters are 16, 32 or 24 depending on the app.
- Focus has three treatments.

### Batch 5: motion (DESIGN.md: hover 120ms, menus 150, dialogs and drawers 180, ease-out, numbers never animate)

- **Durations off the house numbers:**
  - `--dur-surface` is 200ms (dialogs, drawers and button hover).
  - Menus take 120ms.
  - Page entrances take 320ms.
  - Admin center hovers take 150–200ms, People 200ms, Ops plain `ease`.
  - **Fix:** add `--dur-hover:120ms`, `--dur-menu:150ms` and `--dur-dialog:180ms` tokens and use only those.
- **List rows fade in one after another on every load:** the `.ui-rows` stagger, 93 call sites. People already turns it off.
- **Data animates on load:** bars grow, the hero fill takes 900ms, the week bars 700ms. That goes against "numbers never animate".
- **Decorative loops run forever:** orbs, float, hero drift, the sign-in backdrop.
- **Layout properties are animated:** tab underline width, `grid-template-rows`, padding.
- **Easing is wrong in places:** drawers use ease-out but should use ease-in-out; exits use ease-in.
- **People keeps 120–160ms fades and a 0.98 press-scale under reduced motion.** DESIGN.md says all motion stops.

Payroll and Attendance are clean apart from one inline transition, with no motion problems found.

### Batch 6: clor.in

- **High:** `#` links (the section bar, "See how CLOR joins them up", the skip link) jump back to the top of the page: `router.jsx:26`.
- **Contact form is a dead end:** it only opens a `mailto:` link, so webmail users see nothing happen. Post it to the API like the Demo form does.
- **A half-filled Demo form is lost** when a header link is clicked.
- **Pricing changes after it paints:** the live fetch replaces the prices, a 404 removes the plans, and `?period=yearly` shows monthly first.
- **Header menus stay open when Tab moves past them,** and take about 380ms to settle.
- **Cards lift on hover but aren't links.**
- **Some animations loop forever with no pause;** `wire-run` animates `right`.
- **The hero photo fades in late,** which delays the page's main image (LCP).
- **The site's fonts and colours differ from the apps:**
  - Plus Jakarta Sans instead of Figtree.
  - Its own 17px type scale.
  - Cool slate neutrals.
  - Product colours that don't match the apps: People `#C93F28` against the app's `#A21CAF`.

---

## Decisions for the owner

1. **clor.in fonts.** Should clor.in use Figtree and the app type scale, or keep Plus Jakarta Sans? DESIGN.md leaves the marketing site out today. Either way, the product colours on the site should match the apps.
2. **One logo orange.** Pick `#FF5400` (what renders now) or `#FF6B00` (what DESIGN.md says). Logo, tokens and DESIGN.md then follow.
3. **An Ops colour.** The code comment says forest green, but none is set.
4. **The grey rail.** It is `#F3F3F0`, your pick on 19 Nov, but DESIGN.md still says every ground is white. DESIGN.md should record the exception.
5. **Light colour accents.** You asked for them on Admin center Home on 20 Nov, which departs from "no tints". Say whether the same accents should spread to the other Home pages or stay on Admin center only.

## Already in good shape

- **Shared `Button`:** busy, lock and "Saved" states.
- **Modal and Drawer:** focus trap and return, and dirty guards where screens pass them.
- **Menus and DatePicker:** keyboard support.
- **Reduced motion:** a global kill switch covers it.
- **No count-up numbers** and no `transition: all` anywhere.
- **People:**
  - 27 files confirm destructive actions.
  - 39 files guard unsaved edits.
  - The approvals inbox has tick and cross buttons with per-row busy states.
- **Payroll:**
  - Money tables right-aligned with tabular figures.
  - Count lines on list pages.
  - Approve dialogs state the amount and head count.
- **Ops:** customer suspend, cancel and resume; the typed "LIVE" switch; email templates with preview and test.
- **clor.in:**
  - Focus rings and a skip link.
  - A mobile menu with focus trap.
  - The Demo form's validation.
  - Scroll reveal that hides nothing without JavaScript.
