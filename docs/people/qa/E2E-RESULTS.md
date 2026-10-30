# People end-to-end results

Last run: 30 Oct 2026, 4:12 pm IST, 3.9 minutes. Written by `npm run e2e:report` from the Playwright run (e2e/README.md); do not edit by hand.

PASS 63 · KNOWN BUG 5 · FLAKY 0 · FIXED? 0 · FAIL 0 (desktop and phone counted separately).

Scenario IDs are those of [PERSONA-SCENARIOS.md](PERSONA-SCENARIOS.md); T1–T4 are hiring, referrals, shift swaps and request types, which have no number there yet.

| Scenario | What | Desktop | Phone | Note |
|---|---|---|---|---|
| E1 | two days of casual leave next week, with a reason | PASS | PASS |  |
| E2 | half a day, the afternoon only | KNOWN BUG | KNOWN BUG | My requests shows "0.5 days" but not which half of the day was asked for |
| E3 | leave over a public holiday | PASS | PASS |  |
| E4 | more leave than the balance is refused before sending | PASS | PASS |  |
| E5 | withdraw a request still waiting | PASS | PASS |  |
| E10 | Priya sees her manager and her job details | PASS | PASS |  |
| E11 | Priya opens the HR pages by address: refused, nothing about anyone shown | PASS | PASS |  |
| M1 | approve a team member’s leave from Approvals | PASS | PASS |  |
| M2 | reject with a reason | PASS | PASS |  |
| M3 | two waiting items, approved once each even on a double tap | PASS | PASS |  |
| M4 | who is away this week, only my team, clashes flagged | KNOWN BUG | KNOWN BUG | Who's away (and the Leave calendar) list two of Rahul's team away on the same day but flag no clash; only the approval panel's "Also away then" shows it |
| M6 | a team member’s profile shows work, not pay or private details | PASS | PASS |  |
| M7 | someone outside my team is not listed and not reachable by address | PASS | PASS |  |
| M8 | my own leave goes to my manager, never to me | PASS | PASS |  |
| H1 | add an employee through all four steps; back to step 1 and forward again | PASS | PASS |  |
| H2 | a duplicate employee ID or email is stopped, in plain words | PASS | PASS |  |
| H4 | process Meena leaving: last day, reason, handover | PASS | PASS |  |
| H8 | change Priya’s department and manager from next month | PASS | KNOWN BUG | on a phone, Job changes shows "Department → Sales" with no "from" value (the desktop table shows "Production → Sales") |
| H11 | the same employee edited in two tabs: the second save is refused | PASS | PASS |  |
| A1 | first sign-in after sign-up lands in People, ready for the first employee | PASS | PASS |  |
| A3 | Kavya has HR access and Rahul team-manager access, and each sees exactly that | PASS | PASS |  |
| A4 | switch to Vels Traders: only Vels’s people, nothing of Asha’s | PASS | PASS |  |
| A7 | a one-person business does everything alone | PASS | PASS |  |
| B1 | Other Co's employee id in the address, as hr | PASS | PASS |  |
| B1 | Other Co's employee id in the address, as manager | PASS | PASS |  |
| B1 | Other Co's employee id in the address, as owner | PASS | PASS |  |
| B2 | searching for an Other Co employee finds nothing, as hr | PASS | PASS |  |
| B2 | searching for an Other Co employee finds nothing, as manager | PASS | PASS |  |
| B2 | searching for an Other Co employee finds nothing, as owner | PASS | PASS |  |
| B3 | sign out, then Back: nothing shown, asked to sign in | PASS | PASS |  |
| T1 | Kavya opens a job to take candidates | PASS | PASS |  |
| T2 | Priya refers a friend for an open job; Kavya sees the referral | PASS | PASS |  |
| T3 | Priya swaps a shift with Imran; Imran accepts; Rahul approves | PASS | PASS |  |
| T4 | Priya asks HR for a new ID card; Kavya approves it | PASS | PASS |  |
