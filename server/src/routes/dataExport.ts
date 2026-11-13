// bounded-file: a company export is every row of its own data, by design (see the note on the router below).
import { Router } from 'express';
import { hasValidStepUp } from '../services/stepUp.js';
import { payrollStepUpOn } from '../services/policy.js';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { Prisma as PeoplePrisma } from '../generated/people/index.js';
import { Prisma as PayrollPrisma } from '../generated/payroll/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { recordAudit } from '../services/auditTrail.js';
import { docAccess, docOpens, type DocAccess } from '../services/people/documentAccess.js';
import { maskTail } from '../services/people/identifiers.js';
import { levelFor, resolveAccess } from '../services/access.js';
import { seesPersonal, teamScope } from '../services/people/scope.js';
import { WORKSPACE } from '../services/people/workspace.js';

/**
 * A company's own books and its own settings, in files its owner can keep.
 *
 * Two scopes, because they are two different things with two different uses.
 *
 * **Data** is what the business did: parties, documents, payments, the ledger.
 * It is large, it only grows, and restoring it into a company that already has
 * some is genuinely hard.
 *
 * **Configuration** is how the company is set up: branches, the chart of
 * accounts, numbering series, roles and permissions, tax rates, approval rules,
 * the reference lists. It is small, it changes rarely, and it is the thing you
 * want when somebody has broken the invoice numbering, or when a practice is
 * setting up its eleventh client company the way it set up the tenth.
 *
 * Asking for both in one file would mean a config restore had to carry a year
 * of invoices with it, which is why they are separate.
 *
 * Not the same thing as the server backup, and the difference matters. The
 * SQLite backup is an operator's tool: it is the whole multi-tenant database,
 * every customer's books in one file, and no customer should ever be handed
 * one. This is the other thing — one company's own data, for the people whose
 * data it is.
 *
 * Which is also why it is worth having beyond convenience: a customer who
 * cannot get their books out is a customer who is locked in, and under the DPDP
 * Act a data principal is entitled to their data in a portable form.
 *
 * bounded-file: every read here is deliberately unbounded.
 *
 * This is the company's own copy of its own books, so a page of it would be the
 * wrong answer rather than a partial one — a backup missing the invoices after
 * row 500 is not a backup. The limit that matters here is not a row count, it
 * is the org filter on every query below.
 *
 * Scoped to the active org throughout. The one defect that would matter here is
 * one company's export containing another's, so every query is filtered by
 * account and org, and a test asserts a second company's rows never appear.
 */
export const dataExportRouter = Router();
dataExportRouter.use(requireAuth, requireTenantContext);

/*
 * Gated on Company Profile rather than on a document permission. Taking a copy
 * of everything the company holds is an owner's act, not a clerk's — somebody
 * who may raise invoices should not thereby be able to walk out with the
 * customer list.
 */
const EXPORT = requirePermission('SETTINGS', PermissionAction.EXPORT, 'Company data');

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Decimal columns come back as objects; a file should hold numbers. */
/*
 * People, Attendance and Payroll: every model that belongs to a company, by
 * schema rather than by a list that would fall behind the schema. Heavy raw
 * data is left out — punches as the readers sent them, reader logs, selfies,
 * fingerprint and face templates — the attendance days built from them are
 * in. Anything that looks like a secret (a hash, a token, an encrypted
 * value) is dropped from every row.
 */
const HEAVY = new Set(['DevicePunch', 'DeviceLog', 'PunchPhoto', 'BiometricTemplate', 'WebhookDelivery', 'ApiIdempotency', 'DeviceCommand', 'UnclaimedReader', 'HrOutbox', 'HrSyncLog']);
/* Private cases are never exported (PRIV-04; POSH Act s.16): not even encrypted, not even counts. */
const PRIVATE = new Set(['PrivateCase', 'PrivateCaseMember', 'PrivateCaseEvidence', 'PrivateCaseAccess', 'CommitteeSetup']);
const SECRETISH = /hash|secret|token|passwordenc|enc$|salt|apikey/i;
const scrub = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRETISH.test(k))));

/*
 * What you may see in the app is what you may take out of it, table by table (review of #154, 8 Nov 2026).
 * A person's identifiers, wherever they sit (a column, or inside a JSON value such as a joiner's statutory form or
 * a recycle-bin snapshot), leave in full only to who could reveal them; everybody else gets the tail. An employee
 * file leaves only if the reader could open it (documentAccess.ts): HR-only and confidential files, and their
 * titles, stay behind.
 */
const PAN_BANK_KEYS = new Set(['pan', 'landlordPan', 'bankAccountNumber', 'bankAccount', 'accountNumber', 'newAccountNumber', 'oldAccountNumber']);
const ID_KEYS = new Set(['uan', 'esiNumber', 'esicNumber', 'esic', 'pfNumber', 'passportNumber', 'workPermitNumber', 'aadhaar', 'aadhaarNumber']);

/*
 * Each People table leaves with the grant its own screens are opened by (VIEW unless said). A table not named here
 * is HR's working data and leaves only with Employees EDIT; private cases never leave (PRIVATE above).
 */
const P = (resource: string, action = 'VIEW') => `PEOPLE::${resource}::${action}`;
const T = (resource: string) => `ATTENDANCE::${resource}::VIEW`;
const TABLE_GRANT: Record<string, string> = {
  ...Object.fromEntries(['Employee', 'EmployeeType', 'WorkType', 'EmployeeTag', 'EmployeeTagLink', 'CustomFieldDef', 'CustomFieldValue', 'EmploymentEvent', 'EmploymentEpisode', 'ChangeLog', 'PeopleSetting', 'LegalEntity', 'Establishment', 'CelebrationOptOut', 'Obligation', 'ComplianceRule', 'ComplianceTask', 'ObligationProof'].map((m) => [m, P('Employees')])),
  ...Object.fromEntries(['Department', 'JobPosition', 'JobRole', 'Team', 'Seat', 'BusinessUnit', 'Grade', 'CostCenter'].map((m) => [m, P('Org Structure')])),
  EmployeeNote: P('Employee Notes'),
  EmployeeDocument: P('Documents'),
  LetterTemplate: P('Documents'),
  ...Object.fromEntries(['EmployeeIdentity', 'JoinStatutory'].map((m) => [m, P('Statutory Details')])),
  ...Object.fromEntries(['ApprovalRule', 'ApprovalRequest', 'ApprovalStep', 'StandIn', 'ApprovalStandIn', 'DecisionRecord', 'RequestForm', 'RequestFormFile', 'ScheduledChange'].map((m) => [m, P('Requests')])),
  ...Object.fromEntries(['ProbationReview', 'JoinInvite', 'ChecklistTemplate', 'ChecklistTask', 'ClearanceLine', 'ExitInterview', 'AbsenceCase', 'AbsenceNotice', 'NightWorkConsent'].map((m) => [m, P('Lifecycle')])),
  ...Object.fromEntries(['Policy', 'PolicyVersion', 'Acknowledgement'].map((m) => [m, P('Policies')])),
  ...Object.fromEntries(['RetentionRule', 'DeletionReview', 'AuditorGrant', 'DataRequest', 'DataBreach', 'AccessLog'].map((m) => [m, P('Privacy')])),
  ...Object.fromEntries(['DeskCategory', 'DeskRequest', 'DeskMessage', 'DeskTemplate'].map((m) => [m, P('HR Cases')])),
  ...Object.fromEntries(['JobOpening', 'Candidate', 'Referral', 'ReferralLink', 'CandidateEvent', 'Interview', 'InterviewFeedback', 'Offer'].map((m) => [m, P('Recruitment')])),
  ...Object.fromEntries(['Goal', 'GoalCheckIn', 'ReviewCycle', 'Review', 'ImprovementPlan', 'TalentNote', 'OneOnOne'].map((m) => [m, P('Performance')])),
  ...Object.fromEntries(['Training', 'TrainingSeat'].map((m) => [m, P('Learning')])),
  ...Object.fromEntries(['ExpenseCategory', 'ExpenseBill', 'ExpenseClaim', 'ExpenseLine', 'EmployeeAdvance', 'SalaryAdvanceAsk'].map((m) => [m, P('Expenses')])),
  ...Object.fromEntries(['GreetingPost', 'EngagementSettings'].map((m) => [m, P('Announcements')])),
  ...Object.fromEntries(['AttendanceRecord', 'AttendanceActivity', 'AttendanceRecordHistory', 'AttendanceMonthSnapshot', 'AttendanceExceptionState', 'AttendanceMonthLock', 'AttendanceMonthConfirmation', 'AttendancePenalty', 'AttendanceNudge', 'PhonePunchAttempt', 'ReaderEvent', 'IngestRun', 'Area', 'Contractor', 'AttendanceSettings', 'AttendanceRuleVersion'].map((m) => [m, T('Attendance Records')])),
  ...Object.fromEntries(['AttendanceRequest', 'OvertimeRequest'].map((m) => [m, T('Attendance Requests')])),
  ...Object.fromEntries(['Shift', 'ShiftAssignment', 'TemporarySchedule', 'DepartmentSchedule', 'ShiftRotation', 'RotationAssignment', 'ShiftSwap', 'Geofence'].map((m) => [m, T('Shifts')])),
  ...Object.fromEntries(['Holiday', 'HolidayPick'].map((m) => [m, T('Holidays')])),
  ...Object.fromEntries(['LeaveType', 'LeaveBlock', 'LeaveYearEnd'].map((m) => [m, T('Leave Types')])),
  ...Object.fromEntries(['LeaveAllocation', 'LeaveAdjustment', 'LeaveRequest'].map((m) => [m, T('Leave Requests')])),
  ...Object.fromEntries(['AttendanceDevice', 'DeviceUser', 'ReaderIdAtSite', 'ReaderAlert', 'SiteAgent', 'AgentJob'].map((m) => [m, T('Attendance Devices')])),
  ...Object.fromEntries(['ApiClient', 'Webhook', 'HrConnection', 'OutboxEvent'].map((m) => [m, T('Attendance Integrations')])),
  ...Object.fromEntries(['PortalSession', 'AppAccessSend'].map((m) => [m, T('Employee Portal')])),
  /* Opened per register below (services/people/workspace.ts): the register's own grant. */
  PeopleRecord: P('Employees'),
};
export const tableGrant = (model: string) => TABLE_GRANT[model] ?? P('Employees', 'EDIT');
/* A person's private details (routes/people.ts PERSONAL_FIELDS), and the reason they left: for who keeps the records (seesPersonal). */
const PERSONAL_KEYS = ['dateOfBirth', 'maritalStatus', 'guardianName', 'email', 'personalEmail', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'notes', 'cardNumber', 'leavingReason'];
const PERSONAL_SET = new Set(PERSONAL_KEYS);
/* Files kept against a compliance deadline carry Payroll's figures (peopleCompliance.ts proofFile). */
const BLOB_OF: Record<string, string> = { ObligationProof: 'data', ComplianceTask: 'evidenceData' };
/* The company's own PAN is not a person's identifier. */
const COMPANY_MODELS = new Set(['LegalEntity']);
export type ExportReveal = { panBank: boolean; ids: boolean };
const maskDeep = (v: unknown, reveal: ExportReveal): unknown => {
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, reveal));
  if (!v || typeof v !== 'object' || v instanceof Date || ArrayBuffer.isView(v) || typeof (v as any).toFixed === 'function') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const masked = (PAN_BANK_KEYS.has(k) && !reveal.panBank) || (ID_KEYS.has(k) && !reveal.ids);
    out[k] = masked && (typeof x === 'string' || typeof x === 'number') ? maskTail(String(x)) || null : maskDeep(x, reveal);
  }
  return out;
};
type RowRule = {
  reveal: ExportReveal;
  docs?: DocAccess;
  /* People only: may this table leave at all; does a person's private detail leave; does a compliance file leave. */
  opens?: (model: string) => boolean;
  holds?: (key: string) => boolean;
  personal?: boolean;
  blobs?: boolean;
};
const docOfSnapshot = (snapshot: unknown) => {
  const row = (snapshot as any)?.row || {};
  return { classification: row.classification ?? null, kind: row.kind ?? null, employeeId: row.employeeId ?? null };
};
function shapeRows(model: string, rows: any[], rule: RowRule) {
  let kept = rows;
  if (model === 'PeopleRecord' && rule.holds) kept = kept.filter((r) => {
    const resource = (WORKSPACE as Record<string, { resource: string }>)[r.kind]?.resource;
    return Boolean(resource) && rule.holds!(P(resource!));
  });
  if (rule.personal === false) {
    if (model === 'Employee') kept = kept.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !PERSONAL_SET.has(k))));
    if (model === 'ChangeLog') kept = kept.map((l) => (l.entity === 'Employee' && PERSONAL_SET.has(l.field) ? { ...l, before: null, after: null, redacted: true } : l));
    if (model === 'EmploymentEvent' || model === 'EmploymentEpisode') kept = kept.map((r) => ('endReason' in r ? { ...r, endReason: null } : r.kind === 'LEFT' ? { ...r, note: null } : r));
    if (model === 'DeletedItem') kept = kept.map((d) => (d.kind === 'employee' ? { ...d, snapshot: null } : d));
  }
  if (rule.blobs === false && BLOB_OF[model]) kept = kept.map((r) => ({ ...r, [BLOB_OF[model]]: null }));
  if (rule.docs && model === 'EmployeeDocument') kept = kept.filter((d) => docOpens(rule.docs!, d));
  if (rule.docs && model === 'DeletedItem') kept = kept.filter((d) => d.kind !== 'employeeDocument' || docOpens(rule.docs!, docOfSnapshot(d.snapshot)));
  /* A file's lines in the change log name it; its classification and kind ride on the same change (routes/people.ts), as Activity reads them. */
  if (rule.docs && model === 'ChangeLog') {
    const docs = rule.docs;
    const groupOf = (l: any) => `${l.correlationId}:${l.entityId}`;
    type Meta = { classification?: string; kind?: string; employeeId?: string };
    const meta = new Map<string, Meta>();
    for (const l of kept) {
      if (l.entity !== 'EmployeeDocument') continue;
      const m: Meta = meta.get(groupOf(l)) || { employeeId: l.employeeId };
      if (l.field === 'document.classification') m.classification = l.before ?? l.after;
      if (l.field === 'document.kind') m.kind = l.before ?? l.after;
      meta.set(groupOf(l), m);
    }
    /* A line from before classifications were written opens only for who opens every class. */
    const everything = (['EMPLOYEE_VISIBLE', 'HR_ONLY', 'RESTRICTED', 'CONFIDENTIAL'] as const).every((c) => docs.classes.includes(c));
    kept = kept.filter((l) => {
      if (l.entity !== 'EmployeeDocument') return true;
      const m = meta.get(groupOf(l))!;
      return m.classification ? docOpens(docs, m as any) : everything;
    });
  }
  if (COMPANY_MODELS.has(model) || (rule.reveal.panBank && rule.reveal.ids)) return kept;
  return kept.map((r) => maskDeep(r, rule.reveal));
}

async function exportDomain(client: any, dmmf: { datamodel: { models: Array<{ name: string; fields: Array<{ name: string }> }> } }, prefix: string, scope: { orgId: string }, rule: RowRule) {
  const out: Record<string, any[]> = {};
  for (const m of dmmf.datamodel.models) {
    if (HEAVY.has(m.name) || PRIVATE.has(m.name) || !m.fields.some((f) => f.name === 'orgId')) continue;
    if (rule.opens && !rule.opens(m.name)) continue;
    const key = m.name.charAt(0).toLowerCase() + m.name.slice(1);
    const delegate = client[key];
    if (!delegate?.findMany) continue;
    out[`${prefix}.${key}`] = shapeRows(m.name, scrub(await delegate.findMany({ where: { orgId: scope.orgId } })), rule);
  }
  return out;
}

const plain = (rows: any[]): any[] =>
  rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v && typeof v === 'object' && typeof (v as any).toFixed === 'function') out[k] = num(v);
      else if (v instanceof Date) out[k] = v.toISOString();
      else out[k] = v;
    }
    return out;
  });

dataExportRouter.get('/orgs/:orgId/export', EXPORT, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const { accountId, orgId } = req.tenant!;
  const scope = { accountId, orgId };

  /*
   * `data`, `configuration`, or both. Defaulting to both keeps the plain
   * /export URL meaning what it did before this was split.
   */
  const asked = String(req.query.scope || 'all').toLowerCase();
  const wantData = asked === 'all' || asked === 'data';
  const wantConfiguration = asked === 'all' || asked === 'configuration';
  if (!wantData && !wantConfiguration) {
    return res.status(400).json({ error: "scope must be 'data', 'configuration' or 'all'" });
  }

  const org = await platformPrisma.org.findFirst({
    where: { id: orgId, accountId },
    select: { id: true, name: true, slug: true, profileJson: true },
  });
  if (!org) return res.status(404).json({ error: 'Company not found' });

  /*
   * Secrets are stripped, not exported.
   *
   * The email and e-invoice settings carry encrypted passwords and client
   * secrets. Configuration is meant to be readable, copied between companies
   * and stored where a customer keeps files — none of which is anywhere a
   * credential should be, even an encrypted one.
   */
  const SECRET_FIELDS = ['passwordEnc', 'clientSecretEnc', 'publicKeyPem'];
  const withoutSecrets = (rows: any[]) =>
    rows.map((r) => {
      const out: Record<string, unknown> = { ...r };
      for (const f of SECRET_FIELDS) delete out[f];
      return out;
    });

  const data: Record<string, any[]> = {};
  const configuration: Record<string, any[]> = {};

  if (wantData) {
    const [
      parties, partyAddresses, partyContacts, items,
      invoices, bills, estimates, salesOrders, purchaseOrders, deliveryChallans,
      creditNotes, debitNotes, expenses, payments, paymentAllocations,
      journals, journalEntries, journalLines, salesmen, fixedAssets, bankBook, posDayCloses,
    ] = await Promise.all([
      prisma.party.findMany({ where: scope }),
      prisma.partyAddress.findMany({ where: scope }),
      prisma.partyContact.findMany({ where: scope }),
      prisma.itemMaster.findMany({ where: scope }),
      prisma.invoice.findMany({ where: scope }),
      prisma.bill.findMany({ where: scope }),
      prisma.estimate.findMany({ where: scope }),
      prisma.salesOrderDoc.findMany({ where: scope }),
      prisma.purchaseOrderDoc.findMany({ where: scope }),
      prisma.deliveryChallan.findMany({ where: scope }),
      prisma.creditNote.findMany({ where: scope }),
      prisma.debitNote.findMany({ where: scope }),
      prisma.expense.findMany({ where: scope }),
      prisma.payment.findMany({ where: scope }),
      prisma.paymentAllocation.findMany({ where: scope }),
      prisma.journal.findMany({ where: scope }),
      prisma.journalEntry.findMany({ where: scope }),
      prisma.journalLine.findMany({ where: { entry: scope } }),
      prisma.salesman.findMany({ where: scope }),
      prisma.fixedAsset.findMany({ where: scope }),
      prisma.bankBookEntry.findMany({ where: scope }),
      // The till counts. A backup that leaves out the cash controls is not a
      // backup of the business's books.
      prisma.posDayClose.findMany({ where: scope }),
    ]);
    Object.assign(data, {
      parties, partyAddresses, partyContacts, items,
      invoices, bills, estimates, salesOrders, purchaseOrders, deliveryChallans,
      creditNotes, debitNotes, expenses, payments, paymentAllocations,
      journals, journalEntries, journalLines, salesmen, fixedAssets, bankBook, posDayCloses,
    });
  }

  if (wantConfiguration) {
    const [
      branches, warehouses, ledgerAccounts, masters, numberSeries,
      roles, rolePermissions, featureSettings, approvalRules,
      fiscalYears, emailSettings, einvoiceSettings, recurring,
    ] = await Promise.all([
      platformPrisma.branch.findMany({ where: scope }),
      prisma.warehouse.findMany({ where: scope }),
      prisma.ledgerAccount.findMany({ where: scope }),
      prisma.orgMaster.findMany({ where: scope }),
      prisma.numberSeries.findMany({ where: scope }),
      platformPrisma.role.findMany({ where: scope }),
      platformPrisma.rolePermission.findMany({ where: scope, include: { permission: true } }),
      platformPrisma.featureSetting.findMany({ where: scope }),
      prisma.approvalRule.findMany({ where: scope }),
      prisma.fiscalYear.findMany({ where: scope }),
      platformPrisma.emailSetting.findMany({ where: scope }),
      prisma.eInvoiceSetting.findMany({ where: scope }),
      prisma.recurringSchedule.findMany({ where: scope }),
    ]);
    Object.assign(configuration, {
      companyProfile: [{ id: org.id, name: org.name, handle: org.slug || null, profileJson: org.profileJson || null }],
      branches, warehouses, ledgerAccounts, masters, numberSeries,
      roles, rolePermissions, featureSettings, approvalRules, fiscalYears,
      emailSettings: withoutSecrets(emailSettings),
      einvoiceSettings: withoutSecrets(einvoiceSettings),
      recurringSchedules: recurring,
    });
  }

  /*
   * A-18: what you may see in an app is what you may take out of it. Settings
   * export alone used to hand over every People and Payroll row — bank
   * account numbers, PAN, UAN, salaries, tax declarations and ID documents —
   * to anyone allowed to export the company's configuration. Each domain now
   * needs the permissions that open it, payroll the company's step-up where
   * it asks for one, and every domain of personal data taken is audited.
   */
  const withheld: Array<{ domain: string; reason: string }> = [];
  if (asked === 'data' || asked === 'all') {
    const holds = (k: string) => Boolean(req.isAdmin) || Boolean(req.permissions?.has(k));
    /* A full identifier is for who may reveal one in People: Statutory details and Full identifiers. */
    const fullIds = holds('PEOPLE::Statutory Details::VIEW') && holds('PEOPLE::Full Identifiers::VIEW');
    if (holds('PEOPLE::Employees::VIEW')) {
      const personal = await seesPersonal(req);
      const wholeCompany = (await teamScope(req)).all;
      const people = await exportDomain(peoplePrisma, PeoplePrisma.dmmf as any, 'people', scope, {
        reveal: { panBank: fullIds, ids: fullIds },
        docs: await docAccess(req),
        opens: (model) => holds(tableGrant(model)),
        holds,
        personal,
        blobs: wholeCompany && personal,
      });
      Object.assign(data, people);
      const skipped = PeoplePrisma.dmmf.datamodel.models.filter((m: any) => !HEAVY.has(m.name) && !PRIVATE.has(m.name) && m.fields.some((f: any) => f.name === 'orgId') && !holds(tableGrant(m.name))).length;
      if (skipped) withheld.push({ domain: 'people', reason: `${skipped} People and Attendance ${skipped === 1 ? 'table is' : 'tables are'} not open to your roles, so ${skipped === 1 ? 'it was' : 'they were'} left out.` });
      await recordAudit(req, { entity: 'Company', entityId: orgId, action: 'EXPORT_PEOPLE', message: 'Exported People and Attendance records (personal data)' });
    } else {
      withheld.push({ domain: 'people', reason: 'You cannot view employees in People.' });
    }
    const stepUpOn = await payrollStepUpOn(orgId);
    if (!holds('PAYROLL::Employee Payroll Profile::VIEW') || !holds('PAYROLL::Payroll Runs::VIEW')) {
      withheld.push({ domain: 'payroll', reason: 'You cannot view payroll profiles and pay runs.' });
    } else if (stepUpOn && !hasValidStepUp(req)) {
      withheld.push({ domain: 'payroll', reason: 'Your company asks for an authenticator code before payroll data leaves CLOR.' });
    } else {
      /* As Payroll's own screens show them (payrollEmployees.ts): PAN and bank by the profile's field level; UAN, PF and ESI also with Full identifiers. */
      const access = await resolveAccess(accountId, orgId, req.auth!.userId, req.tenant!.branchId);
      const panBank = Boolean(req.isAdmin) || levelFor(access, 'PAYROLL', 'Employee Payroll Profile', PermissionAction.VIEW) >= 1;
      Object.assign(data, await exportDomain(payrollPrisma, PayrollPrisma.dmmf as any, 'payroll', scope, { reveal: { panBank, ids: panBank || fullIds } }));
      await recordAudit(req, { entity: 'Company', entityId: orgId, action: 'EXPORT_PAYROLL', message: 'Exported Payroll records (bank, PAN, UAN, salary and tax data)' });
    }
  }

  const counts: Record<string, number> = {};
  const outData: Record<string, any[]> = {};
  const outConfig: Record<string, any[]> = {};
  for (const [name, rows] of Object.entries(data)) {
    counts[name] = rows.length;
    outData[name] = plain(rows);
  }
  for (const [name, rows] of Object.entries(configuration)) {
    counts[name] = rows.length;
    outConfig[name] = plain(rows);
  }

  /*
   * A full export is what closing the company requires first
   * (services/companyClosure.ts) — and only a copy with nothing withheld is one.
   */
  /*
   * #11: and every other export is in the audit trail too — data only,
   * configuration only, or a full export with something withheld — with
   * what was asked for, how many rows of each table left, and what was held
   * back. "Who took our data" has an answer whatever the scope.
   */
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const full = wantData && wantConfiguration && !withheld.length;
  await recordAudit(req, {
    entity: 'Company',
    entityId: orgId,
    action: full ? 'EXPORT_ALL' : 'EXPORT',
    message: full ? `Full company export (${total} rows)` : `Company export: ${asked === 'all' ? 'everything allowed' : asked === 'data' ? 'data' : 'configuration'} (${total} rows${withheld.length ? `; withheld ${withheld.map((w) => w.domain).join(', ')}` : ''})`,
    metadata: { scope: asked, counts, withheld: withheld.map((w) => w.domain) },
  });

  res.json({
    /*
     * A header that says what this is and what it covers, because a file found
     * on a shared drive in two years' time has to explain itself.
     */
    export: {
      format: 'clor/company-export',
      version: 1,
      scope: asked,
      company: { id: org.id, name: org.name, handle: org.slug || null },
      takenAt: new Date().toISOString(),
      counts,
      /* What this person was not allowed to take, and why — so a partial file says it is partial. */
      withheld,
      note:
        'Belongs to this company alone. It contains no other company’s records, ' +
        'no users or sessions, and no passwords or API credentials.',
    },
    ...(wantData ? { data: outData } : {}),
    ...(wantConfiguration ? { configuration: outConfig } : {}),
  });
});

export default dataExportRouter;
