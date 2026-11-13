import type { NextFunction, Request, Response } from 'express';

/**
 * What CLOR staff may do once a customer has let them in
 * (docs/workspace/SUPPORT_GRANTS.md).
 *
 * Three rules, all on the server, for every route at once — hiding buttons is
 * the app's courtesy, this is the rule. It runs after the tenant is resolved,
 * because until then nobody knows a grant is in play.
 *
 * 1. **Read-only unless the customer said otherwise.** A grant carries the
 *    scope the customer agreed to, not the one that was asked for, so
 *    "see it" and "fix it" are different answers.
 * 2. **Shut even to a read** (owner, 14 Nov 2026): salary figures and
 *    payslips, employee documents, bank details. Staff can see *that* a pay
 *    run failed, never what anyone earns. A customer's own people are
 *    unaffected: this applies only to a request on a grant.
 * 3. **Never who gets in**, whatever the scope: users, roles, sign-in
 *    security, outside access and support grants themselves. A grant that
 *    could approve a grant, or add a user, would outlive itself.
 *
 * Paths are matched on the whole URL (`originalUrl`): this runs inside routers
 * mounted at `/api` and at their own base, where `req.path` is only the tail.
 */

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ORG = String.raw`^/api/orgs/[^/]+`;
const re = (tail: string) => new RegExp(ORG + tail);

/**
 * Closed to a grant for every method, reads included.
 *
 * Written as whole path segments so a new route under one of these is shut by
 * default rather than open by oversight.
 */
export const GRANT_CLOSED: RegExp[] = [
  /* What anyone earns: Payroll as a whole — runs, payslips, structures, bank changes, Form 16, the register. */
  re(String.raw`/payroll(/|$)`),
  re(String.raw`/people/salary-(revisions|advances)(/|$)`),
  re(String.raw`/people/employees/[^/]+/salary-question(/|$)`),
  re(String.raw`/people/[^/]*payroll-export`),
  re(String.raw`/attendance/months/[^/]+/payroll-export`),
  /* Letters carry pay (offer, appointment, revision). */
  re(String.raw`/people/employees/[^/]+/letters(/|$)`),
  /* Employee documents and files: uploaded documents, form attachments, résumés. */
  re(String.raw`/people/documents(/|$)`),
  re(String.raw`/people/employees/[^/]+/documents(/|$)`),
  re(String.raw`/people/(my/)?(request-forms/files|form-files)(/|$)`),
  re(String.raw`/people/talent/(candidates|seats)/[^/]+/resume`),
  /* PAN, Aadhaar, UAN and bank account: the statutory record and anything that reveals it. */
  re(String.raw`/people/employees/[^/]+/statutory(/|$)`),
  re(String.raw`/people/invites/[^/]+/statutory(/|$)`),
  re(String.raw`/people/joining-statutory(/|$)`),
  /* Complaints people raised in confidence. */
  re(String.raw`/people/private-cases(/|$)`),
  /* A grant is for looking at the customer's problem, not for taking their data away. */
  re(String.raw`/export(/|$)`),
  re(String.raw`/people/employees/export(/|$)`),
  re(String.raw`/.*export\.csv$`),
  /* The employee portal is the employee's own door, never support's. */
  /^\/api\/portal(\/|$)/,
];

/** Who gets in and how: refused to a grant for every write, whatever the scope. */
export const GRANT_NO_WRITE: RegExp[] = [
  re(String.raw`/(users|roles|role-profiles|permissions|security|outside-access|support-grants)(/|$)`),
  re(String.raw`/people/employees/[^/]+/user(/|$)`),
  /^\/api\/account(\/|$)/,
];

export const GRANT_READ_ONLY_TEXT =
  'This is a read-only support session. Ask the customer for a session that allows changes if you need to fix something.';
export const GRANT_CLOSED_TEXT = 'Support sessions never open salary, employee documents or bank details, even to read.';
export const GRANT_NO_WRITE_TEXT = 'A support session cannot change who has access to this company.';

/** Writes a session needs to go on and to end, whatever its scope. */
const ALLOWED_WRITES: Array<[string, RegExp]> = [
  ['POST', /^\/api\/auth\/refresh\/?$/],
  ['POST', /^\/api\/auth\/logout\/?$/],
];

/** The whole path asked for, without the query. */
export const fullPath = (req: Request) => String(req.originalUrl || req.url || '').split('?')[0];

export function supportGrantLimits(req: Request, res: Response, next: NextFunction) {
  const grant = req.tenant?.supportGrant;
  if (!grant) return next();

  const path = fullPath(req);
  if (GRANT_CLOSED.some((r) => r.test(path))) {
    return res.status(403).json({ error: GRANT_CLOSED_TEXT, code: 'SUPPORT_GRANT_CLOSED' });
  }

  if (READS.has(req.method)) return next();
  if (ALLOWED_WRITES.some(([m, r]) => m === req.method && r.test(path))) return next();
  if (GRANT_NO_WRITE.some((r) => r.test(path))) {
    return res.status(403).json({ error: GRANT_NO_WRITE_TEXT, code: 'SUPPORT_GRANT_NO_ACCESS_CHANGES' });
  }
  if (grant.scope === 'READ_WRITE') return next();

  return res.status(403).json({ error: GRANT_READ_ONLY_TEXT, code: 'SUPPORT_GRANT_READ_ONLY' });
}
