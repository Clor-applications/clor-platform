# Batch 9 — follow-ups (2026-10-24)

| Follow-up | Fix | Evidence |
|---|---|---|
| `companyClosure.test.ts` purged every company past notice, colliding with other suites on the same database | `purgeClosedCompanies(now, { only })`; the closure tests (and Batch 6's resume test) purge only their own companies; the job passes nothing | `closure-tests.txt` |
| `homeBoard.test.jsx` built dates in UTC; failed whenever local date ≠ UTC date (before 05:30 IST) | dates built in local time, as the board reads them | `homeBoard-before-fix.txt` (old test, Los Angeles now: 1 fails), `homeBoard-after-fix.txt` (4 timezones: 11/11) |
| Users table: e-mail written over the Role column at narrow width | column widths matched to the columns (User ID had the e-mail's width since the User ID column was added); cells truncate with the full value on hover; on a phone the table scrolls | `users-phone-before.jpg`, `users-phone-after.jpg` |
| Users screen: an error from the edit form showed at the top of the page, out of sight | the error shows inside whichever form or dialog was saved (edit, create, companies, branches); at the top only when none is open | `users-error-in-drawer.jpg` |
| `/?share=` in a signed-in browser showed the app | fixed in Batch 5 U4 (`main.jsx`) | `B5-U4/browser-check.md` |

Left with their owners:
- Signup e-mail enumeration — signing up logs straight in, so it must say an address is taken; closing it means "check your e-mail first", a product decision for the owner.
- Employee drawer title at phone width and the People icon artwork — the People build session owns `packages/ui/src/personnel/*` and `apps/people` and has them in progress.
