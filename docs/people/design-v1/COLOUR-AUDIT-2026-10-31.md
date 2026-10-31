# People colour audit: where marigold and the other colours go missing

> Designer audit, 31 Oct 2026. The before/after screenshots it names were captured on an e2e world and kept outside the repo. The owner approved all ten changes the same day ("Yes, all ten"); they are built in the PR that adds this file. The "after" column described injected mocks; the shipped CSS is the "Brand colours where they belong" block in `packages/ui/src/people.css`, and DESIGN.md carries the wording.

clor-designer, 31 Oct 2026. Branch `claude/people-colour-audit` (origin/main 0fe707ca plus origin/claude/button-states, PR #84). E2E world on API 4031, web 5211 (dev), DB `clor_e2e_colour`, seeded desktop and given 4 waiting leave requests, 2 approved, 1 rejected, a manager's own request, late days and a claim. Owner and HR at 1440 and 390, plus the employee app at 390, one Payroll and one Books screen. Nothing is committed. The "after" shots use `after.css`, plus `after.js`, which stands in for props a component would pass (a tab's tone, a figure's "waiting" flag, an alert's tone). Both files are in this folder.

## What the owner is seeing

He is right. On most screens marigold shows in only three places: the rail's open-module bar, the arrow on the main button and the button icons (#84). The places that mean "waiting on you" (tab counts, the bell, figures, to-do steps, clashes) are indigo, grey or red. Five root causes in code, all in `packages/ui/src/people.css` unless noted:

1. **A dead selector.** Brand D makes tab counts marigold with `.ui-tab .ui-count` (line 1821). No component renders `.ui-count`. Tabs render `.ui-tab-count`, so every count stays lilac or grey. Examples: "Waiting 4", "Waiting for me 4", "Not marked 11".
2. **Brand D did not touch the status tokens.** `--warn` is still the teal-era orange `178 80 0` (#B25000), declared on `[data-palette='sky']`, which the shell also sets on an inner element (`Shell.jsx:1007`). So attention dots, half-day marks and the late-line gradient are orange, not marigold. `--warn-soft` is #FCDFA8 while `--warm-soft` is #FEF1D6. `--neg` is Apple red #D70015, not DESIGN's #B91C1C. `--pos` and `--info` both collapse to indigo (line 1785), so Present, On leave and Approved are the same indigo dot.
3. **A specificity regression.** "A figure at nought is quiet grey" (line 1408, `[data-zero]`) loses to brand D's "Indigo: headings and the big figures" (line 1816), which carries an extra `:not([data-theme])`. Every 0 is bold indigo, so Joining & leaving reads as five shouting zeros.
4. **A rule that only half applies.** The brand D figure-card fix targets `section > button.ui-card`. Cards that are not clickable (`div.ui-card`, `ListPageParts.jsx:79`) are missed, so the People report shows Payroll's tones: blue-700 #1D4ED8, green-700 #15803D, slate figures and CAPS labels.
5. **Colours from outside brand D.** The bell count is `--neg` red with 10px text (`packages/shell/NotificationBell.jsx:64`), below the 12px floor. Charts and faces use `--dept-0..8` (teal, orange, crimson, olive, purple, blue, from `index.css:7214`), and the gender bar is blue against crimson. Leave types use Tailwind hexes (`timeOff/api.js:146`, Casual leave shows #db2777 pink). The employee app has no `data-palette`, so its "Waiting" is peach with orange-brown text, and it never shows marigold.

Two smaller ones:

- The module panel's selected item is `--brand-subtle` #F5F3FA on the #F7F5FC panel. That is 1.02:1, so the open screen is invisible. DESIGN says it "keeps the lilac tile".
- The clash notice on Leave requests ("Production is short on 2 Nov") is drawn in red as if it were an error. It is a "look here".

Three marigolds show "Waiting" today: solid #F5A623 on Who's away, #FCDFA8 in the side panel, and peach with #9A4600 text in the employee app.

## Colour-usage map (People, light)

| Colour | Job | Gets it | Never |
|---|---|---|---|
| Indigo #232A66 | Ink of action and place | Buttons, links, headings, figures above 0, focus ring, Present/Approved marks, avatar initials | Zero figures; warnings |
| Marigold #F5A623 (fill) | Waiting on you | Tab counts on Waiting/Not marked/To do tabs, bell count and unread dot, "Waiting"/"To do"/"This week" pills, count chips in Waiting for you, a 3px bar on a figure that waits on you and is above 0, the open module's icon fill and bar, button icons (#84), half-day mark, clash bar | Text on white (2.0:1); decoration; zero counts |
| Marigold-soft #FEF1D6 | A look-here band | Clash or notice lines (indigo text 11.8:1, a marigold 3px edge, #C98200 icon 3.2:1) | Pills (use solid) |
| Deep marigold #C98200 | Marigold as a line on white | Button and alert icons (3.15:1, at least the 3:1 a graphic needs) | Running text |
| Lilac #E9E5F4 | Chosen or done | Selected rail and panel item (with a #C9C3E5 inset line), Done/Approved/Active pills, head row, icon tiles, date tiles, inactive tab counts | "Waiting" |
| Lilac-deep #8D84C6 (new) | Away | On-leave marks (bar, dot), third chart series. 3.36:1 on white, 3.9:1 against indigo, so it stays apart from Present | Text |
| Red #B91C1C | Went wrong | Rejected, overdue, absent, errors (6.5:1 on white) | Clashes, counts, the bell |
| Quiet grey #686B7C | Nothing here | Zero figures (5.3:1), "Not marked" pill text | Anything that wants a look |
| Chart series | Categories | indigo → marigold → lilac-deep → #C98200 → #5A61A8 → #C9C3E5 → grey | Rainbow `--dept-*` |

## Top 10 changes (before → after)

| # | Change | Before | After | Owner? |
|---|---|---|---|---|
| 1 | Panel selected item: lilac #E9E5F4 tile, #C9C3E5 inset line, weight 600 | before-owner-1440-employees.png | after-owner-1440-employees.png | No (bug; DESIGN already says lilac tile) |
| 2 | Tab counts: fix `.ui-tab-count` selector. Marigold on tabs that wait on you (Waiting, Waiting for me, Not marked, To do), lilac on the rest. Needs a `tone` on the Tabs count | before-owner-1440-leaveRequests.png, before-owner-1440-approvals.png | after-owner-1440-leaveRequests.png, after-owner-1440-approvals.png | No (bug; DESIGN line 1817 intent) |
| 3 | Bell: marigold count with indigo (6.5:1), 12px, a white ring, and a marigold dot on unread rows (was red, 10px, bold only) | before-owner-1440-bell.png | after-owner-1440-bell.png | Yes (shell-wide component; scope to sky first) |
| 4 | One "waiting" style: solid marigold with indigo everywhere (side panel, "To do" step, employee app) | before-owner-1440-leaveRequests.png, before-owner-1440-homefull.png, before-app-390-appleave.png | after-owner-1440-leaveRequests.png, after-owner-1440-homefull.png, after-app-390-appleave.png | No |
| 5 | Figures: 0 is quiet grey (fix the specificity), and a figure that waits on you and is above 0 gets a 3px marigold top bar | before-owner-1440-lifecycle.png, before-owner-1440-timeOverview.png | after-owner-1440-lifecycle.png, after-owner-1440-timeOverview.png | No (DESIGN already says grey) |
| 6 | Report figure cards: extend the brand D rule to `div.ui-card` (indigo figure, lilac tile, sentence case) | before-owner-1440-reports.png | after-owner-1440-reports.png | No |
| 7 | Status marks: Present indigo, On leave lilac-deep (new `--away`), Half day marigold, Absent red #B91C1C, Not marked grey. Pill text stays indigo on lilac (10.7:1) | before-owner-1440-attendance.png, before-owner-390-attendance.png | after-owner-1440-attendance.png, after-owner-390-attendance.png | Yes (new token, red value) |
| 8 | Warnings: `--warn` becomes marigold and `--warn-soft` becomes #FEF1D6. The clash becomes a marigold-soft line with a marigold edge (the screen passes `tone="warn"`, not `neg`) | before-owner-1440-leaveRequests.png (red box), before-owner-1440-employees.png (orange dot) | after-owner-1440-leaveRequests.png, after-owner-1440-employees.png | No |
| 9 | Charts, faces and leave types on a brand D series. Gender becomes indigo and marigold, not blue and crimson. Face initials in indigo on a 16% wash (never the series colour as text: marigold would be 2:1). Leave-type colours map onto the same series | before-owner-1440-home-charts-crop.png, before-owner-1440-home-waiting-crop.png | after-owner-1440-home-charts-crop.png, after-owner-1440-home-waiting-crop.png | Yes (DESIGN: "Brand D has no green, peach or purple"; needs a chart series written down) |
| 10 | Employee app wears brand D (`data-palette="sky"` on the portal root): marigold "Waiting", and later the open tab's marigold fill. Settings and empty-state icons on a lilac tile | before-app-390-appleave.png, before-owner-1440-settings.png | after-app-390-appleave.png, after-owner-1440-settings.png | Yes (the app is shared with Attendance) |

What already looks right: Who's away (solid marigold "Waiting" and the clash pill), Home's "This week" pills, Done pills in lilac, the rail's open module (lilac tile, marigold bar and fill), the phone tab bar, and the head-row band. Payroll and Books stay graphite and indigo on purpose; they are the contrast (before-owner-1440-payroll.png, before-owner-1440-books.png).

Also seen, not mocked:

- Leave calendar: today's column has no marigold, and Casual leave is pink.
- Employee record: "Before payday 1" and its dot are grey, though it is a blocker. It should take the marigold edge.
- Pagination's current page is a solid indigo square, while tabs mark the chosen one with a white chip on a tray. These are two different "chosen" styles; lilac is the documented one.
- Phone Home says "Nothing waits for your answer" while it is still loading.

## DESIGN.md wording that needs the owner

- Colour section: "Brand D has no green, peach or purple" stays, but add: "**Charts and categories** use one series: indigo, marigold, lilac-deep #8D84C6, deep marigold #C98200, indigo-60 #5A61A8, lilac line #C9C3E5, grey. Never the old department rainbow. Initials are indigo on a wash."
- Add "**Away** (on leave, out today) is lilac-deep #8D84C6 as a mark, never text."
- Change "Money semantics … out / late #B91C1C" so it also covers People: "**Red #B91C1C is for what went wrong** (rejected, overdue, absent, failed). A clash or a notice is marigold-soft, not red." Replace #D70015 in People.
- Marigold line: add "the bell's count and unread dot, tab counts on tabs that wait on you, and a figure above nought that waits on you".
- Add "**Deep marigold #C98200** is marigold drawn as a line on white (icons, 3.2:1)". Today this lives only in the button decision of 31 Oct.
- Note that the employee app wears People's brand D, if the owner agrees (Attendance shares it).

## Contrast measured (WCAG)

Indigo on marigold 6.50. Indigo on #FEF1D6 11.77. Indigo on lilac 10.65. #C98200 on white 3.15. Marigold on white 2.03 (never text). Lilac-deep on white 3.36, against indigo 3.92. Quiet grey on white 5.27. #B91C1C on white 6.47, on #FDECEC 5.66. Panel selected now 1.02, proposed lilac 1.14 plus an inset #C9C3E5 line and weight 600, which carry the state. Old #B25000 5.20 and #D70015 with white 5.38 pass, but they are off-brand.
