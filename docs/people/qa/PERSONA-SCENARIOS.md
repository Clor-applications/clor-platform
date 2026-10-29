# People — scenarios by person

The QA tester runs these as one tester per person, side by side. Each scenario is a real task with an expected
result, done the way that person would do it (phone or desktop), not a list of buttons. A button that does nothing
counts as a failure of the scenario it sits in.

How to run: one `clor-qa-tester` per person below, against staging (`https://app.staging.clor.in`) or a lane's local
ports. Every scenario is checked at 1440×900 and 390×844 unless marked. Record PASS / FAIL / BLOCKED with evidence
in `docs/people/design-v1/<MODULE>-QA-<date>.md`. Add scenarios here as modules ship; never delete one, mark it
retired.

## The company used for testing

One test company, "Asha Textiles" (Karnataka, 12 people), with a second company, "Vels Traders" (Tamil Nadu), in
the same account, plus a separate account, "Other Co", for boundary checks.

| Person | Role | Signs in on |
|---|---|---|
| Suresh | Owner (account owner, company admin) | desktop and phone |
| Kavya | HR (People admin) | desktop |
| Rahul | Manager of 4 (team-limited) | phone and desktop |
| Priya | Employee in Rahul's team | phone (employee app) |
| Arjun | Employee in another team | phone |
| Meena | Employee on notice | phone |

## Employee (Priya, phone first)

| # | Scenario | Expected |
|---|---|---|
| E1 | Apply for 2 days' casual leave next week with a reason | Request shows as waiting; the balance shows "2 pending"; Rahul is notified |
| E2 | Apply for half a day, afternoon only | Counted as 0.5; the request shows the afternoon |
| E3 | Leave over a public holiday | The holiday isn't deducted; the preview shows each day |
| E4 | More leave than the balance | Refused before submitting, in plain words; nothing saved |
| E5 | Withdraw a request still waiting | Request withdrawn; the balance restored; Rahul's approval item disappears |
| E6 | Request a change to my phone and address | A change request waits for HR; the profile still shows the old value until approved |
| E7 | See my documents, download one | Only my own documents; the download works on the phone |
| E8 | Read and accept a new policy | Marked accepted with the date; asked once, not again |
| E9 | Raise a help-desk request with an attachment | Reaches HR's help desk; I see its status and HR's reply |
| E10 | See who my manager is and my job details | Correct manager, designation, department, works at |
| E11 | Try to open the HR or admin pages by address | Refused plainly; nothing about other people shown |
| E12 | Lose the network halfway through a leave request | Input kept; a clear retry; no double request |

## Manager (Rahul)

| # | Scenario | Expected |
|---|---|---|
| M1 | Approve Priya's leave from Approvals, on the phone | Priya notified; her balance updated; Who's away shows her |
| M2 | Reject with a reason | Priya sees the reason; the balance is untouched |
| M3 | Two pending items: approve both | Each processed once; a double tap doesn't approve twice |
| M4 | See who's away this week and any clashes in the team | Only my team; clashes flagged |
| M5 | Set Kavya as delegate while I'm on leave | Requests arriving during the dates go to Kavya; mine stop |
| M6 | Open a team member's profile | Work details visible; salary, bank, PAN and health hidden |
| M7 | Try to open Arjun (not in my team) | Refused or not listed; no details leak via search or the address |
| M8 | My own leave request | Goes to my manager, never to me; I can't approve my own |

## HR (Kavya, desktop)

| # | Scenario | Expected |
|---|---|---|
| H1 | Add an employee through all four steps; go back to step 1 and forward | Nothing typed is lost; the review shows everything; one employee is created, even on a double click |
| H2 | Add an employee with a duplicate employee ID or email | Stopped at that field, in plain words |
| H3 | Start onboarding: checklist, documents, employee app invite | Tasks assigned; the joiner gets the invite; progress shows |
| H4 | Process someone leaving (Meena): last day, reason, handover | Exit checklist made; her approvals and assets handed over; she stops on the last day |
| H5 | Keep someone on notice (withdraw the leaving) | Back to active; the exit tasks closed; history shows both |
| H6 | Documents expiring in 30 days | Listed; the reminder goes to the right person |
| H7 | Import 20 employees from Excel with 2 bad rows | Good rows in; bad rows listed with the reason; undo works |
| H8 | Change Priya's department and manager from next month | Effective-dated; history shows from and to; her waiting manager steps move |
| H9 | Publish a policy needing acceptance | Employees see it; the acceptance count updates |
| H10 | A confidential case visible only to named members | Others can't see it, even in search or history |
| H11 | Edit the same employee in two tabs | The second save is refused with "someone else changed this"; nothing overwritten |

## Owner / admin (Suresh)

| # | Scenario | Expected |
|---|---|---|
| A1 | First sign-in after sign-up: set up the company, open People | Lands in People with nothing to configure before adding the first employee |
| A2 | Departments, designations, a branch; retire a branch with people in it | Asked where to move them first; each move recorded |
| A3 | Give Kavya HR access and Rahul team-manager access | Each sees exactly what the role allows (cross-check with the H and M scenarios) |
| A4 | Switch to Vels Traders | Only Vels's people; no Asha data in lists, search, the address or cached screens |
| A5 | Reports: headcount, joiners and leavers this month | Figures match the records; export works and is logged |
| A6 | Data check and privacy controls in Settings | Issues listed with a fix link each |
| A7 | Do everything as the only person in the company (one-person business) | No step needs a second user or a manager to exist |

## Boundaries, for every person

| # | Check | Expected |
|---|---|---|
| B1 | Other Co's employee id in the address | Not found; nothing leaks |
| B2 | Search for an Other Co employee's name | No result |
| B3 | Sign out, then press Back | No data shown; asked to sign in |
| B4 | A session left open after Meena leaves | Her next action is refused |
