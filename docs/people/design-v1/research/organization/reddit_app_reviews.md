# Raw user complaints about org structure in HR software (Reddit and app stores)

Method and coverage (read this first):
- **Reddit: no data.** Every route was blocked on 2026-10-26. WebFetch refuses www.reddit.com. curl to reddit.com `.json` returned HTTP 403. Pullpush.io returned 429 ("does not provide free scraping resources for agents"). Arctic Shift returned a Cloudflare 530/1033 error. Two WebSearch queries scoped to reddit.com returned no Reddit threads. **This note contains no Reddit quotes.** Do not treat "nothing on Reddit" as evidence that users don't complain there.
- **Google Play: pulled directly** with the `google-play-scraper` library (country=in, lang=en). For each app I took up to 3,000 newest reviews plus up to 1,000 "most relevant" ones and filtered them by keyword. Apps covered: Keka (com.keka.xhr), greytHR (com.greytip.ghress), Zoho People, Darwinbox, HROne (both apps), Kredily (employee and admin), FactoHR Admin (only 12 reviews), Pocket HRMS, ZingHR, PeopleStrong, Workday, Zoho Payroll, ADP RUN. sumHR and Zimyo have no findable Android package. Links below point to the app listing with the `reviewId` parameter. Dates are the review dates.
- **Apple App Store: pulled** from the iTunes customer-review RSS feed (up to 500 most recent per app). Keka, greytHR, Zoho People, Darwinbox, HROne, Kredily, factoHR and sumHR came from the India store. Zimyo also came from the India store. BambooHR, Rippling, Gusto and Paylocity came from the US store. Apple has no per-review links, so links point to the app page.
- **G2 and Capterra: blocked** (HTTP 403 on WebFetch). The G2 items below are search-engine snippets only and should be treated as unverified.
- **Big caveat:** app-store reviews come almost entirely from *employees*, not the owners or HR admins who set up the structure. About 70% of keyword hits for "location" were about GPS attendance punching, which is out of scope and excluded here. Admin-side org-structure pain (bulk moves, renames, history) barely shows up in app stores. That gap is real and not covered by this note.

## What breaks or confuses people in this area (manager routing, org chart, departments, designations, branches, holidays)?

### Takeaway
The org-structure complaint that comes up most in Indian HR apps is a **missing or unmapped reporting manager that blocks an employee's workflow**: resignation, expense claims and confirmations got stuck (4 independent mentions, 3 vendors). Next come **wrong designations or job titles that can't be corrected** (2) and **holiday lists missing or not updated** (about 7 mentions across 3 vendors, mostly 2020–2024). Department and branch problems appear only as edge cases.

### Cited Findings

**A. Reporting manager missing, unmapped or stuck: workflows silently blocked (4 independent mentions; 3 are 2022+)**
- greytHR, 2025-01-15, 2★: "My manager' s name is not reflecting in my profile." The resignation wouldn't submit, and the user had been trying for a week. — [Google Play, greytHR](https://play.google.com/store/apps/details?id=com.greytip.ghress&reviewId=3576c0ad-643b-4ad3-aa4a-4586ddcee91b)
- ZingHR, 2023-08-24, 1★: "the app hasn't yet mapped my manager for the resignation." — [Google Play, ZingHR](https://play.google.com/store/apps/details?id=com.zinghr.app&reviewId=e8d48a45-6efa-4d2d-ac48-ce612472be4e)
- PeopleStrong, 2022-10-16, 1★: "L1 manager details are not there, it is also not allowing me to add". The user couldn't submit a reimbursement. — [Google Play, PeopleStrong](https://play.google.com/store/apps/details?id=com.peoplestrong.alt.organise&reviewId=d5ec4017-cfa4-43c9-9946-18eec6809208)
- PeopleStrong, 2022-11-10: the manager approved a confirmation "one month ago yet showing L1 approval pending". — [Google Play, PeopleStrong](https://play.google.com/store/apps/details?id=com.peoplestrong.alt.organise&reviewId=e463974a-2a3e-47f9-9a3a-9b1bdee7cf84)
- ZingHR, 2021-07-15 (older): wants a reminder to the reporting manager because claims were "still pending because my manager is not able to find" the approval mail. — [Google Play, ZingHR](https://play.google.com/store/apps/details?id=com.zinghr.app&reviewId=fce8452a-49b2-4b93-bc85-83411aceb2c1)
- Zoho People iOS, 2021-07-24 (older): title "No Option for selection of Approver" on worksheet submission. — [App Store India, Zoho People](https://apps.apple.com/in/app/id680525956)
- Keka, 2026-05-31, 3★: asks for self-regularisation "without reporting manager", citing misuse. This is the opposite case: routing *through* the manager is being abused. — [Google Play, Keka](https://play.google.com/store/apps/details?id=com.keka.xhr&reviewId=e9c5c545-2728-4e93-aa4f-55fb09410c92)
- Darwinbox iOS, 2026-10-14, 1★: shift changes need an upload first, and only "after hod and hr approves" does the change apply. Two-level HOD-then-HR routing is felt as cumbersome. — [App Store India, Darwinbox](https://apps.apple.com/in/app/id1268513740)

**B. Designation or job title wrong, and can't be fixed or isn't updated (2 mentions)**
- greytHR, 2025-05-31, 1★: "my designation is wrong in My payslip". HR told the user the payslip can't be corrected once generated. — [Google Play, greytHR](https://play.google.com/store/apps/details?id=com.greytip.ghress&reviewId=f1b96ef8-a873-4352-b6d8-084e14c56b17)
- BambooHR iOS (US), 2022-02-17, 1★: "My staff job title hasn't been updated and changed." The same reviewer sees staff "who have left several months ago" still listed. — [App Store US, BambooHR](https://apps.apple.com/us/app/id587244049)
- greytHR, 2024-02-16, 2★: after an update, "designation/ attendance is not showing". This is a display regression. — [Google Play, greytHR](https://play.google.com/store/apps/details?id=com.greytip.ghress&reviewId=5736fae4-f257-4ef1-9222-b6f255d26b3c)

**C. Holiday list missing, not shown or not updated (about 7 mentions, 3 vendors; mostly older than 2023)**
- ZingHR, 2021-01-27: the 2021 holiday list was still not updated, so the user "marked attendance on Holiday also". — [Google Play, ZingHR](https://play.google.com/store/apps/details?id=com.zinghr.app&reviewId=1392c11f-2391-434d-9d63-4f02f4ad9614)
- ZingHR, 2020-10-22: "holiday list not showing on app but its showing on web portal". Also 2018-12-04 and 2021-02-23 mentions. — [Google Play, ZingHR](https://play.google.com/store/apps/details?id=com.zinghr.app&reviewId=f6ff1c2e-238e-4104-bc9f-f433d629d8ee)
- greytHR, 2024-01-17: "Not showing festival ( government) holiday list". — [Google Play, greytHR](https://play.google.com/store/apps/details?id=com.greytip.ghress&reviewId=c879ff12-dc14-45ff-8fa9-27303902808d)
- greytHR, 2022-09-27: "Holiday list calendar is not seen" after an update. — [Google Play, greytHR](https://play.google.com/store/apps/details?id=com.greytip.ghress&reviewId=88d97ea6-8856-4d18-bcc4-8ebcfae5bb5a)
- HROne, 2023-10-13, 4★: "Holiday list not available." — [Google Play, HROne](https://play.google.com/store/apps/details?id=com.hrone.android&reviewId=c098ef00-7e7e-431b-88dd-428186059d1a)
- None of these says the *wrong branch's* holidays were applied. They are about the list being absent or stale. I found no complaint of location-specific holiday mix-ups.

**D. Branch and location mapping (2 mentions, excluding GPS)**
- Darwinbox, 2022-04-20, 1★: "only works in mapped branch, can not mark attandance manualy in any branch". This affects staff who move between branches. — [Google Play, Darwinbox](https://play.google.com/store/apps/details?id=com.darwinbox.darwinbox&reviewId=e74131b7-5ee6-4748-be88-70b45b5dada2)
- greytHR, 2022-06-10, 3★: "I have to daily sign in the account and then login for branch." Choosing a branch is an extra daily step. — [Google Play, greytHR](https://play.google.com/store/apps/details?id=com.greytip.ghress&reviewId=f4ee3f9b-ece8-475e-9b50-b4055d138e90)
- Keka, 2026-07-02, 1★: the tech team changed the location setting, but "the location remained unchanged". This is ambiguous: it may be a geofence rather than a work location. — [Google Play, Keka](https://play.google.com/store/apps/details?id=com.keka.xhr&reviewId=8fb7dcd6-637e-46ba-9d6e-72fb264bb4ed)

**E. Departments: filtering, grouping, double maintenance (3 mentions, all 2026 or undated)**
- Paylocity iOS (US), 2026-08-01: a team schedule "filterable by department... has NOT WORKED since the end of June". — [App Store US, Paylocity](https://apps.apple.com/us/app/id652438572)
- Paylocity iOS (US), 2026-10-12, 1★: a manager's "hourly employees are not in the same location as my salary employees". The team is split by pay type rather than by reporting line. — [App Store US, Paylocity](https://apps.apple.com/us/app/id652438572)
- Workday, 2026-09-12, 1★: "Terrible for running reports and filtering reports, & organizing departments" (college institution). — [Google Play, Workday](https://play.google.com/store/apps/details?id=com.workday.workdroidapp&reviewId=3292ab2d-80dc-4bb9-bc5f-fc120791fbf9)
- Zoho Community feature request (undated, signed "Ram"): "managing departments and employees requires maintaining data in both Zoho One and Zoho People". It is "time-consuming and prone to errors". It has no replies. — [Zoho Community](https://help.zoho.com/portal/en/community/topic/automatic-department-and-employee-sync-between-zoho-one-and-zoho-people)
- Zoho People, 2022-09-10, 2★: KRAs can only be tagged "on designation, location or role base", not per employee. — [Google Play, Zoho People](https://play.google.com/store/apps/details?id=com.zoho.people&reviewId=8b94e11f-1114-4148-8ba1-3e81f3d8b7f4)

**F. Org chart: absent on mobile, hard to read (US apps; 4 mentions)**
- BambooHR iOS, 2025-10-01, 4★: a manager can't "see the organization chart for chain of command" in the app. — [App Store US, BambooHR](https://apps.apple.com/us/app/id587244049)
- BambooHR iOS, 2021-04-30 (older): "I can't see my direct reports, comp or job history." — [App Store US, BambooHR](https://apps.apple.com/us/app/id587244049)
- BambooHR iOS, 2017-09-27 (old): "No org chart / No organizational view" for executives. — [App Store US, BambooHR](https://apps.apple.com/us/app/id587244049)
- Rippling iOS, 2025-04-21, 3★: "Please make the orgchart profile picture bigger". The reviewer has to check Slack instead. — [App Store US, Rippling](https://apps.apple.com/us/app/id1231325957)

**G. G2 snippets about standalone org chart tools (search-engine snippets only; pages returned 403; unverified)**
- The Org reviewer: updating the org structure is "a very manual process". They wanted HRIS integration. — [G2, The Org](https://www.g2.com/products/the-org/reviews)
- The Org reviewer: an HR coordinator and a VP who both report to the CHRO are drawn "at the same level". Seniority is lost. — [G2, The Org](https://www.g2.com/products/the-org/reviews)
- OrgChart (HRIS analyst): aligning boxes is "quite time-consuming" for complex hierarchies. — [G2, OrgChart](https://www.g2.com/products/orgchart/reviews?page=2)

### Inferences
- In SMB Indian HRMS, the reporting-manager field acts as a hidden dependency. When it's empty, resignation, claims and confirmation stop with no clear message to the employee. One way to protect against this is to refuse to leave anyone without a manager (fall back to the owner) and to say plainly who an approval will go to before it is submitted.
- Designations get printed onto payslips and letters. Staff notice a wrong designation there, and fixing it is hard after the fact. This points to designation being effective-dated, with documents reading the value as of their own date.
- Holiday complaints are about visibility and staleness (the new year's list not loaded), not about wrong-branch rules. A yearly "next year's holidays not set" prompt for the owner addresses the observed pain.
- Workers who move between branches get blocked by strict branch mapping. That matters for small multi-site businesses.
- Org-chart praise in reviews (see the next section) is about *employees being able to see the hierarchy*, not about admins building it.

### Gaps
- **No Reddit data** (all access routes blocked). Owner and admin voices on restructures, renames, bulk department moves, history lost after a rename, duplicate departments and structure import are **not represented at all**. App-store reviewers are employees and don't do these tasks.
- No Kredily, factoHR, sumHR or Zimyo review mentioned org structure. Their review volume is small (12–462 per app).
- No first-hand Capterra or G2 text could be fetched. Earlier passes hit the same blocks.

## What do Indian users of Keka, greytHR, Zoho People, Darwinbox, HROne, factoHR, Kredily and sumHR say?

### Takeaway
Across about 13,000 Play reviews and about 1,000 India App Store reviews of these vendors, org structure is rarely the subject. Attendance, GPS, login and app speed dominate. The org-structure items that do appear are listed above. greytHR has the most (manager not shown, designation wrong on payslip, branch login step, holiday list), then PeopleStrong and ZingHR (L1 manager), then Darwinbox (branch mapping, organogram wish, HOD approval).

### Cited Findings
- Keka positives: "staff details , hierarchy, personal details everything is at finger tips" (2026-05-02). — [Google Play, Keka](https://play.google.com/store/apps/details?id=com.keka.xhr&reviewId=b8db418b-f34d-44aa-9e76-bfe48c1ffcaf)
- Keka: values seeing "employee hierarchy" alongside leaves and payslips (2025-08-05). — [Google Play, Keka](https://play.google.com/store/apps/details?id=com.keka.xhr&reviewId=91cc7c8c-64a9-47f6-949c-a31c525de8a0)
- Keka, 2024-10-14, 1★: there is no way to raise a department-related complaint "not on web and not mobile". — [Google Play, Keka](https://play.google.com/store/apps/details?id=com.keka.xhr&reviewId=db0bf71c-4a2d-47db-ad48-752192486662)
- HROne iOS, 2024-02-21, 5★: "Bulk approval option is a savior". The same reviewer praised the manager "teams" view. — [App Store India, HROne](https://apps.apple.com/in/app/id6449706899)
- Pocket HRMS, 2021-04-20 (older): "all details or filled incorrect by HR department". This is about employee master data being wrong. — [Google Play, Pocket HRMS](https://play.google.com/store/apps/details?id=com.pockethcm.greytrix.test&reviewId=efb2935c-addc-44f3-bf41-a51a3b2bfd0c)
- greytHR, Darwinbox, PeopleStrong and ZingHR items: see sections A–D above.

### Inferences
- Indian employees treat "who is my manager / what is my designation" as facts they expect to see on their own profile and on documents. When those facts are blank or wrong, the employee can't fix them and has to chase HR.
- The low volume of org complaints from employees suggests the hard part sits on the admin side, which these channels don't capture.

### Gaps
- factoHR's Admin app had 12 reviews, none relevant. Kredily's admin app (215) and employee app (462) had no org-structure hits. sumHR's iOS app had 15 reviews and no hits.
- No Reddit r/developersIndia, r/IndiaBusiness or r/indianstartups data (blocked).

## What do they wish existed?

### Takeaway
Explicit wishes are few: an organogram with designations so new joiners understand the hierarchy, an org chart and direct reports on mobile, a reminder or nudge to the reporting manager for pending approvals, and two-way department sync between suites.

### Cited Findings
- Darwinbox, 2022-03-17, 4★: "add in organogram with names for designation to understand company heirarchy". It was framed as useful for new joiners. — [Google Play, Darwinbox](https://play.google.com/store/apps/details?id=com.darwinbox.darwinbox&reviewId=182b501d-47d6-4a2c-a90b-66a85ddb4f8b)
- Rippling iOS, 2021-11-02 (older): "Would love to access the org chart directly from an employee's profile." — [App Store US, Rippling](https://apps.apple.com/us/app/id1231325957)
- BambooHR iOS, 2025-10-01: wants the org chart and 1:1s in the mobile app. — [App Store US, BambooHR](https://apps.apple.com/us/app/id587244049)
- ZingHR, 2021-07-15: wants "a reminder button which fire a mail to Reporting Manager". — [Google Play, ZingHR](https://play.google.com/store/apps/details?id=com.zinghr.app&reviewId=fce8452a-49b2-4b93-bc85-83411aceb2c1)
- Zoho Community: wants departments synced automatically between Zoho One and Zoho People. — [Zoho Community](https://help.zoho.com/portal/en/community/topic/automatic-department-and-employee-sync-between-zoho-one-and-zoho-people)
- Rippling iOS, multiple 2022 5★ reviews praise the org chart for a new hire "understanding the company org chart" (2022-06-19). Several more say the same (2022-04-14, 2022-08-10, 2022-09-01, 2022-09-28, 2022-12-22). — [App Store US, Rippling](https://apps.apple.com/us/app/id1231325957)

### Inferences
- Employees mainly want the org chart to answer "who is who and who do I report to", especially new joiners. Read-only clarity matters more to them than chart features.
- The ask for a nudge to the reporting manager suggests that pending approvals should be visible to the requester, with the approver's name shown.

### Gaps
- No wishes found for bulk restructure, rename with history, or structure import. These would come from admins, likely on Reddit, G2 or Capterra, all of which were inaccessible in this pass.
