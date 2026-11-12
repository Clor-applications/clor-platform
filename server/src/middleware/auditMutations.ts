import type { NextFunction, Request, Response } from 'express';

import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { prisma } from '../utils/prisma.js';
import { auditScope, type TxAudit } from '../utils/auditScope.js';
import { diffSnapshots, rowSnapshot, type Changes, type Snapshot } from '../services/auditDiff.js';
import { timeRulesFor } from '../services/attendance/timeRules.js';

/**
 * Every change a member of staff makes goes in the audit log: who, when, what,
 * to which record, and the request with anything sensitive hidden. One
 * middleware instead of a line in hundreds of handlers, so a new route is on
 * the record without anybody remembering to add it.
 *
 * It began with Payroll, Attendance and People. A-50/A-51 (Batch 8): who may
 * do what — roles, permissions, approval rules, a person's roles, branches,
 * warehouses and companies, sign-in providers — and every Accounting and
 * master-data change are recorded the same way. Changes a person makes only
 * to their own login or inbox are not (they change nothing anyone else sees).
 *
 * Only successful changes (POST / PUT / PATCH / DELETE answered below 400).
 * A handler that writes a richer entry itself (services/auditTrail.ts) marks
 * the response, and is not logged twice.
 *
 * Before and after values (Rule 3(1), platform audit 11 Nov 2026). For the
 * records in EDIT_LOG below — the platform's own administration, and People's
 * and Attendance's masters and rules — a loader reads the record as it was,
 * once the request's company is known and before the handler runs
 * (`auditBefore`, called from middleware/tenantContext.ts), and again after the
 * change. The entry carries `changes: { field: { from, to } }`, masked as
 * services/auditDiff.ts says (secrets, passwords, tokens, Aadhaar, PAN, bank
 * numbers). Books, Accounting and Payroll are not in the list.
 *
 * Written together. For who may do what — roles and their permissions, role
 * profiles, a person's roles and permissions, the security policy, sign-in
 * providers, directory-sync tokens and outside access — the change and its
 * entry succeed or fail together. All of those records live in the platform
 * database with the audit table, so the entry is written inside the change's
 * own transaction, before it commits: the platform client runs the request's
 * `TxAudit` (utils/auditScope.ts) inside every transaction that writes one of
 * the route's models, and runs a lone write in a transaction of its own so it
 * can join it. An entry that cannot be written throws, the transaction rolls
 * back, and the person is answered 503 "not made" (AuditUnavailableError);
 * the role stays as it was. The first such transaction carries the entry; a
 * handler that writes in several separate transactions has the rest of its
 * work recorded by the after-diff of that first one only. A write that reaches
 * none of those transactions (a batch transaction) falls back to the entry at
 * the end, as before. A handler that also writes its own named entry (deleting
 * a role, a role's permissions) still does, after the change: that one is the
 * readable line, the together one the guarantee.
 *
 * Everything else keeps the old rule: written after the answer, never delays
 * or fails the request, a failure reported in the log.
 */

/** Refused because the change's audit entry could not be written with it. */
export class AuditUnavailableError extends Error {
  status = 503;
  expose = true;
  code = 'AUDIT_UNAVAILABLE';
  constructor(cause?: unknown) {
    super('Not changed: the audit log could not record this change, so it was not made. Try again in a moment.');
    (this as any).cause = cause;
  }
}

type Ctx = { orgId: string; accountId: string; ids: string[]; body: any };
type Db = any;
type Entry = {
  /** `METHOD shape`, shape as below (ids as :id, after the company). */
  key: RegExp;
  /** Written together with the change (platform models, camelCase as on the client). */
  together?: string[];
  /** The record as a person would read it; `db` is the platform transaction for together entries. */
  load?: (db: Db, c: Ctx) => Promise<Snapshot | null>;
};

const permKeyOf = (p: { module: string; subModule: string | null; action: string }) => [p.module, p.subModule, p.action].filter(Boolean).join('::');
const sorted = (a: string[]) => [...new Set(a)].sort();

async function roleSnapshot(db: Db, c: Ctx) {
  const r = await db.role.findFirst({
    where: { id: c.ids[0], orgId: c.orgId },
    select: { name: true, description: true, roleType: true, branchId: true, ownDocumentsOnly: true, permissions: { where: { allowed: true }, select: { permLevel: true, permission: { select: { module: true, subModule: true, action: true } } } } },
  });
  if (!r) return null;
  const { permissions, ...rest } = r;
  return { ...rest, permissions: sorted(permissions.map((p: any) => `${permKeyOf(p.permission)}${p.permLevel ? ` (level ${p.permLevel})` : ''}`)) };
}

async function profileSnapshot(db: Db, c: Ctx) {
  const p = await db.roleProfile.findFirst({ where: { id: c.ids[0], orgId: c.orgId }, select: { name: true, description: true, roles: { select: { roleId: true } } } });
  if (!p) return null;
  const names = new Map((await db.role.findMany({ where: { orgId: c.orgId, id: { in: p.roles.map((r: any) => r.roleId) } }, select: { id: true, name: true } })).map((r: any) => [r.id, r.name]));
  return { name: p.name, description: p.description, roles: sorted(p.roles.map((r: any) => names.get(r.roleId) || r.roleId)) };
}

/** What a person may do in this company: their roles, role profiles and record permissions. */
async function accessSnapshot(db: Db, c: Ctx) {
  const userId = c.ids[0];
  const [roles, profiles, perms] = await Promise.all([
    db.userRoleAssignment.findMany({ where: { orgId: c.orgId, userId }, select: { branchId: true, role: { select: { name: true } } } }),
    db.userRoleProfile.findMany({ where: { orgId: c.orgId, userId }, select: { branchId: true, profile: { select: { name: true } } } }),
    db.userPermission.findMany({ where: { orgId: c.orgId, userId }, select: { entityType: true, entityId: true, label: true } }),
  ]);
  const at = (b: string | null) => (b ? ` (branch ${b})` : '');
  return {
    roles: sorted(roles.map((r: any) => `${r.role?.name ?? '?'}${at(r.branchId)}`)),
    roleProfiles: sorted(profiles.map((p: any) => `${p.profile?.name ?? '?'}${at(p.branchId)}`)),
    recordPermissions: sorted(perms.map((p: any) => `${p.entityType}: ${p.label || p.entityId}`)),
  };
}

const byId = (model: string, drop: string[] = []) => async (db: Db, c: Ctx) => rowSnapshot(await db[model].findFirst({ where: { id: c.ids[0], orgId: c.orgId } }), drop);
const people = (model: string, drop: string[] = []) => async (_db: Db, c: Ctx) => rowSnapshot(await (peoplePrisma as any)[model].findFirst({ where: { id: c.ids[0], orgId: c.orgId } }), drop);

const EMPLOYEE_NOT_MASTER = ['portalPasswordHash', 'portalPasswordSetAt', 'portalSetupHash', 'portalSetupExpires', 'portalSessionsRevokedAt', 'privacyNoticeAckAt', 'privacyNoticeVersion', 'searchText'];

/**
 * The records whose changes carry before and after values. First match wins. `together`: written in one
 * transaction with the change (see the header).
 */
const EDIT_LOG: Entry[] = [
  /* Who may do what: written together. */
  { key: /^POST roles$/, together: ['role', 'rolePermission'] },
  { key: /^(PATCH|DELETE) roles\/:id$|^(PUT|POST|DELETE) roles\/:id\/permissions(\/|$)/, together: ['role', 'rolePermission', 'roleProfileRole'], load: roleSnapshot },
  { key: /^POST role-profiles$/, together: ['roleProfile', 'roleProfileRole'] },
  { key: /^(PUT|DELETE) role-profiles\/:id$/, together: ['roleProfile', 'roleProfileRole'], load: profileSnapshot },
  { key: /^(PUT|POST|DELETE) users\/:id\/(role|roles|role-profiles|permissions)(\/|$)/, together: ['userRoleAssignment', 'userRoleProfile', 'userPermission'], load: accessSnapshot },
  { key: /^PUT security\/policy$/, together: ['authPolicy'], load: async (db, c) => rowSnapshot(await db.authPolicy.findFirst({ where: { orgId: c.orgId } })) },
  { key: /^POST security\/providers$/, together: ['authProvider'] },
  { key: /^(PATCH|DELETE) security\/providers\/:id$|^POST security\/providers\/:id\/verify-domains$/, together: ['authProvider'], load: byId('authProvider') },
  { key: /^POST security\/scim$/, together: ['scimToken'] },
  { key: /^DELETE security\/scim\/:id$/, together: ['scimToken'], load: byId('scimToken', ['lastUsedAt', 'lastError']) },
  { key: /^(PATCH outside-access\/:id|POST outside-access\/:id\/(suspend|resume|revoke))$/, together: ['outsideAccess'], load: byId('outsideAccess') },
  /* The company's settings: before and after, written after the answer. */
  { key: /^DELETE approval-rules\/:id$/, load: async (_db, c) => rowSnapshot(await (prisma as any).approvalRule.findFirst({ where: { id: c.ids[0], orgId: c.orgId } })) },
  {
    key: /^PUT features$/,
    load: async (db, c) => Object.fromEntries((await db.featureSetting.findMany({ where: { orgId: c.orgId }, select: { key: true, enabled: true } })).map((f: any) => [f.key, f.enabled])),
  },
  { key: /^(PATCH|DELETE) branches\/:id$/, load: byId('branch') },
  { key: /^PUT company-profile$/, load: async (db, c) => rowSnapshot(await db.org.findFirst({ where: { id: c.orgId } }), ['code', 'archivedAt', 'closingAt']) },
  /* People and Attendance. */
  { key: /^(PUT|PATCH|DELETE) people\/employees\/:id$/, load: people('employee', EMPLOYEE_NOT_MASTER) },
  { key: /^PUT people\/attendance-rules$/, load: async (_db, c) => (await timeRulesFor(c.orgId)) as unknown as Snapshot },
  { key: /^(PUT|DELETE) attendance\/shifts\/:id$/, load: people('shift') },
  { key: /^(PUT|DELETE) attendance\/leave\/types\/:id$/, load: people('leaveType') },
  {
    /* A day marked or corrected by HR: the day is named in the body. */
    key: /^PUT attendance\/records$/,
    load: async (_db, c) => {
      const employeeId = typeof c.body?.employeeId === 'string' ? c.body.employeeId.trim() : '';
      const date = typeof c.body?.date === 'string' ? c.body.date : '';
      if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return rowSnapshot(await peoplePrisma.attendanceRecord.findFirst({ where: { orgId: c.orgId, employeeId, date } }), ['employeeId', 'date']);
    },
  },
  { key: /^DELETE attendance\/records\/:id$/, load: people('attendanceRecord') },
];

const MODULES: Record<string, string> = { payroll: 'PAYROLL', attendance: 'ATTENDANCE', people: 'PEOPLE' };

/**
 * The company's own administration, under the names Workspace's audit
 * trail files as "Company" (routes/audit.ts). First match wins.
 */
const COMPANY_ENTITIES: Array<[RegExp, string]> = [
  [/^(roles|permissions|role-profiles)(\/|$)/, 'Role'],
  [/^approval-rules(\/|$)/, 'ApprovalRule'],
  [/^users(\/|$)/, 'User'],
  [/^outside-access(\/|$)/, 'OutsideAccess'],
  [/^security\/providers(\/|$)/, 'SSO'],
  [/^security\/scim(\/|$)/, 'Credential'],
  [/^security(\/|$)/, 'Security'],
  [/^features(\/|$)/, 'Features'],
  [/^branches(\/|$)/, 'Branch'],
];

/** Not changes to anything others see: checks, trial runs, and a person's own login and inbox. */
const SKIP = [
  /\/payroll\/runs\/[^/]+\/validate$/,
  /\/attendance\/devices\/test-etimeoffice$/,
  /^\/api\/orgs\/[^/]+\/notifications\/inbox(\/|$)/,
  /^\/api\/orgs\/[^/]+\/security\/(change-password|step-up|two-factor|my-sessions)(\/|$)/,
];

/** Readable messages for the actions people look for. */
const PHRASES: Array<[RegExp, string]> = [
  [/^POST payroll\/runs$/, 'Started a pay run'],
  [/^POST payroll\/runs\/:id\/calculate$/, 'Calculated a pay run'],
  [/^POST payroll\/runs\/:id\/submit-review$/, 'Sent a pay run for review'],
  [/^POST payroll\/runs\/:id\/approve$/, 'Approved a pay run'],
  [/^POST payroll\/runs\/:id\/reject$/, 'Sent a pay run back'],
  [/^POST payroll\/runs\/:id\/lock$/, 'Locked a pay run'],
  [/^POST payroll\/runs\/:id\/post$/, 'Posted a pay run to the books'],
  [/^PUT payroll\/runs\/:id\/inputs$/, 'Changed pay-run days'],
  [/^POST payroll\/runs\/:id\/inputs\/from-attendance$/, 'Took pay-run days from Attendance'],
  [/^POST payroll\/bank-changes\/:id\/approve$/, 'Approved a bank account change'],
  [/^POST payroll\/bank-changes\/:id\/reject$/, 'Rejected a bank account change'],
  [/^PUT payroll\/tax-declarations\/:id$/, 'Changed a tax declaration'],
  [/^POST payroll\/settlements$/, 'Drafted a full and final settlement'],
  [/^(PUT payroll\/settlements\/:id|POST payroll\/settlements\/:id\/recalculate)$/, 'Changed a full and final settlement'],
  [/^(POST|PUT) payroll\/employees/, 'Changed an employee’s payroll details'],
  [/^(POST|PUT|DELETE) payroll\/assignments/, 'Changed a salary assignment'],
  [/^POST payroll\/revisions\/:id\/approve$/, 'Approved a salary revision'],
  [/^POST payroll\/payments/, 'Recorded a salary payment'],
  [/^(POST|PUT|DELETE) payroll\/statutory/, 'Changed a statutory rate'],
  [/^PUT attendance\/records$/, 'Marked or corrected a day'],
  [/^DELETE attendance\/records\/:id$/, 'Deleted a day'],
  [/^POST attendance\/records\/validate$/, 'Validated days'],
  [/^POST attendance\/records\/:id\/overtime$/, 'Approved or withdrew overtime'],
  [/^POST attendance\/requests\/:id\/approve$/, 'Approved a correction request'],
  [/^POST attendance\/requests\/:id\/reject$/, 'Rejected a correction request'],
  [/^POST attendance\/leave\/requests\/:id\/approve$/, 'Approved leave'],
  [/^POST attendance\/leave\/requests\/:id\/reject$/, 'Rejected leave'],
  [/^POST attendance\/months\/:id\/close$/, 'Closed an attendance month'],
  [/^POST attendance\/months\/:id\/reopen$/, 'Reopened an attendance month'],
  [/^POST attendance\/full-day\/paid$/, 'Marked full days paid short as paid'],
  [/^POST attendance\/full-day\/unpaid$/, 'Undid full days marked paid'],
  [/^PUT attendance\/rules$/, 'Changed attendance rules'],
  [/^POST attendance\/recompute$/, 'Recalculated past days'],
  [/^POST attendance\/devices$/, 'Added a reader'],
  [/^DELETE attendance\/devices\/:id$/, 'Removed a reader'],
  [/^POST attendance\/devices\/:id\/approve-network$/, 'Approved a reader’s network'],
  [/^POST attendance\/portal-access\/codes$/, 'Gave portal activation codes'],
  [/^POST people\/employees$/, 'Added an employee'],
  [/^(PUT|PATCH) people\/employees\/:id$/, 'Changed an employee'],
  [/^DELETE people\/employees\/:id$/, 'Removed an employee'],
  [/^POST people\/employees\/:id\/documents/, 'Added an employee document'],
  [/^DELETE people\/employees\/:id\/documents/, 'Removed an employee document'],
  [/^(POST|PUT|DELETE) people\/(departments|positions|areas|contractors)/, 'Changed the org structure'],
  [/^POST people\/data-requests/, 'Raised a data request'],
  /* Who may do what (A-50). */
  [/^POST roles$/, 'Made a role'],
  [/^PATCH roles\/:id$/, 'Changed a role'],
  [/^(PUT|POST|DELETE) roles\/:id\/permissions/, 'Changed what a role may do'],
  [/^POST role-profiles$/, 'Made a role profile'],
  [/^PUT role-profiles\/:id$/, 'Changed a role profile'],
  [/^DELETE role-profiles\/:id$/, 'Removed a role profile'],
  [/^POST approval-rules$/, 'Added an approval rule'],
  [/^DELETE approval-rules\/:id$/, 'Removed an approval rule'],
  [/^PUT users\/:id\/role$/, 'Set a person’s role'],
  [/^POST users\/:id\/roles$/, 'Gave a person a role'],
  [/^POST users\/:id\/role-profiles$/, 'Gave a person a role profile'],
  [/^POST users\/:id\/permissions$/, 'Gave a person a permission'],
  [/^DELETE users\/:id\/permissions\/:id$/, 'Took a permission from a person'],
  [/^POST users\/:id\/branches$/, 'Set the branches a person works in'],
  [/^POST users\/:id\/warehouses$/, 'Set the warehouses a person works in'],
  [/^PUT users\/:id\/companies$/, 'Set the companies a person works in'],
  [/^POST users\/role-suggestion$/, 'Asked for a role suggestion'],
  [/^PATCH security\/providers\/:id$/, 'Changed a sign-in provider'],
  [/^POST security\/providers\/:id\/verify-domains$/, 'Verified a sign-in provider’s domains'],
  [/^POST security\/scim$/, 'Made a directory-sync token'],
  [/^DELETE security\/scim\/:id$/, 'Revoked a directory-sync token'],
  [/^PATCH outside-access\/:id$/, 'Changed what an outside person may use, or until when'],
  [/^POST outside-access\/:id\/suspend$/, 'Paused an outside person’s access'],
  [/^POST outside-access\/:id\/resume$/, 'Resumed an outside person’s access'],
  [/^POST outside-access\/:id\/revoke$/, 'Ended an outside person’s access'],
  [/^POST attendance\/integrations\/webhooks$/, 'Added a webhook'],
  [/^PUT attendance\/integrations\/webhooks\/:id$/, 'Changed a webhook'],
  [/^DELETE attendance\/integrations\/webhooks\/:id$/, 'Removed a webhook'],
  [/^POST attendance\/integrations\/webhooks\/:id\/rotate-secret$/, 'Changed a webhook’s signing secret'],
];

/** Accounting's records by name, for the message (A-51): "Made a bill", "Changed a customer". */
const NOUNS: Record<string, string> = {
  invoices: 'an invoice', bills: 'a bill', 'credit-notes': 'a credit note', 'debit-notes': 'a debit note',
  quotations: 'a quotation', 'sales-orders': 'a sales order', 'purchase-orders': 'a purchase order',
  'delivery-challans': 'a delivery challan', 'sales-returns': 'a sales return', 'purchase-returns': 'a purchase return',
  expenses: 'an expense', payments: 'a payment', receipts: 'a receipt', journals: 'a journal', 'journal-entries': 'a journal',
  'ledger/accounts': 'a ledger account', ledger: 'the ledger', customers: 'a customer', vendors: 'a vendor', parties: 'a party',
  items: 'an item', warehouses: 'a warehouse', transfers: 'a stock transfer', 'stock-documents': 'a stock document',
  adjustments: 'a stock adjustment', 'bank-book': 'the bank book', 'fixed-assets': 'a fixed asset', recurring: 'a recurring invoice',
  'pay-requests': 'a payment link', salesmen: 'a salesperson', currencies: 'a currency', 'exchange-rates': 'an exchange rate',
  batches: 'a batch', serials: 'a serial number', 'number-series': 'a number series', email: 'e-mail settings',
  einvoice: 'an e-invoice', imports: 'an import', 'pos-day-closes': 'a POS day close', masters: 'a master', company: 'the company profile',
};
const VERBS: Record<string, string> = { POST: 'Made', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted' };

function accountingPhrase(method: string, parts: string[]) {
  const named = parts.slice(0, 2).filter((p) => !ID.test(p)).join('/');
  const key = NOUNS[named] ? named : parts[0];
  const noun = NOUNS[key];
  if (!noun) return null;
  const rest = parts.slice(key.split('/').length);
  const action = rest.filter((p) => !ID.test(p)).pop();
  if (!action) return `${VERBS[method] || 'Changed'} ${noun}`;
  const bare = noun.replace(/^(a|an|the) /, '');
  return `${bare[0].toUpperCase()}${bare.slice(1)}: ${action.replace(/-/g, ' ')}`;
}

/** Request fields never written to the log. The reason typed for leaving is one, wherever it is sent (SPEC 3.5). */
const HIDDEN = /password|secret|token|bankaccountnumber|^pan$|aadhaar|photo|selfie|template|tmp$|activationcode|apikey|signature|^code$|otp|^leavingreason$|^endreason$/i;
/**
 * A leaving's routes carry the reason typed for it under plain names (reason, answers): the resignation and its
 * change, staying on, rejoining, the exit interview, and a LEAVING request. The audit trail is read by roles the
 * reason is kept from (Viewer, External Auditor), so those fields are never written.
 */
const LEAVING_HIDDEN = /^(reason|answers|note|comment)$/i;
const LEAVING_PATH = /^people\/(employees\/:id\/(resign|stay|rehire)|leaving\/:id\/exit-interview)$/;
const leavingBody = (shape: string, body: any) => LEAVING_PATH.test(shape) || (/^people\/requests$/.test(shape) && String(body?.requestType || '').toUpperCase() === 'LEAVING');

/**
 * The same masking on read (rows written before the fields were hidden: the log is append-only, so they are masked
 * where they are shown, not changed). Returns the metadata with a leaving's reason fields as "[hidden]", and the
 * employee whose leaving it is, so the caller can apply the reader's rule (companyChoices.ts leavingReasonFilter).
 */
const GLOBAL_LEAVING = /^(leavingreason|endreason)$/i;
function hideKeys(value: unknown, keys: RegExp, depth = 0): unknown {
  if (depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => hideKeys(v, keys, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, keys.test(k) && v != null ? '[hidden]' : hideKeys(v, keys, depth + 1)]));
  return value;
}
export function leavingInAudit(entry: { entity: string; entityId: string; metadata: unknown }): { employeeId: string | null; masked: unknown } | null {
  const m = entry.metadata as any;
  if (!m || typeof m !== 'object') return null;
  /* The exit interview's own line kept the reason code, before it stopped. */
  if (entry.entity === 'ExitInterview' && 'reason' in m) {
    const { reason: _r, ...rest } = m;
    return { employeeId: typeof m.employeeId === 'string' ? m.employeeId : null, masked: { ...rest, reason: '[hidden]' } };
  }
  const shape = typeof m.path === 'string' ? m.path : '';
  const body = m.body;
  const own = body && leavingBody(shape, body);
  const masked = hideKeys(own ? hideKeys(m, GLOBAL_LEAVING) : m, GLOBAL_LEAVING);
  const final = own ? { ...(masked as any), body: hideKeys((masked as any).body, LEAVING_HIDDEN) } : masked;
  if (JSON.stringify(final) === JSON.stringify(m)) return null;
  const employeeId = (Array.isArray(m.ids) && typeof m.ids[0] === 'string' ? m.ids[0] : null) || body?.subjectEmployeeId || body?.payload?.employeeId || entry.entityId || null;
  return { employeeId, masked: final };
}

function redact(value: unknown, depth = 0, extra: RegExp | null = null): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1, extra));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, HIDDEN.test(k) || extra?.test(k) ? '[hidden]' : redact(v, depth + 1, extra)]));
  }
  return typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
}

const ID = /^(c[a-z0-9]{20,}|[0-9a-f-]{24,}|\d{4}-\d{2})$/i;

/** Where a write's path says it goes: its first part after the company, and the rest. */
function routeOf(req: Request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return null;
  const path = req.originalUrl.split('?')[0];
  /* Under a company, or a person's companies (PUT /api/users/:id/companies), which is the company admin's too. */
  const m = /^\/api\/(?:orgs\/[^/]+\/)?([a-z][a-z-]*)(\/.*)?$/.exec(path);
  if (!m || SKIP.some((re) => re.test(path))) return null;
  if (!/^\/api\/orgs\//.test(path) && m[1] !== 'users') return null;
  const parts = [m[1], ...(m[2] || '').split('/').filter(Boolean)];
  const ids = parts.filter((p) => ID.test(p));
  const shape = parts.map((p) => (ID.test(p) ? ':id' : p)).join('/');
  return { m, parts, ids, shape, key: `${req.method} ${shape}` };
}
type Route = NonNullable<ReturnType<typeof routeOf>>;

/** The entry's who, what and which record, as the generic log writes it. */
function describe(req: Request, r: Route, changes: Changes | null) {
  const { m, parts, ids, shape, key } = r;
  const company = MODULES[m[1]] ? null : COMPANY_ENTITIES.find(([re]) => re.test(shape))?.[1] || null;
  /* Payroll, Attendance and People by their module; the company's administration by name; the rest is Accounting's. */
  const resource = MODULES[m[1]]
    ? (parts.slice(1).find((p) => !ID.test(p)) || m[1]).replace(/s$/, '').replace(/-/g, '_').toUpperCase()
    : m[1].replace(/s$/, '').replace(/-/g, '_').toUpperCase();
  const entity = MODULES[m[1]] ? `${MODULES[m[1]]}_${resource}` : company || `ACCOUNTING_${resource}`;
  const last = parts[parts.length - 1];
  const verb = ID.test(last) || parts.length <= 2 || last === parts[1]
    ? { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' }[req.method]!
    : last.replace(/-/g, '_').toUpperCase();
  const phrase = PHRASES.find(([re]) => re.test(key))?.[1] || (entity.startsWith('ACCOUNTING_') ? accountingPhrase(req.method, parts) : null);
  return {
    accountId: req.tenant!.accountId,
    orgId: req.tenant!.orgId,
    branchId: req.tenant!.branchId || '',
    entity: entity.slice(0, 40),
    entityId: (ids[0] || '').slice(0, 60),
    action: verb.slice(0, 40),
    message: (phrase || `${req.method} ${shape}`).slice(0, 500),
    metadata: JSON.stringify({ path: shape, ids, body: redact(req.body, 0, leavingBody(shape, req.body) ? LEAVING_HIDDEN : null) }).slice(0, 8_000),
    createdByUserId: req.auth!.userId,
    correlationId: typeof (req as any).id === 'string' ? String((req as any).id).slice(0, 80) : null,
    ...(changes ? { changes } : {}),
  };
}

type Pending = {
  route: Route;
  entry: Entry;
  ctx: Ctx;
  /** undefined: not read (or could not be). */
  before?: Snapshot | null;
  together?: TxAudit;
};
const pendingOf = (res: Response): Pending | undefined => res.locals.editLog;

/** The record now, through `db`, compared with how it was; null when there is no loader or no "before". */
async function changesNow(p: Pending, db: Db): Promise<Changes | null> {
  if (!p.entry.load || p.before === undefined) return null;
  return diffSnapshots(p.before, await p.entry.load(db, p.ctx));
}

/**
 * Called by requireTenantContext once the company is known, before the handler: reads the record as it was,
 * and, for who-may-do-what, arranges for the entry to be written inside the change's transaction. Runs `next`
 * inside that arrangement. Never refuses the request itself.
 */
export async function auditBefore(req: Request, res: Response, next: () => unknown) {
  let p = pendingOf(res);
  if (!p && !res.locals.editLogChecked) {
    res.locals.editLogChecked = true;
    const route = routeOf(req);
    const entry = route ? EDIT_LOG.find((e) => e.key.test(route.key)) : undefined;
    if (route && entry && req.tenant?.orgId && req.auth?.userId) {
      const pending: Pending = { route, entry, ctx: { orgId: req.tenant.orgId, accountId: req.tenant.accountId, ids: route.ids, body: req.body } };
      if (entry.load) {
        try {
          pending.before = await entry.load(platformPrisma, pending.ctx);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[audit] before not read:', route.key, e instanceof Error ? e.message : e);
        }
      }
      if (entry.together) {
        const models = new Set(entry.together);
        const together: TxAudit = {
          done: false,
          async inTransaction(tx, wrote) {
            if (together.done || ![...wrote].some((w) => models.has(w))) return;
            try {
              await tx.auditLog.create({ data: describe(req, pending.route, await changesNow(pending, tx)) });
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error('[audit] change refused, entry not written:', pending.route.key, e instanceof Error ? e.message : e);
              throw new AuditUnavailableError(e);
            }
            together.done = true;
          },
        };
        pending.together = together;
      }
      res.locals.editLog = pending;
      p = pending;
    }
  }
  return p?.together ? auditScope.run(p.together, next) : next();
}

/** The before-and-after of this request's change, read now, for a handler that writes its own entry (auditTrail.ts). */
export async function editLogChanges(req: Request): Promise<Changes | null> {
  const p = req.res ? pendingOf(req.res) : undefined;
  if (!p || p.together?.done) return null;
  try {
    return await changesNow(p, platformPrisma);
  } catch {
    return null;
  }
}

export function auditMutations(req: Request, res: Response, next: NextFunction) {
  const route = routeOf(req);
  if (!route) return next();

  res.on('finish', () => {
    if (res.statusCode >= 400 || res.locals.audited || !req.auth?.userId || !req.tenant?.orgId) return;
    const p = pendingOf(res);
    /* Written with the change already. */
    if (p?.together?.done) return;
    void (async () => {
      const changes = p ? await changesNow(p, platformPrisma).catch((e) => { console.error('[audit] after not read:', route.key, e instanceof Error ? e.message : e); return null; }) : null;
      await platformPrisma.auditLog.create({ data: describe(req, route, changes) as any });
    })().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[audit] not recorded:', route.key, e instanceof Error ? e.message : e);
    });
  });
  next();
}
