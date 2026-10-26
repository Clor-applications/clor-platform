# Global SMB HRIS: how the organization / org-structure area works (BambooHR, Gusto, Rippling, HiBob, Deel HR, Sage HR, Freshteam, Personio, Factorial)

Research date: 2026-10-26. Lens: 1–100 employee companies.

**Method note (read first).** Many vendor help centers block automated fetching (Gusto, HiBob, Deel and Personio all returned HTTP 403; BambooHR's help site sits behind a login; Rippling's help center did not come up in search at all). Where a page could not be opened, findings come from the search engine's summary of that exact help-center URL. These are marked "(help-center summary)". Treat them as documented behaviour, but with lower confidence than a page that was read in full. Pages read in full are marked "(read)". Third-party or marketing sources are marked as such. Personio and Factorial had the richest readable documentation.

---

## 1. Which organization objects exist, what they are called, and which are fixed vs custom

### Takeaway
Every product ships the same small core: **department** (always), **location / workplace / site**, **job title**, and **manager (reports-to)**. A **legal entity** layer appears once multi-country or multi-company matters (Personio, Factorial, Deel, Rippling). **Teams**, **divisions**, **levels**, **cost centres** and **positions** are add-ons that come with higher tiers or larger-company products. Department is the only object every vendor treats as mandatory or built in. Personio says this outright: departments are required and teams are only for matrix companies.

### Cited Findings
**BambooHR**
- The Job Information table carries Date (effective date), Location, Division, Department, Job Title and Reports To. — [Prismatic BambooHR component docs (third-party)](https://www.prismatic.io/docs/components/bamboohr/); [withone.ai API knowledge (third-party)](https://www.withone.ai/knowledge/bamboo-hr/conn_mod_def%3A%3AGMSIaKF72wA%3A%3AisOAZkVITR-7lr__jmr7Fw)
- Department, division and location values must already exist in BambooHR's list for that field. You cannot create them by writing a new value through the API. — [Paragon ActionKit BambooHR docs (third-party)](https://docs.useparagon.com/actionkit/integrations/bamboohr/BAMBOO_HR_UPDATE_EMPLOYEE)
- BambooHR's official API changelog has an entry dated 2 April 2026 that adds endpoints to create, update, list, get and delete job **locations**. This makes location a managed object, not just a list value. — [BambooHR API: Historical changes (official, help-center summary)](https://documentation.bamboohr.com/docs/past-changes-to-the-api)
- Admins edit list fields such as job title and department under "Company field settings". Custom fields can be added "by going through the Employee Profile or Settings", with types including dropdown, date and checkbox, set as required or optional. Custom tables come as "standard" or "historical" (historical = "Track data over time"). Job levels and pay bands are configurable. — [BambooHR "100+ Ways to Customize BambooHR" (official marketing guide, read)](https://www.bamboohr.com/resources/guides/100-ways-to-customize-bamboohr)
- Division, Department and Location are the built-in routing keys for "Advanced approvals". — [same guide (read)](https://www.bamboohr.com/resources/guides/100-ways-to-customize-bamboohr)

**Gusto**
- Departments are an optional feature that must be turned on ("Enable the departments feature"). Each person can be in **only one department at a time**. Gusto says: "If an hourly employee works in multiple roles, assign multiple job titles or pay rates instead." — [Gusto: Set up and manage departments (help-center summary)](https://support.gusto.com/article/100011863100000/Set-up-and-manage-departments)
- Departments are used to group people, to report payroll and benefits by team, and to map payroll to departments for accounting integrations. — [Gusto: Set up and manage departments (help-center summary)](https://support.gusto.com/article/100011863100000/set-up-and-manage-departments-for-admins)
- Work locations are company addresses managed under the company profile, kept separate from departments. — [Gusto: Edit company details (help-center summary)](https://support.gusto.com/article/106622257100000/Edit-company-details)
- No division, team, level or cost-centre objects appeared in Gusto's help results.

**Rippling**
- The API exposes **departments** (each with name, id and parent, so departments nest), **teams** (with parent, so subteams exist), **levels** and **work locations** (with addresses). — [Truto Rippling integration (third-party)](https://truto.one/integrations/detail/rippling/); [Rippling MCP server listing (third-party)](https://mcpservers.org/servers/bifrost-mcp/rippling-mcp)
- A Rippling job posting for its "Org Management" team names the product areas as Headcount Planning, Comp Bands, Org Charts, Levels, Departments and Teams. This confirms the object names but not how they behave. — [Rippling job posting via Threshold](https://careers.threshold.vc/companies/rippling/jobs/31354244-engineering-manager-org-management)
- Rippling's platform page (marketing) says the system knows "what departments you have, where your work locations are… what the levels and teams in your company are". — [Rippling Platform blog](https://www.rippling.com/blog/introducing-rippling-platform)
- Report grouping can show department hierarchy, for example Engineering with Backend, Frontend and Infra sub-departments. — [Rippling developer docs: reports](https://developer.rippling.com/documentation/rippling-platform/reports/getting-started)

**HiBob**
- Department is a **named list**. Its field id is `work.department`, and each list item has an id, a display value and an **archived** flag. The field is marked historical. Company lists include departments, sites and job titles. — [HiBob API docs: Fields and lists metadata (official)](https://apidocs.hibob.com/docs/fields-metadata); [Workato HiBob connector (third-party)](https://docs.workato.com/en/data-orchestration/data-pipeline-recipe/configure-hibob)
- HiBob calls locations "Site". A site value on an employee must match a site already set up in HiBob settings. — [Stitchflow HiBob API (third-party)](https://www.stitchflow.com/user-management/hibob/api)
- People insights can group by any field, "including those in custom lists", for example headcount, manager or division. — [HiBob help: New Features December 2019 (help-center summary; old)](https://help.hibob.com/en/articles/3629957-new-features-december-2019)

**Deel (HR)**
- Deel uses a generic **"Organization structure"** object. **Department** is "a pre-enabled organization structure". Admins can add more structures, and each structure can be made **mandatory** so every new contract must be assigned one. — [Deel: How to Configure Organization Structure and Worker Relations (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/24441578301073-How-to-Configure-Organization-Structure-and-Worker-Relations); [Deel: Org Chart by Deel (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/19023211643665-Org-Chart-by-Deel)
- **Worker relations** are a separate object. "Manager" is pre-enabled and drives the org chart. — [Deel: Configure Organization Structure (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/24441578301073-How-to-Configure-Organization-Structure-and-Worker-Relations)
- The departments API returns id, name and **parent department**, so departments nest. — [Deel API: Get departments (official)](https://developer.deel.com/api/reference/endpoints/organizations/get-departments)
- **Cost centres** exist in Deel Global Payroll. Assigning them is limited to People Admin and People & Payroll Admin roles. — [Deel: Global Payroll Entity Level Permissions (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/26165580703633-Global-Payroll-Entity-Level-Permissions)
- When migrating, Deel asks for Department, Work Location, Manager and Direct Reports, so that people sit correctly on the org chart. — [Deel: Switching to Deel from your current HRIS (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/13934834469521-Switching-To-Deel-From-Your-Current-HRIS-Provider)

**Personio**
- Personio's help center says: "you must always set up Departments, but you should only set up Teams (and Subteams) if your company uses a matrix structure." The path is Settings > Organization > "Departments and teams". Giving a unit a parent makes it a sub-department or subteam. — [Personio: Set up departments and teams (help-center summary)](https://support.personio.de/hc/en-us/articles/18862110441885-Set-up-departments-and-teams)
- **Legal entities** (Settings > Organization > Legal entities) are the registered companies. They drive employer assignment and filtering in the People list and org chart. **Workplaces** (physical locations) are separate and support location-based reporting. — [Personio: Set up workplaces and legal entities (help-center summary)](https://support.personio.de/hc/en-us/articles/209388769-Set-up-workplaces-and-legal-entities)
- Departments and teams can be imported, and there is a guided article "Implement your company's basic structure". — [Personio: Import departments and teams](https://support.personio.de/hc/en-us/articles/25768407987741-Import-departments-and-teams); [Personio: Implement your company's basic structure](https://support.personio.de/hc/en-us/articles/21495336264733-Implement-your-company-s-basic-structure)

**Factorial**
- Factorial has **Workplaces** (a physical location; "employees can only work from one workplace at a time"; Settings → Workplaces), **Legal entities** (one primary entity tied to billing, any number of secondary ones; Settings → Company details), **Teams** with leads, a **Job Catalog**, and "contribution groups and professional categories" for Spanish payroll. — [Factorial: About workplaces](https://help.factorialhr.com/about-workplaces); [Factorial: About legal entities](https://help.factorialhr.com/en_US/managing-my-company-account/about-legal-entities); [Factorial: Contribution groups and professional categories](https://help.factorialhr.com/en_US/teams-jobs-organizational-chart/contribution-groups-and-professional-categories)
- The bulk employee importer needs a legal entity first, and you run a separate import for each legal entity. — [Factorial: About the employee importer (help-center summary)](https://help.factorialhr.com/en_US/managing-my-company-account/about-the-employee-importer)

**Freshteam**
- The Freshteam API exposes Departments (via a unified-API mapping). The available help results did not document locations, business units or sub-departments. — [Apideck Freshteam resources (third-party)](https://developers.apideck.com/apis/hris/freshteam)

**Sage HR**
- No primary Sage HR documentation was found. The only results were third-party Cleverence pages that mix Sage HR with Sage People (the enterprise product, which has **positions** as budgeted seats that can be vacant). Do not attribute position management to Sage HR. — [Cleverence: About employee positions (third-party, mixes products)](https://www.cleverence.com/articles/sage-documentation/about-employee-positions-sage-5926/)

### Inferences
- A shared minimum model has formed: **department (one per person, optionally nested) + location + job title + manager**. Entities are added for multi-company setups. Teams, levels and cost centres are opt-in.
- **One department per person** is the norm (stated explicitly by Gusto). Matrix membership is handled by a second object (teams in Personio, Rippling and Factorial; custom org structures in Deel), not by putting someone in two departments.
- Two naming patterns compete. **Fixed named objects** (BambooHR's Division/Department/Location; Personio's Departments/Teams/Workplaces/Legal entities) are easy to grasp. **Generic, admin-defined structures** (Deel's "Organization structures", HiBob's "company lists") are flexible but abstract. SMB-first products (Gusto, BambooHR, Personio, Factorial) favour fixed names.
- "Positions" as standalone seats are an enterprise or mid-market concept (Sage People, Rippling headcount planning). None of the SMB products here require them.
- Location is the object most tied to tax and compliance, so it carries more rules than department (see Gusto in section 4 and BambooHR's 2026 locations API).

### Gaps
- Rippling's official help-center pages on setting up departments, teams and levels could not be found or opened. Behaviour above comes from API and third-party docs.
- HiBob's help-center articles on managing lists in settings could not be opened (403).
- Sage HR: no primary documentation found for its department, team or location model.
- Freshteam: no current documentation found for business units, sub-departments or locations.
- Whether BambooHR's Division is optional or hidden by default could not be confirmed.

---

## 2. Department heads and owners: descriptive or permission-granting?

### Takeaway
In the SMB products, a department "lead" or "head" is mostly **descriptive**. Personio documents this explicitly: leads appear only in the org chart. **Permission comes from the manager relationship** (Gusto, Deel, BambooHR) or from **scoped roles** (Rippling, Deel). Rippling is the clearest case of department-scoped permissions: a permission profile's scope can be "an entire department".

### Cited Findings
- **Personio:** leads are added from a department or team card (Edit → add lead), and up to three leads show per card. Personio says leads "only appear in the org chart and don't affect other parts of Personio". Leads cannot be imported, and assigning them needs Edit permission on Organization > Departments. — [Personio: Manage the Org chart (help-center summary)](https://support.personio.de/hc/en-us/articles/29762795544989-Manage-the-Org-chart); [Personio: Overview of the Org chart (help-center summary)](https://support.personio.de/hc/en-us/articles/360017540757-Overview-of-the-Org-chart)
- **Rippling:** a permission profile has a **scope**, "the people whose data a permissions profile has some access to. It could be a reporting line or an entire department". **Supergroups** are "dynamic membership lists built using attributes like level or location", and approval routing can use attributes such as department. — [Rippling: Permissions (official marketing page)](https://www.rippling.com/en-GB/platform/permissions)
- **Deel:** admins set manager access per category (worker compensation, work relations, org structure, contract details), each as hidden, view-only or view-and-edit. Custom roles can be scoped to the whole organization, a group or a **department**. — [Deel: How to Assign Manager Roles (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/38000479449617-How-to-Assign-Manager-Roles-in-Your-Organization); [Deel: Create Custom Group Roles (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/16667113357329-How-to-Create-Custom-Group-Roles-on-Deel)
- **Gusto:** permission is per manager. Admins assign a manager and set the manager's permission types. Only one manager per person. No department-head concept appeared in the results. — [Gusto: Manager permission types (help-center summary)](https://support.gusto.com/article/145232124100000/Manager-permission-types); [Gusto: Assign a manager](https://support.gusto.com/team-management/user-permissions/manager-accounts/1019949191/Assign-a-manager-to-your-employees.htm)
- **BambooHR:** custom access levels are defined by function ("Each custom access level can have its own viewing permissions"). The customization guide does not document department- or division-scoped access. Division, Department and Location are used to route approvals. — [BambooHR 100+ Ways guide (read)](https://www.bamboohr.com/resources/guides/100-ways-to-customize-bamboohr)
- **Factorial:** a separate team-based chart lets admins build the hierarchy by **team leadership**. — [Factorial: About the Organizational Chart (help-center summary)](https://help.factorialhr.com/en_US/teams-jobs-organizational-chart/about-the-organizational-chart)

### Inferences
- **Pattern for small businesses:** keep "department head" as a label for display and routing, and grant access through the reporting line. Personio's explicit statement ("leads only appear in the org chart") avoids surprise access grants and is worth copying in wording as well as behaviour.
- Department-scoped permissions (Rippling, Deel custom roles) suit companies with HR teams. A 1–10 person company where the owner sees everything gets little from them.
- Using department, division or location as **approval-routing keys** (BambooHR, Rippling) is a useful middle ground: the head gets a job to do without a data-access grant.

### Gaps
- No documentation found on whether HiBob, Freshteam or Sage HR have a department-owner field, or what it controls.
- No documentation found on whether BambooHR has a native "department head" field.

---

## 3. Org chart: reporting vs department/team views, search, export, open positions, matrix (dotted-line)

### Takeaway
The baseline everywhere is a **reporting-line chart built from manager fields**. Mid-market tools (Personio, Deel, Factorial) add **department and team views**, **filters** and **image or PDF export**. Open positions and dotted lines are weak or absent across the SMB set: none had clearly documented dotted-line support, and open positions show up in planning features rather than the live chart. BambooHR's native chart is basic, and BambooHR points customers to marketplace tools (Lucidchart, Pingboard, OrgChart Now) for more.

### Cited Findings
**Personio (richest documented chart)**
- The chart can be arranged by **People (default), Departments or Teams**. Department and team cards show direct and total member counts, sub-units and up to three leads. Card display options include description, code, total members and leads. — [Personio: Overview of the Org chart (help-center summary)](https://support.personio.de/hc/en-us/articles/360017540757-Overview-of-the-Org-chart)
- In department and team views you can **search** for an employee or a unit name. Filters apply to the chart, and **export respects filters**. Export formats are **JPEG, PNG, SVG and PDF**, always the full image whatever the zoom level. Export needs a "People list & org chart (export)" permission. — [Personio: Manage the Org chart (help-center summary)](https://support.personio.de/hc/en-us/articles/29762795544989-Manage-the-Org-chart)
- Users can typically only see people in their own **legal entity**. — [Personio: Set up workplaces and legal entities (help-center summary)](https://support.personio.de/hc/en-us/articles/209388769-Set-up-workplaces-and-legal-entities)
- A community thread says the team attribute cannot be shown beside an employee on the chart, although filtering by team works (older thread). — [Personio Community](https://community.personio.com/employee-data-documents-86/how-to-show-team-name-in-org-chart-2273)
- No vacancies on the chart. Openings sit in the separate Jobs list (an openings count per job). — [Personio: Overview of the Jobs list](https://support.personio.de/hc/en-us/articles/360002005077-Overview-of-the-Jobs-list)

**Deel**
- Clients "can group the org chart on the basis of worker relations, org structures, and worker country" and "visualize multiple org structures within an org chart". "High-quality" export is available for Hierarchical or Org Structure views with filters applied. — [Deel: Org Chart by Deel (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/19023211643665-Org-Chart-by-Deel)
- Reporting is **linear only**: circular manager loops are blocked. — [Deel: Configure Organization Structure (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/24441578301073-How-to-Configure-Organization-Structure-and-Worker-Relations)
- There is also an "Entity Management – Organization Chart" for the legal-entity tree, and a separate Workforce Planning feature. — [Deel: Entity Management – Organization Chart](https://help.letsdeel.com/hc/en-gb/articles/34025198323601-Entity-Management-Organization-Chart); [Deel: About Workforce Planning](https://help.letsdeel.com/hc/en-gb/articles/34223479264529-About-Deel-s-Workforce-Planning-Feature)
- Additional worker-relation types beyond Manager are configurable, which may serve as secondary or dotted-line relations. Whether they draw as dotted lines on the chart is not confirmed (inference, see Gaps).

**Factorial (read)**
- Organisation → Org Chart tab. The chart is "dynamically generated based on employee-manager relationships". Filters are Workplace, Legal entity, Hire date and Legal gender. "Any personnel changes (hires/terminations) update the chart in real time." Export is through (...) → "Export org chart (xls)". The stated purpose includes "vacant roles", but the article does not say how vacancies are shown. Search and dotted lines are not mentioned. — [Factorial: About the Organizational Chart (read)](https://help.factorialhr.com/en_US/teams-jobs-organizational-chart/about-the-organizational-chart)
- A separate **Teams → Chart** view builds the hierarchy from team leadership, and teams can be moved within it in settings. — [same (help-center summary)](https://help.factorialhr.com/en_US/teams-jobs-organizational-chart/about-the-organizational-chart)

**Gusto**
- The org chart sits inside the **Coworker directory** and needs a **Plus or Premium** plan. Managers can be assigned on any plan. Admins turn it on under Settings > Customization. Anyone can **export it as PNG**. Only one manager per person. Departments and the chart are separate features: results showed no department view. — [Gusto: Coworker directory (help-center summary)](https://support.gusto.com/article/107785165100000/Coworker-directory); [Gusto: Manage your manager's permissions (help-center summary)](https://support.gusto.com/article/145232124100000/Manage-your-manager-s-permissions)

**BambooHR**
- The directory and org chart live on the People tab and are visible only once an admin turns **both** on in Settings. They are included in the Core, Pro and Elite packages. A "View in org chart" link appears in the directory and in the profile margin, and is hidden on inactive profiles. — [BambooHR: View the Company Directory and Org Chart (help-center summary; page behind login)](https://bamboohr.screenstepslive.com/m/61968/l/587751-view-the-company-directory-and-org-chart); [BambooHR: Enable the Company Directory and Org Chart](https://bamboohr.screenstepslive.com/m/53907/l/587538-enable-the-company-directory-and-org-chart); [BambooHR product update: Org Chart Shortcut (read; undated)](https://www.bamboohr.com/product-updates/org-chart-quick-link)
- A third-party company handbook describes a gear icon on the chart where you turn on options so hovering a card shows department and division. — [GlobalVision handbook (third-party)](https://handbook.globalvision.co/welcome/departments-and-divisions)
- BambooHR's customization guide covers org-chart planning only through integrations: "Enhance your process planning and org charts by integrating your planning apps", naming Lucidchart and Pingboard. Lucidchart's BambooHR import is Enterprise-only and lets you drag shapes to "plan for new talent". — [BambooHR 100+ Ways guide (read)](https://www.bamboohr.com/resources/guides/100-ways-to-customize-bamboohr); [Lucid marketplace: BambooHR](https://lucid.co/marketplace/e722e358/bamboo-hr)
- No source showed open positions or placeholders on BambooHR's native chart. Job openings live in the ATS with statuses Draft / Open / On Hold / Filled / Canceled. — [BambooHR: Managing Job Openings FAQ](https://bamboohr.screenstepslive.com/m/53914/l/1487104-managing-job-openings-faq)

**HiBob**
- The help center describes the org chart as "a clear graphical representation of your company" and says it helps users "understand the relationships between people, teams, and departments". It is generated automatically from imported employee data. — [HiBob: Organisation Charts (help-center summary)](https://help.hibob.com/en/articles/1160785-organisation-charts); [HiBob: Self-Implementation Guide (help-center summary)](https://help.hibob.com/en/articles/4334613-self-implementation-guide)
- HiBob's glossary (marketing) describes directory views by site, department or team. — [HiBob glossary: employee directory (marketing)](https://www.hibob.com/hr-glossary/employee-directory/)

**Freshteam (outdated doc)**
- The chart is based on "the reporting manager and subordinates". The 2019 article says "For now, we do not have org chart based on departments and team. This is in works…" Cards show subordinate counts. — [Freshteam: Understanding Org Charts (read; modified 25 Sep 2019; outdated)](https://support.freshteam.com/support/solutions/articles/19000098665-understanding-org-charts-in-freshteam)
- The mobile app chart shows manager, peers and direct reports, and you can re-centre on any person. — [Freshteam: Org chart on mobile app](https://support.freshteam.com/support/solutions/articles/19000138251-viewing-the-organization-chart-on-freshteam-mobile-app)

**Rippling**
- Rippling markets "a single org chart" for domestic and global staff (marketing). Its documented building blocks are departments and teams with parents, plus headcount planning. No help-center documentation was found on dotted lines or open roles on the chart. — [Rippling: Platform blog](https://www.rippling.com/blog/introducing-rippling-platform); [Rippling: Introducing Headcount Planning and Compensation Bands](https://www.rippling.com/blog/introducing-rippling-headcount-planning-compensation-bands)

**Dotted lines (benchmark outside the set)**
- Remote.com documents dotted-line managers with an org-chart toggle, showing that the pattern exists in this market. — [Remote: How to use dotted-line managers](https://support.remote.com/hc/en-us/articles/46222250478221-How-to-use-dotted-line-managers)

### Inferences
- **Copy:** Personio's three-way arrangement (People / Departments / Teams), unit cards with member counts and leads, search inside unit views, and filter-respecting export. This is the most complete documented SMB chart.
- **Floor for a 1–50 person company:** a reporting chart from the manager field, a department grouping or filter, and a PNG or PDF export. Gusto and BambooHR ship roughly this.
- Open positions and dotted lines are where SMB products send customers elsewhere (BambooHR to Lucidchart and Pingboard; Personio to the Jobs list). Building them natively would set a product apart, but they are not table stakes.
- One-manager-per-person plus loop prevention (Gusto, Deel) is the standard data rule.

### Gaps
- No primary source confirmed native dotted-line or secondary-manager support on the chart for any of the nine vendors. HiBob and Rippling may have it, but it was not verified.
- BambooHR's native chart: search, export and department-view details could not be verified because the help pages are behind a login.
- Freshteam's department- and team-based chart (promised in 2019): current status unknown.

---

## 4. Restructuring: renaming and merging values, retiring values in use, bulk updates, effective dating, history

### Takeaway
Two models. **Effective-dated history tables** (BambooHR's Job Information, HiBob's Work table) add a new dated row for every move, so history and future-dated changes come for free. **Simple current-value assignment** (Gusto departments) lets you rename or remove freely. **Locations get special protection** because tax depends on history. "Archive" rather than delete for list values is documented in HiBob's data model. None of the sources found document a **merge** feature for list values.

### Cited Findings
**BambooHR**
- Changing job title, department, division, location or reports-to creates a **new row** in the employee's job (position) history table, with a Date field marking when it takes effect. — [withone.ai BambooHR API knowledge (third-party)](https://www.withone.ai/knowledge/bamboo-hr/conn_mod_def%3A%3AGMSIaKF72wA%3A%3AisOAZkVITR-7lr__jmr7Fw); [BambooHR API: Update Employee (official)](https://documentation.bamboohr.com/reference/update-employee)
- A BambooHR release note (2016, old) says future-dated hire, termination and table data such as Job Information used to be treated as current immediately, and would instead take effect only when the date arrived. Current behaviour is not re-confirmed. — [BambooHR: Historical changes to the API (help-center summary; old entry)](https://documentation.bamboohr.com/docs/past-changes-to-the-api)
- Integration gotcha: the NetSuite sync **skips employees whose Division effective date is in the future**. — [BambooHR Marketplace: NetSuite listing](https://www.bamboohr.com/integrations/listings/netsuite-employee-sync)
- Integrations commonly read a "Job Information Effective Date" field alongside Location, Division and Department. — [BambooHR Marketplace: WorkLinks](https://www.bamboohr.com/integrations/listings/worklinks)
- Admin approvals for changes exist: there is a product update on "Additional Editing Functions in Admin Approval". — [BambooHR product update](https://www.bamboohr.com/product-updates/additional-editing-functions-in-admin-approval)

**HiBob**
- Changes to table sections such as **Work history** are stored as new rows, each with its own **effective date**, and older entries are kept (examples: promotions, transfers, manager changes). — [HiBob: Update an employee profile (help-center summary)](https://help.hibob.com/hc/en-us/articles/4409792452113-Update-an-employee-profile)
- **Bulk table import** supports the Work table and can overwrite existing rows whose effective dates match. — [HiBob: Importing Table Data (help-center summary)](https://help.hibob.com/en/articles/1505180-importing-table-data)
- The **Audit Report** logs every field change with who made it and the effective date, which can differ from the date it was entered. A separate **Changes Report** can be filtered by site and department. — [HiBob: Audit Report](https://help.hibob.com/en/articles/3651065-audit-report); [HiBob: Changes Report](https://help.hibob.com/en/articles/3650935-changes-report)
- List items carry an **archived** flag, so retiring a value keeps its history. — [HiBob API: Fields and lists metadata (official)](https://apidocs.hibob.com/docs/fields-metadata)
- A third-party guide describes the model like this: changing a role "doesn't overwrite the old record; it appends a new entry with an effective date". — [Truto: Connect HiBob to AI agents (third-party)](https://truto.one/blog/connect-hibob-to-ai-agents-orchestrate-hiring-tasks-documents/)

**Gusto**
- **Rename** a department with the pencil icon on its page (People > More > Departments). **Remove a person** from a department under Actions → Remove. **Remove a whole department** with "Remove" then "Yes, remove". Bulk changes are easiest on the Departments page. — [Gusto: Set up and manage departments (help-center summary)](https://support.gusto.com/article/100011863100000/Set-up-and-manage-departments); [Gusto: Remove your departments](https://support.gusto.com/team-management/hr-tools/departments/1066223561/Remove-your-departments.htm)
- **Locations are protected.** Gusto says: "Do not delete old work addresses if employees ever worked there. Gusto will need historical work addresses for taxation purposes." An address with active employees cannot be edited. To retire it, create a new location and move people. "Move employees here" sets a **start date (today or later)**. Correcting a wrong current address is a different action that replaces the record. — [Gusto: Edit company details (help-center summary)](https://support.gusto.com/article/106622257100000/Edit-company-details); [Gusto: Edit an employee's work info (help-center summary)](https://support.gusto.com/article/101895146100000/edit-an-employees-work-info-for-admins)

**Deel**
- Org structures can be made mandatory for new contracts. Manager permission categories include "org structure" (hidden / view / edit). — [Deel: Configure Organization Structure (help-center summary)](https://help.letsdeel.com/hc/en-gb/articles/24441578301073-How-to-Configure-Organization-Structure-and-Worker-Relations); [Deel: Assign Manager Roles](https://help.letsdeel.com/hc/en-gb/articles/38000479449617-How-to-Assign-Manager-Roles-in-Your-Organization)

**Personio / Factorial**
- Personio supports importing departments and teams (but not leads). — [Personio: Import departments and teams](https://support.personio.de/hc/en-us/articles/25768407987741-Import-departments-and-teams)
- Factorial's chart updates in real time on hires and terminations. In settings you can move a team to a different position in the team chart. — [Factorial: About the Organizational Chart](https://help.factorialhr.com/en_US/teams-jobs-organizational-chart/about-the-organizational-chart)

### Inferences
- **Worth copying:** (a) a dated job-history table per person, as BambooHR and HiBob do, where a department or location change is a new row with an effective date; (b) archive list values instead of deleting them, as HiBob's `archived` flag does; (c) Gusto's location rule: no delete if ever used, no edit while in use, and a "move people here from date" action. Under Indian GST and Professional Tax, state of work is tax-relevant, so (c) applies directly to CLOR.
- **Distinguish correction from change.** Gusto documents both actions separately for addresses, and HiBob separates entry date from effective date in its audit report. Mixing the two corrupts history.
- **Future-dated changes break integrations** (BambooHR's NetSuite sync). Products need a clear rule for when a future row becomes "current".
- **Merging** list values is not documented anywhere found. Renaming in place (Gusto) is the common route, and it rewrites history labels. That is a real trade-off.

### Gaps
- No vendor documentation found for **merging** two departments or list values.
- BambooHR: no confirmation found of what happens when you delete a department value still in use, or whether renaming changes the labels on historical rows.
- No effective-dated restructuring found at the **department object** level (for example "Sales splits into two from 1 April"). All effective dating found is per employee.
- Rippling: effective-dated changes and history behaviour were not found in accessible documentation.

---

## 5. How they keep setup simple for 1–50 employees, and where complexity starts

### Takeaway
They keep it simple with **features that are off until turned on** (Gusto departments, BambooHR directory and org chart), **one pre-enabled default** (Deel's Department structure, Personio's required Departments), **optional extras explained in plain terms** (Personio: set up teams only if you have a matrix), and **charts generated automatically** from manager fields (HiBob, Factorial, Freshteam). Complexity starts with **legal entities, matrix teams, scoped permissions, cost centres, levels and headcount planning**. These are tier-gated or come with the bigger products.

### Cited Findings
- Gusto: departments must be turned on ("Enable the departments feature"). The org chart is Plus/Premium only, while manager assignment is on every plan. — [Gusto: Enable the departments feature](https://support.gusto.com/article/100011863100000/Enable-the-departments-feature); [Gusto: Coworker directory](https://support.gusto.com/article/107785165100000/Coworker-directory)
- BambooHR: directory and org chart are off until an admin enables both. Package limits apply elsewhere, for example Core has 5 job openings and Pro has 25. — [BambooHR: Enable the Company Directory and Org Chart](https://bamboohr.screenstepslive.com/m/53907/l/587538-enable-the-company-directory-and-org-chart); [BambooHR: Managing Job Openings FAQ](https://bamboohr.screenstepslive.com/m/53914/l/1487104-managing-job-openings-faq)
- Personio: departments are required, teams only "if your company uses a matrix structure". — [Personio: Set up departments and teams](https://support.personio.de/hc/en-us/articles/18862110441885-Set-up-departments-and-teams)
- Deel: Department is "a pre-enabled organization structure" and the Manager relation is pre-enabled. — [Deel: Org Chart by Deel](https://help.letsdeel.com/hc/en-gb/articles/19023211643665-Org-Chart-by-Deel); [Deel: Configure Organization Structure](https://help.letsdeel.com/hc/en-gb/articles/24441578301073-How-to-Configure-Organization-Structure-and-Worker-Relations)
- HiBob: "The information you input here will automatically generate your org chart!" (self-implementation guide). — [HiBob: Self-Implementation Guide](https://help.hibob.com/en/articles/4334613-self-implementation-guide)
- Gusto: a department can be created inline from an employee's Work profile, not only from settings. — [Gusto: Set up and manage departments (help-center summary)](https://support.gusto.com/hc/en-us/articles/220382007)
- Where complexity starts: Factorial needs a legal entity before importing and runs a separate import per entity. Personio limits chart visibility by legal entity. Deel's cost-centre assignment is role-restricted and its entity-level roles "may not be rolled out to all clients". Rippling's permission scopes and supergroups are attribute-driven. — [Factorial: employee importer](https://help.factorialhr.com/en_US/managing-my-company-account/about-the-employee-importer); [Personio: workplaces and legal entities](https://support.personio.de/hc/en-us/articles/209388769-Set-up-workplaces-and-legal-entities); [Deel: Global Payroll Entity Level Permissions](https://help.letsdeel.com/hc/en-gb/articles/26165580703633-Global-Payroll-Entity-Level-Permissions); [Rippling: Permissions](https://www.rippling.com/en-GB/platform/permissions)

### Inferences
- For a 1–2 person owner-run business, the useful defaults are: one location (the registered office), no departments until asked for, manager optional, and an org chart that appears on its own once there are reports.
- Creating a list value **inline from the employee form** (Gusto) avoids a trip to settings and suits very small teams.
- Entity, cost centre, level and team should stay hidden until switched on. Each one adds a required field to every employee once it is turned on (as Deel's "mandatory" structures do).

### Gaps
- No vendor published setup-time or field-count numbers for small companies.
- Rippling's and HiBob's small-company onboarding defaults for org objects were not found.

---

## 6. Design patterns worth copying, and patterns users dislike

### Takeaway
Worth copying: Personio's unit-centric chart (arrange by people, departments or teams; cards with counts and leads; filter-aware export), HiBob and BambooHR's effective-dated job history, Gusto's location rules, Deel's linear-only reporting check, and labelling leads as display-only. Disliked or missing: no dotted lines, team names not visible on the chart (Personio community), the org chart locked to higher tiers (Gusto), and charts needing third-party tools (BambooHR). Hard user-complaint data for these vendors' org modules was thin.

### Cited Findings
- **Copy: chart arranged three ways, search in unit views, export in 4 formats that respects filters.** — [Personio: Overview of the Org chart](https://support.personio.de/hc/en-us/articles/360017540757-Overview-of-the-Org-chart); [Personio: Manage the Org chart](https://support.personio.de/hc/en-us/articles/29762795544989-Manage-the-Org-chart)
- **Copy: leads are display-only, stated plainly.** — [Personio: Manage the Org chart](https://support.personio.de/hc/en-us/articles/29762795544989-Manage-the-Org-chart)
- **Copy: effective-dated rows, plus an audit log that separates effective date from entry date.** — [HiBob: Update an employee profile](https://help.hibob.com/hc/en-us/articles/4409792452113-Update-an-employee-profile); [HiBob: Audit Report](https://help.hibob.com/en/articles/3651065-audit-report)
- **Copy: a location that has ever been used cannot be deleted; move people to a new one from a start date.** — [Gusto: Edit company details](https://support.gusto.com/article/106622257100000/Edit-company-details)
- **Copy: block manager loops; "Manager" relation pre-enabled.** — [Deel: Configure Organization Structure](https://help.letsdeel.com/hc/en-gb/articles/24441578301073-How-to-Configure-Organization-Structure-and-Worker-Relations)
- **Copy: one department per person, with a plain-language alternative for multi-role staff.** — [Gusto: Set up and manage departments](https://support.gusto.com/article/100011863100000/Set-up-and-manage-departments)
- **Copy: hire and termination update the chart immediately; export to a spreadsheet.** — [Factorial: About the Organizational Chart](https://help.factorialhr.com/en_US/teams-jobs-organizational-chart/about-the-organizational-chart)
- **Dislike: the team attribute is not visible on Personio's chart** (community thread, older). — [Personio Community](https://community.personio.com/employee-data-documents-86/how-to-show-team-name-in-org-chart-2273)
- **Dislike: native chart too thin, so third-party tools fill the gap.** BambooHR's own guide points to Lucidchart and Pingboard for planning. Pingboard says its integration exists so charts update without manual CSV re-uploads. — [BambooHR 100+ Ways guide](https://www.bamboohr.com/resources/guides/100-ways-to-customize-bamboohr); [Pingboard: BambooHR integration blog (vendor)](https://pingboard.com/blog/build-dynamic-org-charts-with-pingboards-bamboohr-integration)
- **Dislike (adjacent tools): dotted-line reports do not show their own reports, and secondary reports cannot be drawn.** These are Lucid and Plumsail users, not the HRIS vendors themselves. — [Lucid community](https://community.lucid.co/product-questions-3/org-chart-lines-and-structure-adjusting-1647); [Plumsail community](https://community.plumsail.com/t/dotted-line-with-reports/7757)
- **Dislike / outdated: department- and team-based charts promised in 2019 but not confirmed since (Freshteam).** — [Freshteam: Understanding Org Charts](https://support.freshteam.com/support/solutions/articles/19000098665-understanding-org-charts-in-freshteam)

### Inferences
- For CLOR's small-business lens, the highest-value, lowest-cost set is: department (optional, nestable, one per person) + location (tax-aware, archive-only) + dated job history + a reporting chart with a department view and PNG/PDF export. Teams and matrix, dotted lines, positions and cost centres can wait.
- Make the department-head label explicitly display-only, or make it explicitly an approval route. Do not let it silently grant data access.

### Gaps
- No structured user-complaint data (G2, Capterra, Reddit) specific to the org modules of these vendors was collected within the tool budget.
- Rippling, HiBob and Sage HR UX details for list management (rename, archive, merge screens) could not be verified from primary sources.
