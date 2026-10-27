# Indian HRMS competitors: how the organization / org-structure area is handled

Scope: Zoho People, Keka, greytHR, Darwinbox, factoHR, HROne, plus sumHR and Kredily as small-business reference points. Researched 2026-10-26. Lens: Indian small businesses with 1 to 100 employees.

Source-quality legend used below: **[DOC]** = the vendor's help center or knowledge base. **[SNIPPET]** = a vendor help article seen only through a search-engine summary because the page was blocked (Keka's help.keka.com returned HTTP 403 or a login wall to direct fetches). **[MKT]** = a vendor marketing page. **[3P]** = a third party (reviews, resellers, API directories, competitor blogs).

Coverage warning: Zoho People, Keka and greytHR have usable public documentation. Darwinbox, factoHR and HROne keep their help centers behind a customer login, or I could not find them publicly. For those three vendors, nearly everything below is marketing or third-party material. Treat them as under-documented, not as missing these features.

---

## 1. Which organization objects exist, what they are called, and whether they nest

### Takeaway
Every vendor has the basic trio of department, designation and location. The higher layers differ:
- **Keka** has a fixed four-layer model: legal entity > business unit > department (with sub-departments) and location. It also has pay grades and pay bands.
- **Zoho People** keeps departments, which can have a parent department, separate from an optional "Organization Structure" of legal entity > business unit > division that you switch on and can rename.
- **greytHR** has no separate structure model. Department, designation, grade, location and the rest are all "Employee Categories" (flat attributes attached to each employee), and admins can add as many categories as they like.

No publicly documented product for small businesses offers true position management (seats that can be vacant). That appears to be enterprise-only, in Darwinbox at least, according to API listings.

### Cited Findings
**Zoho People [DOC]**
- Departments are created under Settings > Organization > Department > Add Department. The form has fields for Department name, Mail Alias, Department Lead (a dropdown) and an optional **Parent Department**, so departments can nest. Edit and delete icons sit next to each department. — [Zoho People Organization Settings](https://www.zoho.com/people/help/adminguide/orgsettings.html)
- Users in the community report that Mail Alias is mandatory and was confusing. It is meant to be a distribution-list address set up in mail admin. — [Zoho community: Adding Departments](https://help.zoho.com/portal/en/community/topic/adding-departments)
- Designations (examples given: CEO, CFO, Training Head) and Locations are also under Settings > Organization. **"Streams"** group related designations under one name. Roles, which control data access, are separate, under Settings > User Access Control > Roles. — [Zoho People Organization Settings](https://www.zoho.com/people/help/adminguide/orgsettings.html); [Settings in Zoho People 5.0](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/overview/articles/new-settings)
- The optional Organization Structure must first be enabled at "Settings > Manage Accounts > Organization Setup > Organization Structure > Configuration". Its hierarchy is **Legal Entity > Business Unit > Division**, and each component can be renamed (for example, "Legal entity" to "Company"). Entities are defined in their own tabs and then arranged in a "Manage Structure" tab. — [Zoho People: Organization Structure](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/organization-structure-zoho-people)
- "Departments cannot be tagged to organization structure entities". Departments are assigned to employees separately. Reporting managers can belong to a different entity, and request approvers do not depend on entity. "Multi-organization" is a separate option for fully independent companies with separate accounts and URLs. — [Zoho People: Organization Structure](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/organization-structure-zoho-people)
- The API exposes a `parent_division` field, so divisions can also nest. — [Zoho People API: Get Organization Structure](https://www.zoho.com/people/api/v3/orgstructure/single-record.html)

**Keka [SNIPPET] / [DOC]**
- The org structure has these layers: **Legal Entity** (a registered company; several entities can share one subscription, each with its own payslip and offer-letter branding), **Business Unit** (inside a legal entity; it can be split by "location, vertical, operation, product lines"), **Department** (functional teams inside a business unit) and **Location** (physical sites). — [Keka: What is an organization structure?](https://help.keka.com/hc/en-us/articles/39946699284625); [Keka: Legal Entities](https://help.keka.com/hc/en-us/articles/39946713769617-Adding-and-modifying-legal-entities); [Keka: Business Units](https://help.keka.com/hc/en-us/articles/39946741874961-Adding-and-modifying-Business-Units)
- Adding a legal entity asks for the country (which sets the currency), the legal name, a company identification number and an address. — [Keka support: add new legal entity](https://support.keka.com/support/solutions/articles/84000383000-how-to-add-a-new-legal-entity-on-keka-)
- **Sub-departments** are supported, with examples such as Channel Sales and Inside Sales under Sales. You open a department and click Add. — [Keka: What are Departments?](https://help.keka.com/hc/en-us/articles/39946718212881-Adding-and-modifying-departments)
- **Pay Grades** are maintained under Org > Org Structure > Pay Grades, each with a name and description, and can be edited or deleted. Pay band, pay grade and job title are all fields on an employee's job details. — [Keka: Adding and editing Pay Grades](https://help.keka.com/admin/adding-and-editing-pay-grades); [Keka release notes: Future Effective Dates for Bulk Job Changes](https://help.keka.com/hc/en-us/articles/50139600428817-Release-Notes-Future-Effective-Dates-for-Bulk-Employee-Job-Changes)
- The menu path differs by help version. Older articles say Keka Setup > Core HR Setup > Organisation Setup. Newer ones say Org > Org Structure tab. — [Keka: Organization & Employees](https://help.keka.com/admin/setting-up-the-organizational-structure); [Keka support (older)](https://support.keka.com/support/solutions/articles/84000382493-setting-up-the-organizational-structure)

**greytHR [DOC]**
- Department, designation, location, grade and the rest are all **Employee Categories**, configured on the Employee Position page. Settings > System Settings > Employee > Category Group controls which categories appear and lets admins add "any number of categories". greytHR's own help warns: "We recommend you to contact the greytHR support team before making any changes in settings." — [greytHR: Set Up Employee Categories](https://www.greythr.com/help-admin/employee-settings/setup-employee-categories-guide/); [greytHR Help: Category Group](https://admin-help.greythr.com/admin/answers/KV9heDtzRFKjindvFuShQQ)
- The directory configuration lists the Designation, Department, Grade and Location categories. — [greytHR: Configure Employee Directory](https://www.greythr.com/help-admin/employee-settings/configure-employee-details-directory/)
- If a category value (for example Designation or Job Category) is linked to an active job in Recruit, it cannot be modified or deleted. — [greytHR: Employee Categories in Recruit](https://www.greythr.com/help-admin/recruit/employee-categories-job-fields/)
- I found no greytHR documentation on department nesting or a legal-entity or business-unit layer.

**Darwinbox [3P] / [MKT]**
- A third-party API directory lists Darwinbox endpoints for **Cost Center master**, **Business Unit master** and **Position master** (create and update), grouped under "Organizational Management". This is the only evidence I found of true position objects among these vendors. — [Knit: Darwinbox API Directory](https://getknit.dev/blog/darwinbox-api-directory-QrXQRZ)
- G2 lists "Organization Management", which "organizes employees in an org structure that can be used throughout the application for reporting, permissions", plus position descriptions and pay grades. — [G2: Darwinbox features](https://g2.com/products/darwinbox/features)
- The marketing pages mention "organizational hierarchies" and governance "across regions or business units", and say hierarchies are configured during implementation. — [Darwinbox LP](https://explore.darwinbox.com/lp/end-to-end-hr-management-software-en); [Darwinbox Core HR](https://darwinbox.com/en-us/products/core-hr)

**HROne [MKT]**
- Multiple entities can be run "from a single instance". An "OU mapping engine" sets policies by "grade, enterprise, department, role, and more". The page says nothing about branch, business unit, designation, cost centre or positions. — [HROne Core HR](https://hrone.cloud/hr-software/core-hr/)

**factoHR**
- I found no factoHR help documentation on org objects. Its public pages include only glossary content on org charts and job titles. — [factoHR: Organizational Charts](https://factohr.com/organizational-charts/); [factoHR glossary: Job Title](https://factohr.com/hr-glossary/job-title/)

**sumHR [DOC, titles only]**
- The "Company structure" help category has articles on Designation, **Teams**, Department, Company office locations ("reporting office"), **Business Unit** (with a "what's their use" explainer) and **Grades**. — [sumHR Support: Company data](https://sumhr.helpscoutdocs.com/category/148-company-data)

**Kredily (free Indian HRMS, extra reference) [DOC]**
- Departments can have sub-departments. The import file has columns for Department, Sub Department and **Department Head**. Designations have an inner Grades tab. A department or designation **cannot be deleted while employees are assigned** to it. — [Kredily: Departments, Designations, Grades](https://kredily.com/support/company/departments-designations-grades.html); [Kredily: Designation settings](https://support.kredily.com/docs/admin-help/company-profile-setup-guide/designation-settings/)

### Inferences
- In Indian small-business products, the shared vocabulary is **Department, Designation, Location/Branch and Grade**. "Business Unit" and "Legal Entity" show up when a product targets groups with several companies (Keka, Zoho's optional structure, HROne's multi-entity setup). "Position" (a seat that exists independently of the person) appears only at enterprise level (Darwinbox).
- In practice, "designation" is the Indian word for job title. Zoho's "Streams" and greytHR's "Job Category" are ways to group designations.
- greytHR's model of open-ended categories is very flexible but gives no structure or hierarchy. Keka's fixed layering is opinionated and easy to explain.
- Zoho keeping departments outside its entity hierarchy shows a modelling choice: department is functional and legal entity is statutory, and the two are kept orthogonal.

### Gaps
- Cost centres: documented as a master only for Darwinbox (through a third-party API listing). I found no public documentation on cost centres for Zoho, Keka, greytHR, factoHR or HROne.
- greytHR: no information found on department nesting or a business-unit or legal-entity layer.
- Pocket HRMS was not researched because no time was left.

---

## 2. Department heads and location heads: descriptive, or do they grant approval rights?

### Takeaway
Zoho ("Department Lead"), Keka ("Department Head") and Kredily ("Department Head") all have a department-head field. None of the public documentation I found says the head automatically gets approval rights. Approvals in these products follow the reporting manager or role-based workflow rules. I found no location heads documented anywhere.

### Cited Findings
- **Zoho:** Department Lead is a dropdown on the department form. — [Zoho People Organization Settings](https://www.zoho.com/people/help/adminguide/orgsettings.html). Request approvers "are independent of the employee's entity, division, or company". — [Zoho People: Organization Structure](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/organization-structure-zoho-people)
- **Keka:** Org > Org Structure > Department tab > pick a department > Summary > Department Head field (search for an employee; there is a remove icon). You can optionally add a department group email. — [Keka: How to add/edit department heads](https://help.keka.com/hc/en-us/articles/39946585579409-How-to-add-edit-department-heads); [Keka admin: assign department head](https://help.keka.com/admin/knowledge/how-to-assign-department-head)
- **HROne:** policies and rights are mapped by grade, department and role, for example a G5 request needs manager approval while a G1 request is auto-approved. This is rule-based, not tied to a head. — [HROne blog: permissions](https://hrone.cloud/blog/hr-software-permissions-simplifiication/) [MKT]
- **Kredily:** Department Head is a column in the department import. — [Kredily: Departments, Designations, Grades](https://kredily.com/support/company/departments-designations-grades.html)

### Inferences
- Across these products the department head appears to be **descriptive metadata** (for the directory, org views and group email), not an approval node. Approvals use reporting-manager chains plus workflow rules keyed on department, grade or role. Several workflow engines (Keka especially) let you choose a role such as "Department Head" as an approver step, which would make the head operational. I could not verify this publicly, so it is unconfirmed.

### Gaps
- Whether Keka's or Zoho's approval-workflow builders offer "Department Head" as an approver type was not confirmed, because the help pages were blocked or not found.
- I found no documentation on location or branch heads for any vendor.

---

## 3. Org chart: reporting-line or department view, search, export, large organizations

### Takeaway
The org chart is a **reporting-line tree** everywhere. greytHR's is the best documented and the most "operational": you can search, drag and drop to reassign managers, run a Mass Transfer of reportees, view a per-card changelog and export to PDF or PNG. Zoho's tree can be filtered by entity. HROne says its chart can be downloaded. I found no documented department-view org chart for any vendor. Keka shows department-wise headcount instead.

### Cited Findings
- **greytHR [DOC, "Updated in April - 2026"]:** the path is Employee > Main > Organization Chart. It is a flow chart that shows departments, job titles and reporting lines. You can search by employee number or name. Resigned employees appear only if they still have reportees. The kebab menu on a card offers View Changelog and Add Reportee(s). Other actions: Assign Top Level Manager (more than one is allowed), **Mass Transfer** (pick the old manager, tick the reportees, pick the new manager), Assign Manager, or drag one card under another. **Export as PDF or PNG.** The employee view (ESS) is an opt-in "New Feature". The article mentions no effective dates. — [greytHR: Organization Chart](https://www.greythr.com/help-admin/core-hr/organization-chart-manager-assignment/)
- **Zoho [DOC]:** "The organization tree can be filtered and viewed by selected entities". — [Zoho People: Organization Structure](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/organization-structure-zoho-people). I found no documented org-chart export in Zoho People. A community thread discusses getting the org tree or subordinates through the API as a workaround. — [Zoho community: Organization Tree API](https://help.zoho.com/portal/en/community/topic/zoho-people-api-organization-tree)
- **Keka [SNIPPET]:** a department-wise headcount view exists. — [Keka: department-wise headcount](https://help.keka.com/hc/en-us/articles/39946572196113-How-to-view-department-wise-headcount). I found no public org-chart article.
- **HROne [MKT]:** users can view the full organization chart and download it. — [HROne Core HR](https://hrone.cloud/hr-software/core-hr/)
- **Darwinbox [3P]:** an integration partner pulls Darwinbox's org chart and reporting relationships and says restructures "sync automatically". — [Confirm: Darwinbox integration](https://www.confirm.com/integrations/darwinbox)
- **Frappe HR (Indian open source, for comparison) [DOC]:** the chart is built from the "Reports To" field, and each node shows name, photo and designation. — [Frappe HR: Organizational Chart](https://docs.frappe.io/hr/organizational-chart)

### Inferences
- Among Indian small-business products, the org chart is the place where people edit reporting lines (greytHR), not only a viewer. A department-tree chart (departments as nodes) does not appear to be a standard feature, so there is room to differentiate.
- greytHR handles large organizations with search, collapsible cards and multiple top-level managers. I found no documented rendering limits.

### Gaps
- Org-chart behaviour for large organizations (lazy loading, depth limits) is not documented for any vendor.
- Keka's and factoHR's org-chart features were not verified.

---

## 4. Restructuring: rename, merge, deactivate, bulk moves, effective dating, history

### Takeaway
Keka has the strongest documented restructuring tool. Its bulk Employee Job Details Import accepts **future effective dates**, and department, location, reporting manager, pay band, pay grade and job title are applied automatically on that date. greytHR keeps **effective-from and effective-to Position History** per category, and its org-chart Mass Transfer handles reporting-line moves. No vendor documents a "merge departments" action. Kredily blocks deleting a department while it still has people in it. Zoho shows only edit and delete icons, with no documented guardrails.

### Cited Findings
- **Keka [SNIPPET]:** a release note adds future effective dates for bulk job changes through the Employee Job Details Import. The supported fields are department, location, reporting manager, pay band, pay grade and job title, and they apply automatically on the effective date. — [Keka release notes](https://help.keka.com/hc/en-us/articles/50139600428817-Release-Notes-Future-Effective-Dates-for-Bulk-Employee-Job-Changes)
- **Keka:** moving an employee to another pay group needs an effective date. Future-dated salary revisions are deleted by the move and must be set up again. A move between legal entities produces **two Form 16s**. — [Keka: Viewing and managing employee pay groups](https://help.keka.com/admin/viewing-and-managing-employee-pay-groups); [Keka support (older)](https://support.keka.com/support/solutions/articles/84000382340-viewing-and-managing-employee-pay-groups)
- **Keka:** when a performance-review promotion is finalised, the employee's Job tab is updated with the new designation or grade. — [Keka: PERFORM salary revisions & promotions](https://help.keka.com/hc/en-us/articles/39946861817489-PERFORM-Automate-Salary-Revisions-Promotions-from-Performance-Reviews)
- **greytHR [DOC]:** on the Position History page, an admin adds a detail card with a category (designation, department, grade, location) and **effective-from and effective-to dates**. — [greytHR: Add/edit position history](https://admin-help.greythr.com/admin/answers/121730636/)
- **greytHR:** Mass Transfer moves reportees between managers (no effective date). — [greytHR: Organization Chart](https://www.greythr.com/help-admin/core-hr/organization-chart-manager-assignment/)
- **Zoho:** departments have edit and delete icons. — [Zoho People Organization Settings](https://www.zoho.com/people/help/adminguide/orgsettings.html). Bulk re-tagging of entities is done by importing employee information (ellipsis icon on the employee tab). — [Zoho People: Organization Structure](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/organization-structure-zoho-people)
- **Kredily:** you cannot delete a department or designation while employees are assigned to it. — [Kredily](https://kredily.com/support/company/departments-designations-grades.html)
- **greytHR:** category values linked to active Recruit jobs cannot be edited or deleted. — [greytHR Recruit categories](https://www.greythr.com/help-admin/recruit/employee-categories-job-fields/)

### Inferences
- The common pattern is that restructuring is done **as employee job changes** (bulk import or transfer), not by editing the structure itself. Renaming a department in place changes the label for everyone, including history. None of the documentation says whether historical reports show the old name or the new one.
- "Block delete while people are assigned" is the usual guardrail. "Deactivate or retire" a department with people in it is not documented anywhere I looked.

### Gaps
- No vendor documents a department merge. Whether a department can be retired or deactivated (as opposed to deleted) is undocumented for Zoho, Keka and greytHR.
- How a rename affects historical reports is undocumented for all vendors.
- Zoho's behaviour on deleting a department that still has employees is not documented.

---

## 5. Change history, audit, Excel import and data quality

### Takeaway
greytHR has a per-employee **changelog** that you can open from the org chart, plus dated Position History. Keka and Zoho support **bulk import** of job and entity data. HROne advertises an audit trail, but it covers **policy** changes. I found no vendor that documents an audit log of edits to the structure itself (who renamed or created a department), or data-quality checks such as duplicate names, missing managers or empty departments.

### Cited Findings
- greytHR: View Changelog on each org-chart card. — [greytHR: Organization Chart](https://www.greythr.com/help-admin/core-hr/organization-chart-manager-assignment/)
- greytHR: Position History with effective dates. — [greytHR Position History](https://admin-help.greythr.com/admin/answers/121730636/)
- HROne: the audit trail gives "real-time tracking of all changes made to any policy". Bulk import "syncs across all modules". — [HROne Core HR](https://hrone.cloud/hr-software/core-hr/) [MKT]
- Keka: bulk Employee Job Details Import, with effective dates. — [Keka release notes](https://help.keka.com/hc/en-us/articles/50139600428817-Release-Notes-Future-Effective-Dates-for-Bulk-Employee-Job-Changes)
- Zoho: import employee information to bulk-tag entities. — [Zoho People: Organization Structure](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/organization-structure-zoho-people)
- Kredily: department import template with Department, Sub Department and Department Head columns. — [Kredily](https://kredily.com/support/company/departments-designations-grades.html)

### Inferences
- History is tracked **per employee** (who moved where and when), not **per structure object** (when this department was created, renamed or had its head changed). An audit trail at the structure level, plus data-quality warnings (no head, no people, nobody without a manager), looks like an open gap in the Indian small-business market.

### Gaps
- I found no documentation from any vendor on structure-level audit logs or data-quality checks.

---

## 6. How setup is presented to a small company

### Takeaway
All the documented products present org setup as **settings masters** that an admin fills in (Settings > Organization in Zoho, Org > Org Structure in Keka, System Settings > Category Group in greytHR). Advanced layers are switched on as optional features (Zoho's Organization Structure must be enabled, greytHR's Org Chart ESS is a "New Feature" toggle). I found no documented step-by-step wizard. Darwinbox configures hierarchies during implementation.

### Cited Findings
- Zoho: Organization Structure is off until enabled, and its labels can be renamed. — [Zoho People: Organization Structure](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/organization-structure-zoho-people). Zoho publishes a setup guide PDF. — [Zoho People setup guide](https://zoho.com/sites/zweb/images/people/zp-setup-guide.pdf) (not reviewed in detail)
- Keka: you must create a legal entity first, then "Add Organization's Structure" and choose single or multiple business units. — [Keka: Organization & Employees](https://help.keka.com/admin/setting-up-the-organizational-structure) [SNIPPET]
- greytHR advises contacting support before changing category settings, which suggests the setup is partly done by greytHR's own team. — [greytHR Help: Category Group](https://admin-help.greythr.com/admin/answers/KV9heDtzRFKjindvFuShQQ)
- Darwinbox: hierarchy configuration is part of the implementation. — [Darwinbox LP](https://explore.darwinbox.com/lp/end-to-end-hr-management-software-en) [MKT]

### Inferences
- Keka requires a legal entity and business unit up front even for a single-company small business, which is extra ceremony for a team of 10. Zoho's approach (departments always available, entity hierarchy opt-in) fits a small business better.

### Gaps
- Onboarding wizards and default seeded departments or designations were not verified for any vendor.

---

## 7. Pricing tiers where org features are gated

### Takeaway
I found no public source that ties org-structure features (business units, positions, multi-entity) to a specific plan for any vendor. Published pricing is inconsistent and often hidden behind "contact sales".

### Cited Findings
- Zoho People (India) tiers are Essential HR, Professional, Premium, Enterprise and People Plus, at about ₹48, ₹96, ₹144 and ₹192 per user per month (annual billing, excluding GST). Above roughly 500 users the price is by quote. This comes from a **competitor's** page. — [HROne on Zoho pricing](https://hrone.cloud/?p=56304) [3P]. A reseller lists ₹50, ₹100, ₹165 and ₹230, plus a free plan for 5 employees. — [ITforSME](https://itforsme.in/pricing/zoho-people-india) [3P]
- Keka's plans are Foundation, Strength and Growth, all "contact sales" as of 2026-10-12. — [PulseSignal](https://getpulsesignal.com/compare/keka-vs-leena) [3P]. Older figures: ₹6,999, ₹9,999 and ₹13,999 per month for up to 100 employees (page updated September 2024, possibly stale). — [ZoftwareHub](https://zoftwarehub.com/en-ae/products/keka/pricing) [3P]. Foundation includes Core HR. — [ToolRadar](https://toolradar.com/tools/keka/calculator) [3P]

### Inferences
- Core org objects (department, designation, location) are in the base Core HR tier everywhere. Multi-entity and position management are probably higher-tier or enterprise features, but this is unconfirmed.

### Gaps
- I found no source showing which Zoho plan includes Organization Structure (legal entity, business unit, division).
- Pricing pages for greytHR, factoHR, HROne and Darwinbox were not reviewed. Darwinbox is quote-only enterprise software.
