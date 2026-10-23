# Clor People: implementation contract

Version 1.0 · 24 Oct 2026 · For the agents and people who write the code.
Requirements come from [02-PRD.md](02-PRD.md); words from [04-WORDS-AND-MENUS.md](04-WORDS-AND-MENUS.md). This document fixes **how**: schema, routes, permissions, state machines, events, interfaces, UI acceptance. An implementer should need no design decisions beyond it. Where a choice is still open it points at a D-id in [08](08-DECISIONS-AND-RISKS.md).

Paths are relative to the repo root. `S` = `server/prisma/people/schema.prisma`.

---

## 1. Architecture (unchanged)

```
Clor shell (packages/shell) ── apps/people (React 19, Vite)
        │ HTTP /api/orgs/:orgId/people/*
Express app (server/src/app.ts) ── routes/people*.ts ── services/people/*
        │ Prisma (peoplePrisma, wrapped by tenantScope)
PostgreSQL, schema `people` (shared with Attendance tables)
        │ outbox worker (jobLease) ── versioned events ── Attendance · Payroll · webhooks
```

Rules:
- Same Express app, same Prisma clients, same sign-in, same shell. No new process except the outbox worker, which runs as another `setInterval` job under `jobLease` (`server/src/services/jobLease.ts:135`) until a queue is justified.
- Routes stay thin; logic lives in `server/src/services/people/*`. No service imports a route file (`AGENT_RULES.md`).
- People reads Payroll and Attendance only through the interfaces in section 9. Never `payrollPrisma` from People code (today `routes/people.ts:233-256` breaks this; PC-CORE-09 fixes it).
- All new tables: `accountId`, `orgId`, fail-closed RLS (section 3.1).

---

## 2. Folder layout

```
apps/people/
  manifest.jsx                 rail, groups, nav items (section 8.1)
  src/screens.js               one export list
  src/screens/                 one file per screen, named as in 04 §4.1
  src/components/              EmployeeProfileHeader, Timeline, ChangeComparison, WhyPanel,
                               ApprovalSteps, EvidenceList, CaseThread, SensitiveReveal
  src/api/                     one file per server area (people, lifecycle, approvals, desk, policies, compliance, privacy, why)
server/src/routes/
  people.ts                    directory, profile, custom fields (exists; grows)
  peopleLifecycle.ts           invites, plans, changes, leaving, probation
  peopleApprovals.ts           requests, rules, stand-ins
  peopleDesk.ts                help desk
  peoplePrivateCases.ts        private cases
  peoplePolicies.ts            policies, acknowledgements
  peopleDocuments.ts           documents, letters, templates (moves out of people.ts)
  peopleCompliance.ts          rules, obligations, proof
  peopleWhy.ts                 why panel, decision records
  peopleAi.ts                  AI controls (P0), ask (P2)
server/src/services/people/
  employees.ts                 the ONE create/update path (FND-08)
  effectiveDating.ts           scheduled changes, "as of"
  changeLog.ts                 before/after log (FND-04)
  episodes.ts                  employment episodes
  outbox.ts                    write events; worker in outboxWorker.ts
  lifecycle/{invites,plans,changes,leaving,probation}.ts
  approvals/{engine,rules,standIns}.ts
  desk.ts · privateCases.ts · policies.ts · documents.ts · letters.ts
  compliance/{rules,obligations}.ts
  why.ts · decisionRecords.ts
  ai/{controls,gateway}.ts
server/prisma/people/migrations/<ts>_<name>/migration.sql   (+ <ts>_<name>_rls)
server/src/__tests__/people*.test.ts
```

---

## 3. Database

### 3.1 Row-level security, fail closed (every new table)

Migration `server/prisma/people/migrations/<timestamp>_<name>_rls/migration.sql`:

```sql
ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "X" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "X"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
```

Never the old `IS NULL OR = ''` form. Add every new migration to `applyPolicies` in `server/src/__tests__/globalSetup.ts:258-302`. One test per table in `peopleRls.test.ts`: no company set → 0 rows; company A → no company B rows.

### 3.2 New and changed models (Prisma, `S`)

Common columns on every new model: `id String @id @default(cuid())`, `accountId String`, `orgId String`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, index `@@index([orgId])`. Shown once here, omitted below.

```prisma
/// Foundations ----------------------------------------------------------

model LegalEntity {           // FND-07
  name          String
  pan           String?       // masked in API
  cin           String?
  registeredAddress Json
  establishments Establishment[]
  @@unique([orgId, name])
}

model Establishment {         // FND-07
  legalEntityId String
  name          String        // "Bengaluru office"
  kind          EstablishmentKind   // SHOP | FACTORY | OFFICE | SITE | WAREHOUSE
  state         String        // ISO code, e.g. "KA"
  address       Json
  registrations Json          // [{type:"SE_REG", number, validTill}, {type:"PF_CODE"...}]
  holidayListId String?       // Attendance holiday list id (read only)
  active        Boolean @default(true)
  @@unique([orgId, name])
}

model EmploymentEpisode {     // FND-06
  employeeId    String
  seq           Int           // 1, 2, 3
  startDate     String        // YYYY-MM-DD
  endDate       String?
  endType       String?       // RESIGNED | TERMINATED | RETIRED | CONTRACT_END | ABSCONDED | DECEASED
  endReason     String?
  @@unique([employeeId, seq])
  @@index([orgId, employeeId])
}

model ScheduledChange {       // FND-02
  employeeId    String
  field         String        // one of JOB_FIELDS (section 5.2)
  fromValue     String?
  toValue       String?
  fromLabel     String?
  toLabel       String?
  effectiveOn   String        // YYYY-MM-DD
  status        ScheduledChangeStatus // PENDING | APPLIED | CANCELLED
  requestId     String?       // ApprovalRequest that approved it
  appliedAt     DateTime?
  appliedRunId  String?       // idempotency: the job run that applied it
  @@index([orgId, status, effectiveOn])
}

model ChangeLog {             // FND-04, append-only (section 3.3)
  entity        String        // "Employee" | "Document" | "Policy" | ...
  entityId      String
  employeeId    String?
  field         String
  before        String?       // null for sensitive fields; `redacted` = true
  after         String?
  redacted      Boolean @default(false)
  reason        String?
  source        ChangeSource  // FORM | IMPORT | APPROVAL | API | SYSTEM | SELF_SERVICE | SCHEDULED
  actorUserId   String?
  correlationId String
  requestId     String?       // ApprovalRequest id if any
  decisionId    String?       // DecisionRecord id if any
  at            DateTime @default(now())
  @@index([orgId, entity, entityId, at])
  @@index([orgId, employeeId, at])
  @@index([correlationId])
}

model OutboxEvent {           // FND-05
  eventId       String @unique @default(cuid())
  name          String        // "people.employee.created.v1"
  employeeId    String?
  correlationId String
  payload       Json
  occurredAt    DateTime @default(now())
  deliveredAt   DateTime?
  attempts      Int @default(0)
  nextAttemptAt DateTime?
  lastError     String?
  @@index([orgId, deliveredAt, nextAttemptAt])
}

model CustomFieldDef {        // CORE-08
  entity        String        // "Employee"
  key           String        // snake_case, immutable
  label         String
  type          CustomFieldType // TEXT | NUMBER | DATE | CHOICE | BOOLEAN | FILE
  options       Json?         // for CHOICE
  required      Boolean @default(false)
  viewPermission String       // e.g. "PEOPLE::Employees::VIEW" or "PEOPLE::Statutory Details::VIEW"
  editPermission String
  version       Int @default(1)
  active        Boolean @default(true)
  @@unique([orgId, entity, key])
}

model CustomFieldValue {
  defId         String
  entityId      String        // employeeId
  value         Json
  @@unique([defId, entityId])
  @@index([orgId, entityId])
}

/// Lifecycle ------------------------------------------------------------

model JoinInvite {            // LIFE-01
  employeeId    String        // created as status JOINING first
  tokenHash     String @unique
  channel       String        // EMAIL | SMS
  sentTo        String
  expiresAt     DateTime
  status        InviteStatus  // SENT | STARTED | RETURNED | CHECKED | EXPIRED
  submitted     Json?         // what the joiner typed, until HR checks
  checkedByUserId String?
  checkedAt     DateTime?
}

model LifecyclePlan {         // LIFE-02, LIFE-05 (replaces ChecklistInstance for new plans)
  employeeId    String
  kind          PlanKind      // JOINING | LEAVING | CHANGE | PROBATION
  anchorDate    String        // joining date, last working day, effective date
  episodeSeq    Int
  status        PlanStatus    // OPEN | DONE | CANCELLED
  tasks         PlanTask[]
}

model PlanTask {
  planId        String
  title         String
  ownerRole     String        // HR | MANAGER | IT | FACILITIES | PAYROLL | EMPLOYEE
  ownerUserId   String?       // the named person (resolved at creation; re-resolvable)
  dueOn         String
  status        TaskStatus    // TODO | DONE | NOT_NEEDED
  doneByUserId  String?
  doneAt        DateTime?
  note          String?
  system        Boolean @default(false)  // CLOR ticks it (e.g. reader removal)
  @@index([orgId, ownerUserId, status, dueOn])
}

model ProbationReview {       // LIFE-03
  employeeId    String
  periodEnd     String
  goals         String?
  observations  String?
  recommendation ProbationOutcome? // CONFIRM | EXTEND | END
  newEndDate    String?
  requestId     String?
  decidedAt     DateTime?
}

model SeparationCase {        // LIFE-05
  employeeId    String
  episodeSeq    Int
  type          String        // RESIGNED | TERMINATED | RETIRED | CONTRACT_END | ABSCONDED | DECEASED
  noticeStart   String?
  lastWorkingDay String
  reason        String?
  handover      String?
  exitInterview Json?
  settlementHandedAt DateTime?  // when `people.employee.separated.v1` carried the settlement request
  requestId     String?
  status        String        // REQUESTED | APPROVED | SERVING_NOTICE | LEFT | WITHDRAWN
}

/// Approvals ------------------------------------------------------------

model ApprovalRule {          // APR-02
  name          String
  requestType   RequestType   // PROFILE_CHANGE | JOB_CHANGE | LEAVING | DOCUMENT_REQUEST | LETTER_REQUEST | POLICY_PUBLISH | DESK_ESCALATION | SEAT_REQUEST | PROBATION
  version       Int
  active        Boolean
  steps         Json          // [{order, approver:{kind:"MANAGER"|"MANAGER_OF_MANAGER"|"DEPT_HEAD"|"USER"|"ROLE", id?}, condition?:{field, op, value}, dueDays, overdue:{action:"REMIND"|"HAND_ON", to:{kind,id?}}}]
  @@unique([orgId, requestType, version])
}

model ApprovalRequest {       // APR-01
  requestType   RequestType
  subjectEmployeeId String?
  requesterUserId String
  ruleId        String
  ruleVersion   Int
  payload       Json          // the proposed change, typed per requestType (section 6)
  status        RequestStatus // DRAFT | WAITING | APPROVED | REJECTED | WITHDRAWN | MORE_INFO
  currentStep   Int
  idempotencyKey String?
  decisionId    String?
  steps         ApprovalStep[]
  @@unique([orgId, idempotencyKey])
  @@index([orgId, status])
}

model ApprovalStep {
  requestId     String
  order         Int
  approverUserId String        // resolved at the time the step opened
  standInForUserId String?
  dueAt         DateTime
  status        StepStatus    // WAITING | APPROVED | REJECTED | MORE_INFO | HANDED_ON | SKIPPED
  comment       String?
  decidedAt     DateTime?
}

model StandIn {               // APR-04
  userId        String
  standInUserId String
  fromDate      String
  toDate        String
}

/// Documents, letters, policies ----------------------------------------

// EmployeeDocument (exists, S:1255) gains:
//   classification DocClass  // EMPLOYEE_VISIBLE | HR_ONLY | RESTRICTED | CONFIDENTIAL
//   version Int, supersedesId String?, retentionUntil String?, ownerUserId String?,
//   storageKey String? (object storage; `data` stays as fallback), scanStatus String? (PENDING|CLEAN|REFUSED)
// `visibleToEmployee` is derived from classification during migration and then dropped.

model LetterTemplate {        // DOC-04
  kind          String        // OFFER | APPOINTMENT | CONFIRMATION | INCREMENT | RELIEVING | EXPERIENCE | SERVICE_CERT
  name          String
  body          String        // HTML with {{merge}} fields from an allowlist
  version       Int
  active        Boolean
  @@unique([orgId, kind, version])
}

model Acknowledgement {       // DOC-05, POL-04
  targetType    String        // DOCUMENT | POLICY_VERSION
  targetId      String
  employeeId    String
  askedAt       DateTime
  acceptedAt    DateTime?
  remindedAt    DateTime?
  @@unique([targetType, targetId, employeeId])
}

model Policy {                // POL-01
  title         String
  category      String        // LEAVE | HOURS | CONDUCT | TRAVEL | BENEFITS | IT | POSH | OTHER
  ownerUserId   String
  versions      PolicyVersion[]
}

model PolicyVersion {         // POL-02, POL-03
  policyId      String
  version       Int
  body          String?
  documentId    String?
  effectiveFrom String
  effectiveTo   String?
  appliesTo     Json          // {establishmentIds?, states?, departmentIds?, employmentTypes?, grades?, categories?}
  needsAcceptance Boolean
  status        String        // DRAFT | WAITING | PUBLISHED | RETIRED
  publishedAt   DateTime?
  requestId     String?
  @@unique([policyId, version])
}

/// Help desk and private cases -----------------------------------------

model DeskRequest {           // DESK-01..06 (replaces PeopleRecord kind=helpdesk)
  employeeId    String
  category      String
  subject       String
  description   String
  urgency       String        // LOW | NORMAL | HIGH | URGENT
  replyChannel  String?
  assigneeUserId String?
  queue         String?
  replyBy       DateTime
  resolveBy     DateTime
  status        String        // OPEN | WAITING_EMPLOYEE | RESOLVED | REOPENED | MOVED
  resolution    String?
  resolvedAt    DateTime?
  movedToCaseAt DateTime?     // DESK-05: details wiped, only this stays
  messages      DeskMessage[]
}

model DeskMessage {
  requestId     String
  authorUserId  String
  body          String
  internal      Boolean       // never returned to the employee
  attachmentDocId String?
}

model PrivateCase {           // PRIV-01..06
  kind          String        // POSH | GRIEVANCE | OTHER
  complainantEmployeeId String?   // may be null (anonymous intake on behalf)
  respondentEmployeeIds Json     // excluded from membership by conflict check
  summaryEnc    Bytes         // AES-256-GCM, key from PEOPLE_CASE_KEY (D-09)
  receivedOn    String
  filingDeadline String       // +3 months from incident, extendable
  inquiryDue    String        // +90 days
  reportDue     String?       // +10 days after inquiry
  actionDue     String?       // +60 days after report
  status        String        // RECEIVED | INQUIRY | REPORT_DUE | CLOSED
  members       PrivateCaseMember[]
  evidence      PrivateCaseEvidence[]
}
model PrivateCaseMember { caseId String; userId String; role String /* PRESIDING | MEMBER | EXTERNAL | OFFICER */; @@unique([caseId, userId]) }
model PrivateCaseEvidence { caseId String; title String; dataEnc Bytes; mime String; addedByUserId String }
model PrivateCaseAccess { caseId String; userId String; what String /* OPEN | EVIDENCE */; at DateTime @default(now()) }

model CommitteeSetup {        // PRIV-06
  kind          String        // POSH_IC | GRIEVANCE
  members       Json          // [{userId, role, gender, external:boolean, termStart, termEnd}]
  warnings      Json          // computed on save
}

/// Compliance and privacy ----------------------------------------------

model ComplianceRule {        // COMP-01, versioned, never overwritten
  ruleId        String        // stable, e.g. "IN-POSH-IC"
  version       Int
  jurisdiction  String        // "IN" | "IN-KA" | ...
  establishmentKinds Json
  employeeCategories Json
  legalSource   String
  notificationRef String?
  effectiveFrom String
  effectiveTo   String?
  supersedesVersion Int?
  obligation    String
  threshold     Json?         // {minHeadcount:10}
  ownerRole     String
  dueRule       Json          // {kind:"MONTHLY", day:15} | {kind:"ANNUAL", month:1, day:31} | {kind:"EVENT", after:"JOINING", days:30}
  requiredProof Json          // ["FILING_RECEIPT"]
  reviewStatus  String        // DRAFT | CHECKED | NEEDS_REVIEW
  checkedByUserId String?
  checkedAt     DateTime?
  @@unique([orgId, ruleId, version])
}
// Platform-seeded rules live with orgId = '' under clor.bypass and are copied per company on first use (D-06 decides who checks them).

model Obligation {            // COMP-02
  ruleId        String
  ruleVersion   Int
  establishmentId String?
  dueOn         String
  ownerUserId   String?
  status        String        // UPCOMING | DUE | OVERDUE | DONE | CHECKED
  proofDocIds   Json
  note          String?
  @@index([orgId, status, dueOn])
}

model DecisionRecord {        // TRACE-05
  requestId     String?
  changeLogIds  Json
  policyVersionIds Json
  ruleVersionIds Json
  evidenceDocIds Json
  eventIds      Json
  summary       String
}

model RetentionRule { dataType String; keepYears Int; legalHold Boolean @default(false); basis String }   // PRV-03
model DeletionReview { dataType String; entityId String; dueSince String; status String; decidedByUserId String? } // PRV-03
model AccessLog { what String /* STATUTORY | DOC_CONFIDENTIAL | CASE */; entityId String; employeeId String?; userId String; at DateTime @default(now()) } // PRV-07
model AuditorGrant { userId String; evidenceIds Json; from DateTime; until DateTime; grantedByUserId String } // PRV-06

model AiSettings {            // AIG-01, AIG-02
  enabled       Boolean @default(false)
  acceptedTermsAt DateTime?
  acceptedByUserId String?
  sources       Json          // ["POLICIES"]
  provider      String?
  dataResidency String        // "IN_ONLY" | "ANY"
  allowedRoles  Json
}
model AiLog { userId String; question String; sources Json; model String; answer String; refused Boolean; at DateTime @default(now()) }  // AIG-03
```

Changes to `Employee` (S:36): add `establishmentId String?`, `teamId String?`, `seatId String?`, `preferredName String?`, `currentEpisodeSeq Int @default(1)`, `confirmedOn String?`. Keep every existing column; nothing is dropped in this build. `state` on the person stays the **home** state (R-07 fix in `employmentHistory.ts`: stop tracking it as "Work state").

### 3.3 Append-only guarantees

`ChangeLog`, `OutboxEvent` (after delivery), `AccessLog`, `PrivateCaseAccess`, `AiLog`: a trigger refuses UPDATE and DELETE except under `clor.bypass = 'on'` (retention jobs). Migration `<ts>_people_append_only`:

```sql
CREATE OR REPLACE FUNCTION people_refuse_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('clor.bypass', true) = 'on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'append_only: % rows cannot be changed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER change_log_append_only BEFORE UPDATE OR DELETE ON "ChangeLog"
  FOR EACH ROW EXECUTE FUNCTION people_refuse_change();
-- same trigger on AccessLog, PrivateCaseAccess, AiLog
```

---

## 4. Permissions

Format `PEOPLE::<Resource>::<ACTION>`, in `server/src/constants/permissionCatalog.ts`. New resources in **bold**. Actions: V=VIEW, C=CREATE, E=EDIT, D=DELETE, A=APPROVE, X=EXPORT.

| Resource | Employee | Manager | HR exec | HR head | Founder | Compliance | IT admin | Payroll admin | Auditor |
|---|---|---|---|---|---|---|---|---|---|
| Employees | own (self-service) | team V | V C E X | V C E D X | V X | V | — | V | — |
| **Statutory Details** (new; replaces reading Payroll's masked data) | own V | — | V (reveal with step-up) | V E (reveal) | — | V | — | V | — |
| Org Structure | V | V | V | V C E D | V | V | — | V | — |
| **Lifecycle** (invites, plans, changes, leaving, probation) | own V | team V, own tasks E | V C E | V C E A | V | — | own tasks E | V | — |
| **Approvals** (rules) | — | — | V | V C E | — | — | — | — | — |
| **Requests** (act on approvals routed to me) | own | A | A | A | A | — | A | A | — |
| **Documents** | own (EMPLOYEE_VISIBLE) | — | V C E (HR_ONLY) | V C E D (RESTRICTED) | — | V | — | — | shared only |
| **Confidential Documents** | — | — | — | V C E | — | — | — | — | — |
| **Letters** | own V | — | V C | V C E | — | — | — | — | — |
| **Policies** | V (applies to me) | V | V C E | V C E A D | V | V A | — | — | — |
| **Help Desk** | own C V | team V | V C E | V C E D | — | — | queue V E | queue V E | — |
| **Private Cases** | own C | — | — | member only | — | member only | — | — | — |
| **Compliance** | — | — | V | V C E | V | V C E | — | V | shared only |
| **Health Check** | — | team V | V | V | V | V | — | V | — |
| **Reports** | — | team | V X | V X | V X | V X | — | V | — |
| **Privacy** (notices, requests, retention, breaches) | own | — | V | V C E | — | V C E | — | — | — |
| **Custom Fields** / **Forms** | — | — | V | V C E D | — | — | — | — | — |
| **AI Controls** | — | — | — | V | V E (owner) | V | — | — | — |
| **External Audit** (grant and view) | — | — | — | C | C | C | — | — | V (granted) |
| Employee Notes (exists) | — | — | V C E | V C E D | — | — | — | — | — |

Rules:
- "team" = people whose reporting line (current or dotted) reaches the viewer, resolved server-side (`services/people/scope.ts`); today no such scope exists on admin routes, so every "team" cell is new work (PC-ACC-01).
- Private cases: membership, not role, grants access (PRIV-01). `PEOPLE::Private Cases::VIEW` only lets a user see the list of cases they are a member of.
- Document access = `classification` ∩ role: EMPLOYEE_VISIBLE to the person and Documents V; HR_ONLY to Documents V; RESTRICTED to Documents E; CONFIDENTIAL to Confidential Documents V (R-01 fix).
- Reveal of statutory values needs `Statutory Details::VIEW` + step-up (`requireStepUp`, `server/src/services/stepUp.ts`) + writes `AccessLog`.
- Presets to add: COMPLIANCE_OFFICER, IT_ADMIN, EXTERNAL_AUDITOR; HR_MANAGER gets the ATTENDANCE leave VIEW grants it lacks (R-12).

---

## 5. State machines

### 5.1 Person status (per episode)

```
JOINING ──(joining date reached or HR "Mark joined")──▶ ACTIVE (on probation if probationEnd set)
ACTIVE ──(probation CONFIRM)──▶ ACTIVE (confirmedOn set)
ACTIVE ──(resignation APPROVED)──▶ ON_NOTICE ──(lastWorkingDay reached)──▶ LEFT
ACTIVE ──(termination/contract end APPROVED, immediate)──▶ LEFT
LEFT ──(rejoin)──▶ JOINING (new episode, seq+1)
any ──(anonymise, LEFT only)──▶ ANONYMISED (terminal)
```
Guards: LEFT requires an approved `SeparationCase`; ANONYMISED requires status LEFT and the erasure request (existing rule); payroll history blocks delete (existing `employeeLock.ts`).

### 5.2 Scheduled change

```
PENDING ──(job on effectiveOn, once)──▶ APPLIED
PENDING ──(withdraw or request rejected)──▶ CANCELLED
```
`JOB_FIELDS` = designation (`jobPositionId`), department, team, manager, dotted manager, establishment, location, grade, employment type, status, seat. Applying writes the Employee row, `ChangeLog` rows, `EmploymentEvent` (existing history) and an outbox event, in one transaction, keyed by `appliedRunId` for idempotency.

### 5.3 Approval request

```
DRAFT ──submit──▶ WAITING(step 1)
WAITING(n) ──approve──▶ WAITING(n+1) | APPROVED (last step)
WAITING(n) ──reject──▶ REJECTED
WAITING(n) ──ask more──▶ MORE_INFO ──requester replies──▶ WAITING(n)
WAITING(n) ──overdue, REMIND──▶ WAITING(n) (reminder sent, once per day)
WAITING(n) ──overdue, HAND_ON──▶ WAITING(n, new approver; old step HANDED_ON)
WAITING ──requester withdraws──▶ WITHDRAWN
APPROVED ──effect──▶ (ScheduledChange PENDING | immediate apply | policy PUBLISHED | separation APPROVED)
```
Rules: approver resolution happens when the step opens (manager as of that day; stand-in substitution; self = SKIPPED). Rule version is pinned at submit. Idempotency key `(orgId, idempotencyKey)` on create.

### 5.4 Help request, private case, policy version, obligation

```
Desk:   OPEN ⇄ WAITING_EMPLOYEE ──resolve──▶ RESOLVED ──reopen ≤7d──▶ REOPENED ──▶ RESOLVED ; any ──move──▶ MOVED (terminal)
Case:   RECEIVED ──▶ INQUIRY ──▶ REPORT_DUE ──▶ CLOSED
Policy: DRAFT ──submit──▶ WAITING ──approve──▶ PUBLISHED ──new version published or retire──▶ RETIRED
Oblig.: UPCOMING ──(dueOn-7d)──▶ DUE ──(dueOn passed)──▶ OVERDUE ; DUE|OVERDUE ──proof added──▶ DONE ──owner checks──▶ CHECKED
Invite: SENT ──link opened──▶ STARTED ──submit──▶ RETURNED ──HR checks──▶ CHECKED ; SENT|STARTED ──14d──▶ EXPIRED
```

---

## 6. API

All under `/api/orgs/:orgId/people`, behind `requireAuth` + `requireTenantContext` + `peopleRouteOk` + `can(action, resource)`. JSON bodies validated with zod (as `routes/people.ts` does). Errors: `{ error: string, code?: string }` in plain words. List endpoints take `?q&page&pageSize(≤200)&sort&asOf=YYYY-MM-DD` and return `{ items, total, page }`.

| Method and path | Permission | Body / notes | Req |
|---|---|---|---|
| `GET /employees` | Employees V | adds `asOf`, paging, saved-view filters | CORE-01, FND-03 |
| `POST /employees` | Employees C | one service `employees.create` | FND-08 |
| `PUT /employees/:id` | Employees E | fields; JOB_FIELDS with `effectiveOn` in the future create a ScheduledChange (or an ApprovalRequest when a rule exists) | FND-02 |
| `GET /employees/:id?asOf=` | Employees V (or own) | profile tabs assembled server-side by permission | CORE-05 |
| `GET /employees/:id/timeline` | Employees V (or own) | episodes, events, each with `whyId` | CORE-06 |
| `GET /employees/:id/statutory` | Statutory Details V | masked | CORE-04 |
| `POST /employees/:id/statutory/reveal` | Statutory Details V + step-up | `{ field }` → value; writes AccessLog | CORE-04 |
| `POST /employees/import/preview` · `POST /employees/import` · `POST /employees/import/:batchId/undo` | Employees C | mapping, update mode, undo ≤24h | CORE-07 |
| `POST /employees/bulk` | Employees E | `{ ids, field, value, effectiveOn?, reason }` one correlation id | CORE-01 |
| `GET/POST/PUT /custom-fields` · `PUT /employees/:id/custom-fields` | Custom Fields; Employees E | | CORE-08 |
| `GET/POST/PUT /legal-entities` · `/establishments` · `/teams` · `/seats` | Org Structure | | ORG-01, ORG-04 |
| `GET /org-chart?asOf=` | Org Structure V | | ORG-02, ORG-03 |
| `POST /invites` · `GET /invites` · `POST /invites/:id/check` | Lifecycle C/V/E | token route for the joiner: `POST /api/people/join/:token` (outsideTenant lookup, then `enterTenant`) | LIFE-01 |
| `GET /plans?kind&status&owner=me` · `PUT /plans/:id/tasks/:taskId` | Lifecycle; own tasks | task done / not needed, note | LIFE-02, LIFE-07 |
| `POST /changes` · `GET /changes` · `GET /changes/:id/impact` | Lifecycle C/V | `{ employeeId, type, fields:{...}, effectiveOn, reason }`; impact returns rules, policies, holiday lists that differ, and apps to be told | LIFE-04, COMP-04 |
| `POST /probation/:employeeId/review` · `POST /probation/:employeeId/decide` | Lifecycle E / A | | LIFE-03 |
| `POST /leaving` · `PUT /leaving/:id` · `POST /leaving/:id/withdraw` | Lifecycle C/E (employee may POST own resignation) | | LIFE-05 |
| `POST /employees/:id/rejoin` | Employees C | `{ rejoinDate }` required | LIFE-06 |
| `GET/POST/PUT /approval-rules` | Approvals | versioned | APR-02 |
| `GET /requests?mine|waiting-for-me` · `POST /requests` · `POST /requests/:id/{approve,reject,more-info,withdraw}` | Requests | `Idempotency-Key` header required on POST /requests | APR-01..07 |
| `GET/POST/DELETE /stand-ins` | Requests (own) | | APR-04 |
| `GET/POST /documents` · `GET /documents/:id/link` · `POST /documents/:id/replace` · `POST /documents/:id/ask-to-read` | Documents by classification | link = 5-min signed URL or inline data when no object storage | DOC-01..06 |
| `GET/POST/PUT /letter-templates` · `POST /employees/:id/letters` | Letters | `{ kind, templateVersion?, fields }` → PDF document | DOC-04 |
| `GET/POST /policies` · `POST /policies/:id/versions` · `POST /policies/:id/versions/:v/submit` · `GET /policies/mine` | Policies | | POL-01..06 |
| `GET/POST /desk` · `POST /desk/:id/messages` · `POST /desk/:id/{assign,resolve,reopen,move-to-case}` | Help Desk | employee endpoints only see non-internal messages | DESK-01..06 |
| `GET/POST /private-cases` · `GET /private-cases/:id` · `POST /private-cases/:id/{evidence,members,status}` | Private Cases + membership | 404 (not 403) for non-members | PRIV-01..05 |
| `GET/PUT /committee` | Private Cases (HR head) | warnings computed | PRIV-06 |
| `GET /compliance/rules` · `POST /compliance/rules/:ruleId/versions` · `POST /compliance/rules/:ruleId/versions/:v/check` | Compliance | | COMP-01, COMP-05 |
| `GET /compliance/obligations?month` · `PUT /compliance/obligations/:id` | Compliance | proof doc ids | COMP-02, COMP-03 |
| `GET /compliance/registers/:kind?establishmentId` | Compliance V | CSV/XLSX | COMP-06 |
| `GET /health` · `POST /health/:itemId/snooze` | Health Check | | HLTH-01..04 |
| `GET /why/:kind/:id` | by the underlying object's permission | kind = change, request, task, obligation, health; returns section 8.3 shape | TRACE-01..05 |
| `POST /why/:kind/:id/correction` | Requests | opens a PROFILE_CHANGE/JOB_CHANGE request or a desk request pre-filled | TRACE-03 |
| `GET /reports/:name?asOf&format` | Reports | | RPT-01..03 |
| `GET/PUT /privacy/retention` · `GET /privacy/deletion-review` · `POST /privacy/deletion-review/:id/decide` | Privacy | | PRV-03 |
| `GET /access-log?employeeId&month` | Privacy V | | PRV-07 |
| `POST /audit-grants` · token route `GET /api/people/audit/:token/evidence` | External Audit | | PRV-06 |
| `GET/PUT /ai/settings` · `GET /ai/log` | AI Controls | owner only for `enabled` | AIG-01..03 |

Employee self-service endpoints live under `/api/portal/people/*` (existing portal JWT, `routes/portal.ts:165-194`): `GET me`, `POST me/change-request`, `GET me/requests`, `GET me/documents`, `GET me/timeline`, `POST desk`, `GET policies`, `POST acknowledgements/:id/accept`, `POST private-cases`. These are People routes mounted on the portal router; no portal (shared module) code changes.

---

## 7. Events

Written to `OutboxEvent` in the same transaction as the change; delivered by `outboxWorker` (lease `people-outbox`, every 5 s, batches of 50, back-off 1, 5, 30, 120, 720 min, then parked with `lastError`). Consumers: the existing webhook sender (`services/attendance/webhooks.ts`, which gets a `people.*.v1` passthrough), Attendance and Payroll in-process handlers (idempotent on `eventId`), and later a queue.

Envelope:
```json
{ "eventId": "cuid", "name": "people.employee.transferred.v1", "version": 1,
  "accountId": "...", "orgId": "...", "employeeId": "...",
  "occurredAt": "2026-12-01T00:00:05Z", "correlationId": "...",
  "data": { } }
```

| Name | When | `data` |
|---|---|---|
| `people.employee.created.v1` | create (any path) | employee summary (id, code, name, joiningDate, establishmentId, departmentId, jobPositionId, managerId, employmentType) |
| `people.employee.updated.v1` | non-job field change | `{ fields: [..], changeLogIds }` |
| `people.employment.changed.v1` | job field applied (scheduled or immediate) | `{ field, before, after, effectiveOn, decisionId }` |
| `people.employee.transferred.v1` | establishment or location applied | `{ fromEstablishmentId, toEstablishmentId, fromState, toState, effectiveOn }` |
| `people.employee.probation_confirmed.v1` | probation CONFIRM | `{ confirmedOn }` |
| `people.employee.separation_scheduled.v1` | separation approved | `{ lastWorkingDay, type, noticeStart }` |
| `people.employee.separated.v1` | last working day reached | `{ lastWorkingDay, type, settlementRequested: true }` |
| `people.employee.rejoined.v1` | rejoin | `{ episodeSeq, rejoinDate }` |
| `people.policy.published.v1` | policy version published | `{ policyId, version, category, effectiveFrom, appliesTo }` |
| `people.document.expiring.v1` | 60/30/7/0 days | `{ documentId, kind, expiresOn, daysLeft }` |
| `people.obligation.due.v1` | obligation becomes DUE or OVERDUE | `{ obligationId, ruleId, dueOn, status }` |

Consumed by People (idempotent on eventId, logged in `ChangeLog` with source SYSTEM): `attendance.period.finalized.v1`, `attendance.exception.resolved.v1`, `payroll.run.finalized.v1`, `payroll.variance.detected.v1`. These names are the contract Attendance and Payroll will publish; until they do, People's handlers are registered and idle.

---

## 8. UI contract

### 8.1 Manifest

`apps/people/manifest.jsx`: `modules` per [04 §3.1](04-WORDS-AND-MENUS.md); every nav item carries `permission` (section 4), `feature` (module switch) and `parent: 'settings'` where it belongs to the hub. `palette` and `iconSet` per D-01 (today `blaze` + `color`; stays until decided). Remove the People CSS override block `packages/ui/src/index.css:6535-6785` (PC-UI-01) so People renders on the base scale like Accounting.

### 8.2 Components (new, in `apps/people/src/components/`, built from `packages/ui` parts)

| Component | Built from | Used by |
|---|---|---|
| `EmployeeProfileHeader` | `PageHeader`, `StatusPill` | Profile |
| `Timeline` | list rows grouped by episode; each row has a `WhyLink` | Profile › Timeline, Me › My timeline |
| `ChangeComparison` | two-column `FormSection`, "Now / From <date>" | Start a change, Why? |
| `WhyPanel` | `Drawer` | everywhere (`GET /why/:kind/:id`) |
| `ApprovalSteps` | vertical list with `StatusPill` per step | Requests, Why? |
| `EvidenceList` | document rows with classification pill | Why?, Compliance, Private case |
| `CaseThread` | messages; "Internal note" tab hidden from employee role | Help desk, Private case |
| `SensitiveReveal` | masked value + "Show" → step-up dialog | Statutory tab |
| `PlanBoard` | columns by stage; list toggle | Joining |
| `ImpactList` | bullet list with target pill (task, told to Payroll, review) | Start a change |
| `RuleBuilder` | ordered steps, each a `FormSection` | Approval rules |

Shared parts used as they are: `PageHeader`, `StatusPill`, `EmptyState`, `Drawer`, `Modal`, `FormSection`, `DocumentListShell`, `StatusTabs`, `ListSearch`, `Pagination`, `ExportButton`, `MasterFormPage`, `SettingsHub`. No new layout code outside these components.

### 8.3 Why? panel shape (`GET /why/:kind/:id`)

```json
{ "title": "Why is Meera's office Pune?",
  "changed": { "field": "Office", "before": "Bengaluru", "after": "Pune", "effectiveOn": "2026-12-01" },
  "askedBy": { "user": "...", "at": "...", "reason": "..." },
  "approvals": [ { "user": "...", "at": "...", "status": "APPROVED", "rule": "Transfers", "ruleVersion": 3 } ],
  "rulesUsed": [ { "kind": "POLICY", "id": "...", "title": "MH staff leave", "version": 2 } ],
  "evidence": [ { "documentId": "...", "title": "Transfer letter", "classification": "HR_ONLY" } ],
  "caused": [ { "kind": "TASK", "id": "...", "title": "Holiday list", "status": "DONE" }, { "kind": "EVENT", "name": "people.employee.transferred.v1", "deliveredAt": "..." } ],
  "unknown": [ "No approval recorded: changed before history started on 22 Oct 2026" ],
  "actions": [ "ASK_HR", "RAISE_CORRECTION" ] }
```
Items the viewer may not see are dropped server-side and counted in `"hidden": n`, so the panel can say "1 item you can't see".

### 8.4 Screen acceptance (every screen, from `DESIGN.md` Screen Contract + PRD NFR-05)

1. `PageHeader` with title, one primary action top right, secondary in ⋮.
2. Back control when reached from another screen.
3. Tokens only; no `bg-gray-*` etc.; two radii; no Tailwind shadow utilities; nothing under 12px.
4. Fields use `.ui-input` / `.ui-select` with no local sizing.
5. Status pills carry the exact words from 04 §5.
6. States: loading skeleton, empty (text from 04 §6), error with retry, no-permission, offline.
7. Keyboard: tab order follows reading order; lists use `useListboxKeys`; dialogs trap focus.
8. 375 px: employee and manager screens usable; admin screens may scroll horizontally in their own container.
9. Every changed value and request outcome shows a `WhyLink`.
10. Money (only when shown from Payroll) tabular, right-aligned in columns.

Checked by `test/design-rules.test.js` (static) plus one browser pass per screen recorded in `docs/people/evidence/<ID>/`.

---

## 9. Interfaces People needs from other apps (not built here)

Owner decided (24 Oct 2026) that shared modules and other apps are fixed separately. People is built so each interface can be absent; the UI then says what is missing (TRACE-04).

| Id | From | What People needs | Shape | Today |
|---|---|---|---|---|
| PI-01 | Payroll | Read a person's payslip explanation for a period, filtered by the caller's permission | `GET /api/orgs/:orgId/payroll/slips/:id` + `PayrollCalculationTrace` rows (`routes/payrollSlips.ts:210-232`) | Exists; People will call it, not `payrollPrisma` |
| PI-02 | Payroll | Event `payroll.run.finalized.v1`, `payroll.variance.detected.v1` | section 7 | Missing |
| PI-03 | Payroll | Accept a final-settlement request from `people.employee.separated.v1` | consumer | Missing (settlement is created by hand today) |
| PI-04 | Payroll | Read averages per grade for Team plan (P1) | new read | Missing |
| AI-01 | Attendance | Read finalised attendance facts and exceptions for a person and period | `services/attendance/explain.ts` as an HTTP read | Exists in-process; no HTTP read for People |
| AI-02 | Attendance | Open a correction request with context | existing `/attendance/requests` | Exists |
| AI-03 | Attendance | Events `attendance.period.finalized.v1`, `attendance.exception.resolved.v1` | section 7 | Missing |
| AI-04 | Attendance | Holiday list ids and names (for Establishment) | read | Exists (holidays route) |
| SH-01 | Shared leave | Balance explanation with rule used (for Why? on a balance) | `leaveBalances.ts` output | Exists; no "rule used" field |
| PL-01 | Platform | Audit history link for People's share (ADR-010) | exists | Exists |

---

## 10. Jobs

| Job | Lease | Every | Does | Idempotency |
|---|---|---|---|---|
| `people-outbox` | yes | 5 s | delivers OutboxEvent | eventId |
| `people-scheduled-changes` | yes | 10 min | applies PENDING changes with `effectiveOn ≤ today` (company local date) | appliedRunId |
| `people-plan-dues` | yes | 1 h | marks overdue tasks, reminds owners | (dedupe by task+day) |
| `people-approval-dues` | yes | 15 min | reminders and hand-on per rule | step id + action |
| `people-document-expiry` | yes | daily | 60/30/7/0 reminders, events | document + threshold |
| `people-obligations` | yes | daily | computes obligations for the next 3 months from rules × establishments | (ruleId, version, establishmentId, dueOn) unique |
| `people-retention` | yes | daily | fills DeletionReview | dataType + entityId |
| `people-anonymise-sweep` | yes | weekly | verifies no PII remains for ANONYMISED people | report only |

All jobs run under `outsideTenant('job: <name>')` to list companies, then `runInTenant(orgId)` per company.

---

## 11. Security specifics

- Private case bodies and evidence: AES-256-GCM with a key from `PEOPLE_CASE_KEY` (D-09: KMS vs env). Key rotation re-encrypts in a job.
- Statutory values stay in Payroll (bank, PAN) or in `Employee` masked columns; reveal through one function that logs.
- Object storage (D-03): private bucket, server-side encryption, 5-minute signed GET, upload via server (never a browser-direct put in P0), malware check hook before `scanStatus = CLEAN`.
- Invite and auditor tokens: 32 random bytes, stored hashed, single use (invite) or time-boxed (auditor), looked up with `outsideTenant` then `enterTenant`.
- No impersonation: support access is a time-boxed grant visible to the company (existing platform pattern, ADR-010).
- Imports: preview first; commit writes under one correlation id; undo within 24 h; reconciliation report (counts in, created, updated, skipped, errors).

---

## 12. Testing hooks

- Every service exports pure functions testable without HTTP where possible (`effectiveDating.applyDue(now)`, `approvals.resolveApprover(step, context)`, `compliance.computeObligations(rules, establishments, month)`).
- `server/src/__tests__/people/` groups: `rls`, `foundations`, `lifecycle`, `approvals`, `desk`, `privateCases`, `policies`, `documents`, `compliance`, `privacy`, `why`, `ai`.
- Synthetic workforce generator at `server/src/__tests__/fixtures/syntheticWorkforce.ts` (07 TEST-GEN).
- Browser checks via the in-app browser against the dev server; evidence under `docs/people/evidence/<ID>/`.
