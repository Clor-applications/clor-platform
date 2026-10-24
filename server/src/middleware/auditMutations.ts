import type { NextFunction, Request, Response } from 'express';

import { platformPrisma } from '../utils/platformPrisma.js';

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
 * the response, and is not logged twice. Never delays or fails the request.
 */

const MODULES: Record<string, string> = { payroll: 'PAYROLL', attendance: 'ATTENDANCE', people: 'PEOPLE' };

/**
 * The company's own administration, under the names Company admin's audit
 * trail files as "Company" (routes/audit.ts). First match wins.
 */
const COMPANY_ENTITIES: Array<[RegExp, string]> = [
  [/^(roles|permissions|role-profiles)(\/|$)/, 'Role'],
  [/^approval-rules(\/|$)/, 'ApprovalRule'],
  [/^users(\/|$)/, 'User'],
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

/** Request fields never written to the log. */
const HIDDEN = /password|secret|token|bankaccountnumber|^pan$|aadhaar|photo|selfie|template|tmp$|activationcode|apikey|signature|^code$|otp/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, HIDDEN.test(k) ? '[hidden]' : redact(v, depth + 1)]));
  }
  return typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
}

const ID = /^(c[a-z0-9]{20,}|[0-9a-f-]{24,}|\d{4}-\d{2})$/i;

export function auditMutations(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const path = req.originalUrl.split('?')[0];
  /* Under a company, or a person's companies (PUT /api/users/:id/companies), which is the company admin's too. */
  const m = /^\/api\/(?:orgs\/[^/]+\/)?([a-z][a-z-]*)(\/.*)?$/.exec(path);
  if (!m || SKIP.some((re) => re.test(path))) return next();
  if (!/^\/api\/orgs\//.test(path) && m[1] !== 'users') return next();

  res.on('finish', () => {
    if (res.statusCode >= 400 || res.locals.audited || !req.auth?.userId || !req.tenant?.orgId) return;
    const parts = [m[1], ...(m[2] || '').split('/').filter(Boolean)];
    const ids = parts.filter((p) => ID.test(p));
    const shape = parts.map((p) => (ID.test(p) ? ':id' : p)).join('/');
    const key = `${req.method} ${shape}`;
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
    platformPrisma.auditLog
      .create({
        data: {
          accountId: req.tenant.accountId,
          orgId: req.tenant.orgId,
          branchId: req.tenant.branchId || '',
          entity: entity.slice(0, 40),
          entityId: (ids[0] || '').slice(0, 60),
          action: verb.slice(0, 40),
          message: (phrase || `${req.method} ${shape}`).slice(0, 500),
          metadata: JSON.stringify({ path: shape, ids, body: redact(req.body) }).slice(0, 8_000),
          createdByUserId: req.auth.userId,
        },
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[audit] not recorded:', key, e instanceof Error ? e.message : e);
      });
  });
  next();
}
