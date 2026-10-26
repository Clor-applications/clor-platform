# User-facing problems with the organization / org-structure area of HR software

Method note (read first): 17 tool calls (WebSearch + WebFetch) on 2026-10-26. Reddit threads did not surface through the search tool (several `site:reddit.com` and Reddit-phrased queries returned none), and Capterra review pages returned HTTP 403 to direct fetch. So the user evidence here is thin: a handful of review snippets, one Zoho community thread, and vendor help/troubleshooting articles. Help articles titled "my reporting manager is wrong" are counted as indirect evidence that users hit the problem often enough to need a doc, not as user complaints. Quotes come through a summarizing fetch layer, so treat them as near-verbatim. No sample sizes exist beyond "1 review" or "1 thread" per item unless stated.

Ranked catalogue, by evidence strength and likely severity for 1–100 employee firms. This is a judgement call, not a measured frequency.

| # | Problem | Severity for SMB | Evidence strength |
|---|---------|------------------|-------------------|
| 1 | Wrong or missing reporting manager makes approvals go to the wrong person and leaves gaps in the org chart | High (blocks leave/expense approvals) | Medium: multiple vendor troubleshooting docs plus 1 Zoho thread |
| 2 | Pending requests stay with the old manager after a manager change | High | Low–medium: 1 vendor doc (Kredily) plus a vendor SOP |
| 3 | Approval routing can't express real small-firm cases (two execs approve each other, owner with no manager, a deputy approver) | High for 1–20 person firms | Low: 1 Zoho thread, no reply visible |
| 4 | Org chart hard to read or navigate | Low–medium | Low: 2 Capterra BambooHR reviews |
| 5 | One department per employee, so split cost can't be shown in payroll | Medium (only for firms that cost by department) | Low: 1 Gusto review from 2019 |
| 6 | Department renames break history and trend reports | Medium | Low: 1 third-party analytics guide |
| 7 | Fields locked by an "HR process" with no clear reason why they can't be edited | Medium (confusing) | Low: Zoho FAQ exists because of it |
| 8 | Setup is heavy and the structure is hard to change later (enterprise HRMS) | High if picked by an SMB; mostly an enterprise issue | Medium: repeated in Darwinbox aggregators |
| 9 | Structure imports need exact column names and one table per sheet | Medium | Low: BambooHR partner import docs (vendor, older) |
| 10 | Static or externally synced org charts go stale, and edits are overwritten by the next sync | Medium | Low: org-chart vendor guides |

## What do users complain about with departments, designations, locations, org charts, reporting lines, department heads, restructures, bulk changes, history, import, and messy lists?

### Takeaway
The most-evidenced pain is the **reporting-manager link**. It drives the org chart and approval routing together, so one wrong or blank value means the wrong approver, a missing chart node, or requests stuck with the old manager. History/rename and import problems show up in weaker evidence. I found no user complaints specifically about designations or duplicate department lists.

### Cited Findings
- **Reporting manager drives the chart, and blanks fall to the top level.** In Zoho Connect, users with no "Reporting To" sit in the first column of the org chart "alongside top-level members" — [Zoho Connect help](https://help.zoho.com/portal/en/kb/connect/user-guide/overview/articles/organization-chart-in-zoho-connect). A third-party glossary says the Zoho People chart is also built from the Reporting Manager field (secondary source) — [Aaxonix](https://aaxonix.com/resources/glossary/organisation-chart-people/).
- **Vendors publish "my manager is wrong" troubleshooting**, which suggests users hit it often: Quikchex "My reporting manager in the org chart is incorrect. How do I update it?" — [Quikchex KB](https://qcknowledgebasehelpdocs.quikchex.in/article/39-my-reporting-manager-in-the-org-chart-is-incorrect-how-do-i-update-it); HRwize "Organizational chart does not show anything or is wrong" — [HRwize KB](https://hrwize.kayako.com/en-us/article/62-organizational-chart-does-not-show-anything-or-is-wrong); Kredily has a directory and reporting-manager support page — [Kredily](https://kredily.com/support/employee/directory-and-reporting-manager.html).
- **Pending requests don't follow a manager change.** Kredily notes requests "already pending may still sit with the previous approver" — [Kredily support](https://kredily.com/support/employee/directory-and-reporting-manager.html).
- **Enterprise-grade versions of the same bug.** In SAP SuccessFactors, a manager could not see an employee as a direct report while the employee saw the manager correctly. In another case, leave went to the wrong manager because the org unit was not flagged as a reporting-line unit — [SAP KB 2334308](https://userapps.support.sap.com/sap/support/knowledge/en/2334308), [SAP KB 1949073](https://userapps.support.sap.com/sap/support/knowledge/en/1949073). This is not SMB evidence, but it shows the failure mode is common across products.
- **Edge cases a reporting tree can't express (Zoho People, user thread, undated).** "Our top two exec approve each others leave requests"; "Zoho will not allow me to mark them as reporting to each other"; a custom approval rule was "not routing the leave requests to that person". No reply was visible — [Zoho community thread](https://help.zoho.com/portal/en/community/topic/need-leave-approvals-to-go-to-someone-other-than-reporting-to-department?page=14).
- **Covering approvals while a manager is away** is asked about in the Zoho community, and the answer given is delegation — [Zoho "Leave approvals" thread](https://help.zoho.com/portal/en/community/topic/leave-approvals); [Delegation thread](https://help.zoho.com/portal/ar/community/topic/delegation-option-for-approval?page=50).
- **Locked department/location/manager fields confuse admins.** Zoho's FAQ explains that a lock icon means "an HR process has been configured to control changes", so the field can't be edited directly — [Zoho People FAQ](https://help.zoho.com/portal/en/kb/people/faq/general-account-faq/articles/faq-zoho-people).
- **Org chart readability (BambooHR, Capterra).** One reviewer: "org chart representation could be better, it is a mess". Another wanted to step back to the previous person instead of resetting to the full chart. A third praised the chart for building itself from records — [Capterra BambooHR p.6](https://www.capterra.com/p/110968/BambooHR/reviews/?page=6), [Capterra p.35](https://www.capterra.com/p/110968/BambooHR/reviews/?page=35), [SoftwareFinder](https://softwarefinder.com/hr/bamboohr/reviews?page=3). Dates were not visible.
- **Renames break history.** A data-cleaning vendor says BambooHR "Department names change over time but historical records are not retroactively updated", which breaks trend analysis. It suggests a mapping table with effective dates (vendor-adjacent source) — [dataclean.to](https://dataclean.to/use-cases/clean-bamboohr-for-analytics).
- **Effective-dated job rows are hidden by default.** BambooHR's API returns only currently effective job rows unless asked for future-dated ones. This is a design fact, not a complaint, but it explains future-dated moves people "can't see" — [BambooHR API](https://documentation.bamboohr.com/reference/get-employee).
- **Import friction.** BambooHR import guidance asks for "only 1 table per spreadsheet" with headers matching field names exactly (partner doc, probably about 2015, so **older**) — [BambooHR partner import doc](https://partners.bamboohr.com/wp-content/uploads/2015/04/New-Import-Documentation.doc).
- **Charts outside the HRIS go stale, and edits there get overwritten.** Windmill tells users to "Fix it in your HRIS"; the next sync overwrites local edits — [Windmill docs](https://help.gowindmill.com/org-chart/managing-your-org-chart.md). Org-chart vendors say a chart "can quickly become inaccurate" without automatic updates (vendor marketing) — [theorgchart.com](https://theorgchart.com/solutions/automated-charts/).
- **Restructures need a downstream check.** A process SOP template tells admins to review "inherited approvals" after any reporting-line change (vendor template, not user evidence) — [MangoApps SOP](https://www.mangoapps.com/templates/sop/position-management-and-org-chart-maintenance-sop).

### Inferences
- For a 1–100 person firm, the manager field matters most in the org module. It needs a validation step (no blanks except the owner, no cycles), a "who approves for this person" preview, and a prompt on manager change to move pending requests.
- Approval routing needs an explicit override, such as a named approver or "owner approves own" for the top person, because a pure tree can't model two co-founders approving each other.
- Renames should keep the same record ID so history and reports still join after a rename. A merge should be an explicit action that re-points employees and keeps an audit entry.
- Org chart complaints are about readability and navigation, not missing features. A simple, navigable tree is enough.

### Gaps
- No Reddit evidence (r/humanresources, r/smallbusiness, r/IndiaBusiness, r/developersIndia, r/sysadmin). The search tool did not return Reddit threads. A direct Reddit search is needed.
- No user complaints found specifically about designations, duplicate or messy department lists, bulk structure changes, or merge flows. That doesn't prove they're rare; review sites only expose snippets.
- Capterra blocked direct fetch (403), so I couldn't filter reviews by keyword. G2, TrustRadius, GetApp and app-store reviews were not mined.

## What do small businesses actually use vs ignore (positions, grades, cost centres, business units)?

### Takeaway
I found no direct user evidence. Indirect signs: SMB-focused tools (Gusto) offer only a flat "departments" feature, used mostly for payroll reporting and accounting mapping. Multi-entity, cost-centre and position modelling show up in enterprise products (Keka filters, Darwinbox), where setup weight is a common complaint.

### Cited Findings
- Gusto's departments exist to "organize team members, group reports by team, and map payroll transactions" to accounting — [Gusto support](https://support.gusto.com/article/100011863100000/Set-up-and-manage-departments).
- Keka's reporting-manager report requires a Business Function and filters by Department, Location, Cost Center and Legal Entity, so all of these dimensions are present in a mid-market Indian HRMS (vendor doc) — [Keka help](https://help.keka.com/admin/knowledge/where-can-we-get-a-report-of-employees-and-their-reporting-managers).
- Darwinbox setup is described as complicated, with little flexibility to change processes later. An aggregator says complex multi-entity setups need configuration effort and vendor services — [SelectHub](https://www.selecthub.com/p/hr-management-software/darwinbox/), [RFP.wiki](https://www.rfp.wiki/hr-office/cloud-hcm-suites-for-1-000-employee-enterprises/darwinbox), [G2 Darwinbox](https://www.g2.com/products/darwinbox/reviews).
- A Zoho People reviewer reports a learning curve configuring "permissions, forms, workflows, and access controls" (via aggregator) — [G2 Zoho People](https://www.g2.com/products/zoho-people/reviews), [HRStacks](https://www.hrstacks.com/product/zoho-people/).

### Inferences
- A small business likely needs departments, locations/branches, designations and a manager for each person. Grades, positions (seats separate from people), business units and cost centres are enterprise concepts. Keep them hidden or leave them out by default; each one adds a required field and setup time.
- A required "Business Function" style field (as in Keka's report filter) is the kind of mandatory dimension that adds friction for tiny firms.

### Gaps
- No survey or usage data on which org fields SMBs fill in. Vendor product analytics on this are not public.

## Where do org-structure mistakes cause downstream problems?

### Takeaway
The best-evidenced downstream impact is **approval routing**: leave and expense requests go to the wrong or old approver. Second is **payroll and cost reporting by department**: one department per person, and renames break history. Third is **access scoped by department or location**. I found no evidence on holidays by location.

### Cited Findings
- Approval steps in Zoho People can target Reporting To, Department Lead, Department Head, Role, and others, up to 10 levels. So a wrong department or department head silently changes who approves — [Zoho People approvals help](https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/approvals-overview-use-cases).
- Pending requests stay with the previous approver after a manager change — [Kredily](https://kredily.com/support/employee/directory-and-reporting-manager.html).
- SAP case: leave routed to the wrong manager because of an org-unit flag (enterprise) — [SAP KB 1949073](https://userapps.support.sap.com/sap/support/knowledge/en/1949073).
- Gusto (2019, **older**): a single employee "can only be assigned to one department", so split time can't be shown in payroll costs — [Capterra Gusto reviews](https://www.capterra.com/p/131882/Gusto/reviews/?page=75). The current behaviour wasn't verified.
- Rippling scopes custom admin roles by employee group, "by department, location, employment type". A wrong department therefore changes who can see or approve whom (third-party guide) — [Stitchflow](https://www.stitchflow.com/user-management/rippling/manual).
- An HROne-authored review says greytHR managers can't mark leave for their direct reports. This is a **competitor source**; treat it with caution — [HROne blog](https://hrone.cloud/blog/greythr-review-india/).

### Inferences
- In a single-owner business, routing to the "wrong manager" often means routing to nobody, or back to the requester. The owner as default approver is a safe fallback.
- If CLOR posts payroll to accounting by department, renames must not break the link, and the department on a past payslip should be the one in effect on that date.

### Gaps
- No evidence on holiday calendars by location going wrong after a branch move, or on statutory problems (PT/LWF state) caused by a wrong location. Both are plausible for India but uncited.

## Specific complaints about Indian HRMS (Zoho People, Keka, greytHR, Darwinbox, factoHR, HROne) and global SMB tools (BambooHR, Gusto, Rippling, HiBob)

### Takeaway
I found org-specific complaints only for Zoho People (approval routing, locked fields), BambooHR (chart readability, rename history), Gusto (one department per person) and Darwinbox (heavy, rigid setup). For Keka, greytHR, factoHR, HROne, HiBob and Rippling, the general reviews found don't single out org structure. Rippling's org charting is rated well (9.8 on TrustRadius, 60 ratings).

### Cited Findings
- **Zoho People:** mutual exec approvals impossible, and custom approver not applied — [thread](https://help.zoho.com/portal/en/community/topic/need-leave-approvals-to-go-to-someone-other-than-reporting-to-department?page=14); locked department/location/manager fields — [FAQ](https://help.zoho.com/portal/en/kb/people/faq/general-account-faq/articles/faq-zoho-people); limited report customization (aggregator) — [HRStacks](https://www.hrstacks.com/product/zoho-people/).
- **Keka:** no org-structure complaints found. The search returned only vendor help pages — [Keka help](https://help.keka.com/admin/knowledge/where-can-we-get-a-report-of-employees-and-their-reporting-managers).
- **greytHR:** general complaints about app freezes and slow approvals, none org-specific — [Techjockey](https://www.techjockey.com/reviews/greythr); manager-on-behalf leave gap (competitor source) — [HROne blog](https://hrone.cloud/blog/greythr-review-india/).
- **Darwinbox:** complicated setup and rigidity after configuration — [SelectHub](https://www.selecthub.com/p/hr-management-software/darwinbox/), [RFP.wiki](https://www.rfp.wiki/hr-office/cloud-hcm-suites-for-1-000-employee-enterprises/darwinbox).
- **factoHR / HROne:** no independent evidence found. HROne's multi-entity claims are vendor marketing — [HROne blog](https://hrone.cloud/blog/switching-from-darwinbox-india/).
- **BambooHR:** org chart "a mess", wants back-navigation — [Capterra](https://www.capterra.com/p/110968/BambooHR/reviews/?page=6); rename history breaks trends — [dataclean.to](https://dataclean.to/use-cases/clean-bamboohr-for-analytics); a European reviewer calls the product US-centric — [SoftwareFinder](https://softwarefinder.com/hr/bamboohr/reviews?page=5).
- **Gusto:** one department per employee (2019) — [Capterra](https://www.capterra.com/p/131882/Gusto/reviews/?page=75).
- **Rippling / HiBob:** org charting scores 9.8 (Rippling, TrustRadius, 60 ratings); HiBob's org chart and directory are praised; HiBob profile data "feels a bit buried" — [TrustRadius compare](https://www.trustradius.com/compare-products/hibob-vs-rippling), [Capterra compare](https://www.capterra.com/compare/156106-172127/Hibob-vs-Rippling). Comparison pages run by either vendor are biased.

### Inferences
- Across vendors, the gap between products is not chart rendering. It is how well the structure feeds approvals and handles change over time (moves, renames, effective dates).

### Gaps
- Not covered: Google Play / App Store reviews of Keka, greytHR, Zoho People and Darwinbox; the Keka community forum; Reddit. These are the most likely places for raw SMB complaints and should be checked by hand or with a browser-capable agent.
