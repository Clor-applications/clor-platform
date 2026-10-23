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
export async function anotherApproverExists(accountId: string, orgId: string, actorId: string, permission: string): Promise<boolean> {
  const members = await outsideTenant('maker-checker: who else in this company can approve', () =>
    platformPrisma.userOrgMembership.findMany({
      where: { orgId, NOT: { userId: actorId }, user: { isActive: true } },
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
  opts: { makers: Array<string | null | undefined>; module: string; resource: string; entity: string; entityId: string; what: string },
): Promise<Refusal | null> {
  const actorId = req.auth!.userId;
  if (!opts.makers.some((m) => m && m === actorId)) return null;
  const { accountId, orgId } = req.tenant!;
  const mode = (await getAuthPolicy(accountId, orgId)).makerChecker;
  const refuse: Refusal = {
    status: 403,
    body: { error: `You prepared this ${opts.what}; somebody else has to approve it.`, code: 'MAKER_CHECKER' },
  };
  if (mode === 'STRICT') return refuse;
  if (mode !== 'ALLOW' && (await anotherApproverExists(accountId, orgId, actorId, permKey(opts.module, opts.resource, 'APPROVE')))) return refuse;
  await recordAudit(req, {
    entity: opts.entity,
    entityId: opts.entityId,
    action: 'SELF_APPROVED',
    message: mode === 'ALLOW'
      ? `Approved by the person who prepared this ${opts.what} (the company allows one person to do both)`
      : `Approved by the person who prepared this ${opts.what}: nobody else in the company can approve it`,
    metadata: { makerChecker: mode },
  });
  return null;
}

/** Refused when the employee concerned is the person signed in. Never overridable. */
export async function ownRecordRefusal(req: Request, employeeId: string, what: string): Promise<Refusal | null> {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: req.tenant!.orgId }, select: { userId: true } });
  if (e?.userId && e.userId === req.auth!.userId) {
    return { status: 403, body: { error: `This is your own ${what}; somebody else has to approve it.`, code: 'OWN_RECORD' } };
  }
  return null;
}
