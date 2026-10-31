# clor-coder — People colours

## 2026-10-31 IST — People / brand colours (all ten approved changes)
- Did: built the ten colour changes the owner approved after the designer's audit (`docs/people/design-v1/COLOUR-AUDIT-2026-10-31.md`): waiting tab counts marigold (`data-tone="warn"`, fixed the dead `.ui-count` selector), bell count 12px and marigold in People with unread dots, one solid-marigold "waiting", zero figures quiet grey again and a marigold bar on waiting figures, People report tiles in brand D, status tokens (`--warn` #7A4F00 words / `--warn-mark` marigold marks, `--neg` #B91C1C, new `--away` #8D84C6), clash lines marigold-soft, one series for charts/teams/gender/faces/uncoloured leave types (`--dept-*`, new `--leave-*`, `swatchOf`), lilac tile on the panel's open screen and Settings icons, employee app's waiting pill and open tab through `data-brand="d"` (not the sky palette, so Attendance keeps Blaze). DESIGN.md wording and a 2026-10-31 decision row.
- Evidence: `test/people-colours.test.js` (23 tests); full web suite 289 files, 2081 passed; `eslint .` 0 errors. Browser-checked on API 4031 / web 5211 / DB clor_e2e_colour (dropped after) at 1440 and 390, owner, HR and the employee app; screenshots kept outside the repo (after-real-*.png beside the audit mocks).
- Next: code review.
- Blocked on: nothing.
