import type { Request } from 'express';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { permKey } from '../../constants/permissionCatalog.js';
import { anotherApproverExists, type Refusal } from '../makerChecker.js';
import { getAuthPolicy } from '../policy.js';
import { recordAudit } from '../auditTrail.js';

/**
 * Nobody sets their own pay (audit 7 Nov 2026, #6 and #7).
 *
 * A salary assignment is what somebody is paid; a loan instalment waived is
 * money they no longer owe. Both move money to whoever does it, so the person
 * it is about may not, while anybody else in the company could. The owner's
 * rule of 4 Nov 2026 for loans and revisions (PR #126, makerChecker
 * ownRecordUnlessAlone), applied here: someone alone, with nobody else holding
 * the right, is not left at a dead end. Then the maker-checker setting decides:
 * STRICT refuses; AUTO and ALLOW allow it, and the audit log says so by name.
 */
export async function ownPayRefusal(
  req: Request,
  employeeId: string,
  opts: { what: string; does: string; module: string; resource: string; action: string; entity: string; entityId?: string | null },
): Promise<Refusal | null> {
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const e = await peoplePrisma.employee.findFirst({ where: { orgId, id: employeeId }, select: { userId: true, name: true } });
  if (!e?.userId || e.userId !== userId) return null;
  const refuse: Refusal = { status: 403, body: { error: `This is your own ${opts.what}; somebody else has to ${opts.does}.`, code: 'OWN_RECORD' } };
  if (await anotherApproverExists(accountId, orgId, userId, permKey(opts.module, opts.resource, opts.action))) return refuse;
  const mode = (await getAuthPolicy(accountId, orgId)).makerChecker;
  if (mode === 'STRICT') {
    return { status: 403, body: { error: `This is your own ${opts.what}, and your company asks for a second person, but nobody else can ${opts.does}. Give somebody the right first.`, code: 'OWN_RECORD' } };
  }
  await recordAudit(req, {
    entity: opts.entity,
    entityId: opts.entityId || employeeId,
    action: 'OWN_RECORD_ALONE',
    message: `${e.name || 'Someone'} changed their own ${opts.what}: nobody else in the company can`,
    metadata: { makerChecker: mode, ownRecord: true, employeeId },
  });
  return null;
}
