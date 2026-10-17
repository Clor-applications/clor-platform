import type { NextFunction, Request, Response } from 'express';

import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Every change made through the Payroll and Attendance APIs goes in the audit
 * log: who, when, what, to which record, and the request with anything
 * sensitive hidden. One middleware instead of a line in ninety handlers, so a
 * new route is on the record without anybody remembering to add it.
 *
 * Only successful changes (POST / PUT / PATCH / DELETE answered below 400).
 * A handler that writes a richer entry itself (services/auditTrail.ts) marks
 * the response, and is not logged twice. Never delays or fails the request.
 */

const MODULES: Record<string, string> = { payroll: 'PAYROLL', attendance: 'ATTENDANCE' };

/** Not changes to anything: checks and trial runs. */
const SKIP = [/\/payroll\/runs\/[^/]+\/validate$/, /\/attendance\/devices\/test-etimeoffice$/];

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
];

/** Request fields never written to the log. */
const HIDDEN = /password|secret|token|bankaccountnumber|^pan$|aadhaar|photo|selfie|template|tmp$|activationcode|apikey|signature/i;

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
  const m = /^\/api\/orgs\/[^/]+\/(payroll|attendance)(\/.*)?$/.exec(path);
  if (!m || SKIP.some((re) => re.test(path))) return next();

  res.on('finish', () => {
    if (res.statusCode >= 400 || res.locals.audited || !req.auth?.userId || !req.tenant?.orgId) return;
    const parts = [m[1], ...(m[2] || '').split('/').filter(Boolean)];
    const ids = parts.filter((p) => ID.test(p));
    const shape = parts.map((p) => (ID.test(p) ? ':id' : p)).join('/');
    const key = `${req.method} ${shape}`;
    const resource = (parts.slice(1).find((p) => !ID.test(p)) || m[1]).replace(/s$/, '').replace(/-/g, '_').toUpperCase();
    const last = parts[parts.length - 1];
    const verb = ID.test(last) || parts.length <= 2 || last === parts[1]
      ? { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' }[req.method]!
      : last.replace(/-/g, '_').toUpperCase();
    const phrase = PHRASES.find(([re]) => re.test(key))?.[1];
    platformPrisma.auditLog
      .create({
        data: {
          accountId: req.tenant.accountId,
          orgId: req.tenant.orgId,
          branchId: req.tenant.branchId || '',
          entity: `${MODULES[m[1]]}_${resource}`.slice(0, 40),
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
