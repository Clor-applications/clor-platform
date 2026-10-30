## 2026-10-30 14:30 IST — People / Talent — referrals review fixes (PR #76)
- Did:
  - Every duplicate now gets one neutral refusal. The real reason goes to the audit log.
  - The referral-link key is derived with HKDF, and production refuses to make links when no secret is set. A link shown again after a secret rotation is re-saved.
  - The talent job sweeps referrals that missed their outcome.
  - Sending to Payroll, forfeiting and marking paid each lock the referral row first. Forfeiting voids or deletes the draft earning.
  - A referrer who has left is pointed to their final settlement.
  - The bonus date is worked out again from the hire's record on each run, and the 90-day fallback is said in plain words.
  - The public page says what the referrer will see.
  - New company rule for a referrer who leaves (default: not paid; serving notice counts as still here), shown on each job card.
  - An internal hire books a pending job change on the record; someone suspended is refused.
  - HR's list no longer writes anything.
  - Anonymising an employee clears referral details.
  - The bonus component is matched by its code only.
  - Rate limits added, and referral résumés are capped at 2 MB with a 3 MB body limit.
- Evidence: peopleReferrals 15 passed; anonymiseEmployee, peopleTalent, peopleRls, routeManifest, portalEmployeeApp 32 passed; web 41 + Referrals 5 passed; screenshots docs/people/design-v1/evidence/referrals/ (duplicate refused, bonus rule, public page)
- Next: re-review
- Blocked on: nothing

## 2026-10-30 12:40 IST — People / Talent — employee referrals (A20)
- Did: Built employee referrals end to end. HR can open a job to referrals with an optional bonus (after N days, or at probation end) and an audience (everyone, some departments or some branches), and can let staff apply themselves. Staff hear of it on the bell and in the employee app. They can refer from People web (Refer someone) or the employee app (Me → Jobs), with a résumé checked by its bytes, or share their own link on WhatsApp. Duplicates are refused under advisory locks: same opening, or anyone referred in the last six months, or someone who already works here. The referrer sees plain stages only. On Joined and on Not taken forward, the referrer gets a notice. The bonus becomes a draft earning in Payroll exactly once (`referral-bonus:<id>`). Without Payroll it shows as due, and HR marks it paid. It is forfeited if the hire or the referrer leaves before the date. HR gets a Referrals list with filters and a by-employee report. Hiring an internal applicant does not make a second employee record.
- Evidence: branch claude/people-referrals; server tests peopleReferrals (9), peopleTalent, peopleRls (+Referral, ReferralLink), routeManifest: 34 passed; web ReferJobs (6), Referrals (3), people-talent and portal-employee-app updated: 47 passed; screenshots docs/people/design-v1/evidence/referrals/
- Next: code review of the PR
- Blocked on: nothing
