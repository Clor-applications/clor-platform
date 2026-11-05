import type { Request } from 'express';

import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { permKey } from '../constants/permissionCatalog.js';
import { resolveAccess } from './access.js';
import { getAuthPolicy } from './policy.js';
import { recordAudit } from './auditTrail.js';

/**
 * Separation of duties (A-13).
 *
 * Seven approval steps let the person who prepared something approve it, and
 * a payroll approver could approve a raise to their own salary. Two different
 * questions, with two different answers:
 *
 * - **Approving something about yourself** — your own salary revision, the
 *   bank account your pay goes to, your tax declaration — moves money to the
 *   approver. Never allowed, whatever the company's setting.
 *
 * - **Approving your own work** — a pay run, adjustment or revision you
 *   prepared. The company decides (Login & security → policy):
 *     AUTO (default): refused while somebody else could approve it; allowed
 *       and audited when the preparer is the only person who can — a company
 *       with one administrator must still be able to run payroll.
 *     STRICT: always a second person.
 *     ALLOW: one person may do both; every such approval is audited.
 */

export type Refusal = { status: number; body: { error: string; code: string } };

/** Does anybody besides `actorId` hold `permission` (or administer) in this company? */
export async function anotherApproverExists(accountId: string, orgId: string, actorId: string, permission: string, notCounting: string[] = []): Promise<boolean> {
  const members = await outsideTenant('maker-checker: who else in this company can approve', () =>
    platformPrisma.userOrgMembership.findMany({
      where: { orgId, userId: { notIn: [actorId, ...notCounting] }, user: { isActive: true } },
      select: { userId: true },
      take: 500,
    }),
  );
  for (const m of members) {
    const access = await resolveAccess(accountId, orgId, m.userId);
    if (access.isAdmin || access.permissions.has(permission)) return true;
  }
  return false;
}

/**
 * Refused when the actor prepared this (`makers`), as the company's setting
 * decides. When it is allowed only because of the setting or because nobody
 * else could approve, the approval is written to the audit trail as such.
 */
export async function ownWorkRefusal(
  req: Request,
  /* `subjects`: whoever the thing is about. They may never approve it (ownRecordRefusal), so they are not "somebody else who could". */
  /* `notCounting`: others who also prepared it (a loan's later editors): refused too, so not "somebody else who could" either. */
  opts: { makers: Array<string | null | undefined>; module: string; resource: string; entity: string; entityId: string; what: string; subjects?: string[]; who?: string; notCounting?: string[] },
): Promise<Refusal | null> {
  const actorId = req.auth!.userId;
  if (!opts.makers.some((m) => m && m === actorId)) return null;
  const { accountId, orgId } = req.tenant!;
  const mode = (await getAuthPolicy(accountId, orgId)).makerChecker;
  const refuse: Refusal = {
    status: 403,
    body: { error: `You prepared this ${opts.what}; ${opts.who || 'somebody else'} has to approve it.`, code: 'MAKER_CHECKER' },
  };
  if (mode === 'STRICT') return refuse;
  if (mode !== 'ALLOW' && (await anotherApproverExists(accountId, orgId, actorId, permKey(opts.module, opts.resource, 'APPROVE'), [...(opts.subjects || []), ...(opts.notCounting || [])]))) return refuse;
  const subjectApprover = mode !== 'ALLOW' && (opts.subjects || []).length > 0 && (await anotherApproverExists(accountId, orgId, actorId, permKey(opts.module, opts.resource, 'APPROVE')));
  await recordAudit(req, {
    entity: opts.entity,
    entityId: opts.entityId,
    action: 'SELF_APPROVED',
    message: mode === 'ALLOW'
      ? `Approved by the person who prepared this ${opts.what} (the company allows one person to do both)`
      : subjectApprover
        ? `Approved by the person who prepared this ${opts.what}: the only other approver is the person it is about`
        : `Approved by the person who prepared this ${opts.what}: nobody else in the company can approve it`,
    metadata: { makerChecker: mode, ...(subjectApprover ? { subjects: opts.subjects } : {}) },
  });
  return null;
}

/**
 * The same company setting, for a decision made outside a request handler
 * (services/attendance/requests.ts, selfService.ts): may this user decide a
 * request of their own? STRICT never; ALLOW always; AUTO only when nobody
 * else holds `permission`. When allowed, the caller writes SELF_APPROVED.
 */
export async function selfDecisionAllowed(accountId: string, orgId: string, userId: string, permission: string): Promise<{ allowed: boolean; mode: string }> {
  const mode = (await getAuthPolicy(accountId, orgId)).makerChecker;
  if (mode === 'STRICT') return { allowed: false, mode };
  if (mode === 'ALLOW') return { allowed: true, mode };
  return { allowed: !(await anotherApproverExists(accountId, orgId, userId, permission)), mode };
}

/** Refused when the employee concerned is the person signed in. Never overridable. */
export async function ownRecordRefusal(req: Request, employeeId: string, what: string, says?: { who?: string; does?: string }): Promise<Refusal | null> {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: req.tenant!.orgId }, select: { userId: true } });
  if (e?.userId && e.userId === req.auth!.userId) {
    return { status: 403, body: { error: `This is your own ${what}; ${says?.who || 'somebody else'} has to ${says?.does || 'approve it'}.`, code: 'OWN_RECORD' } };
  }
  return null;
}

/** The people a settlement is about: the employee's own sign-in, never counted as "somebody else who could approve". */
export async function subjectUserIds(orgId: string, employeeId: string): Promise<string[]> {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { userId: true } });
  return e?.userId ? [e.userId] : [];
}

/**
 * Your own loan or salary revision (owner's decision, 4 Nov 2026; SPEC 5.6): never yours to approve, reject or put
 * into effect while somebody else could. When nobody else in the company holds the right (an owner alone, paying
 * themselves), the company's maker-checker setting decides, so it is never a dead end: AUTO and ALLOW let them, written
 * SELF_APPROVED by name with the reason; STRICT refuses in plain words. `alone`: allowed only because nobody else could.
 */
export async function ownRecordUnlessAlone(
  req: Request,
  employeeId: string,
  opts: { what: string; does: string; right: string; plural: string; module: string; resource: string; entity: string; entityId: string; action?: string },
): Promise<{ refusal: Refusal | null; alone: boolean }> {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: req.tenant!.orgId }, select: { userId: true } });
  const actorId = req.auth!.userId;
  if (!e?.userId || e.userId !== actorId) return { refusal: null, alone: false };
  const { accountId, orgId } = req.tenant!;
  if (await anotherApproverExists(accountId, orgId, actorId, permKey(opts.module, opts.resource, 'APPROVE'))) {
    return { refusal: { status: 403, body: { error: `This is your own ${opts.what}; somebody else has to ${opts.does}.`, code: 'OWN_RECORD' } }, alone: false };
  }
  const mode = (await getAuthPolicy(accountId, orgId)).makerChecker;
  if (mode === 'STRICT') {
    return { refusal: { status: 403, body: { error: `This is your own ${opts.what}, and nobody else in the company can ${opts.right}. Give someone else the right to approve ${opts.plural}, or change the approval setting.`, code: 'OWN_RECORD' } }, alone: false };
  }
  await recordAudit(req, {
    entity: opts.entity,
    entityId: opts.entityId,
    action: opts.action || 'SELF_APPROVED',
    message: mode === 'ALLOW'
      ? `Decided by the person it is about, their own ${opts.what} (the company allows one person to do both)`
      : `Decided by the person it is about, their own ${opts.what}: nobody else in the company can approve it`,
    metadata: { makerChecker: mode, ownRecord: true },
  });
  return { refusal: null, alone: true };
}
