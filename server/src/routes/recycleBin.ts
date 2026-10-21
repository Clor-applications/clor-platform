import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { recordAudit } from '../services/auditTrail.js';
import { BIN_KINDS, binDays, restoreFromBin } from '../services/recycleBin.js';
import { pushEmployeeToReaders } from './iclock.js';
import { assertMonthOpen } from './attendance.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * The recycle bin (services/recycleBin.ts). Someone sees, restores and
 * deletes for good only what they may delete themselves: a shift planner sees
 * deleted shifts, not deleted employees.
 */
export const recycleBinRouter = Router();
const base = '/orgs/:orgId/recycle-bin';
recycleBinRouter.use(base, requireAuth, requireTenantContext);

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

/** The kinds this person may delete, so may see and restore. */
async function allowedKinds(req: any) {
  const decided = new Map<string, boolean>();
  const out: string[] = [];
  for (const [kind, k] of Object.entries(BIN_KINDS)) {
    const key = `${k.module}::${k.resource}`;
    if (!decided.has(key)) decided.set(key, !(await authorize(req, k.module, PermissionAction.DELETE as any, k.resource)));
    if (decided.get(key)) out.push(kind);
  }
  return out;
}

recycleBinRouter.get(base, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { orgId } = req.tenant!;
  const kinds = await allowedKinds(req);
  const rows = kinds.length
    ? await peoplePrisma.deletedItem.findMany({
        where: { orgId, kind: { in: kinds } },
        orderBy: { deletedAt: 'desc' },
        take: 500,
        select: { id: true, kind: true, entityId: true, label: true, deletedByUserId: true, deletedAt: true, purgeAfter: true },
      })
    : [];
  const userIds = [...new Set(rows.map((r) => r.deletedByUserId))];
  const users = userIds.length ? await platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  res.json({
    days: binDays(),
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      type: BIN_KINDS[r.kind]?.noun || r.kind,
      label: r.label,
      deletedAt: r.deletedAt,
      deletedBy: nameOf.get(r.deletedByUserId) || '',
      purgeAfter: r.purgeAfter,
    })),
  });
});

async function itemFor(req: any, res: any) {
  if (!orgOk(req, res)) return null;
  const item = await peoplePrisma.deletedItem.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId } });
  if (!item) {
    res.status(404).json({ error: 'That is no longer in the recycle bin.' });
    return null;
  }
  const k = BIN_KINDS[item.kind];
  const refused = k ? await authorize(req, k.module, PermissionAction.DELETE as any, k.resource) : { status: 403, body: { error: 'Not allowed.' } };
  if (refused) {
    res.status(refused.status).json(refused.body);
    return null;
  }
  return item;
}

recycleBinRouter.post(`${base}/:id/restore`, async (req, res) => {
  const item = await itemFor(req, res);
  if (!item) return;
  const { orgId } = req.tenant!;
  try {
    /* A day comes back only into a month that is still open, as with any change to a day. */
    if (item.kind === 'attendanceRecord') await assertMonthOpen(orgId, String((item.snapshot as any)?.row?.date || ''));
    const { restored, kind } = await restoreFromBin(orgId, item.id);
    /* Someone deleted was taken off the readers; put them back on. */
    if (item.kind === 'employee') await pushEmployeeToReaders(orgId, restored, req.auth!.userId).catch(() => undefined);
    await recordAudit(req, {
      entity: `${kind.module}_RECYCLE_BIN`,
      entityId: item.entityId,
      action: 'RESTORE',
      message: `Restored ${kind.noun.toLowerCase()} ${item.label} from the recycle bin`,
      metadata: { kind: item.kind, deletedAt: item.deletedAt },
    });
    res.json({ ok: true, kind: item.kind, id: item.entityId });
  } catch (e: any) {
    if (e?.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

recycleBinRouter.delete(`${base}/:id`, async (req, res) => {
  const item = await itemFor(req, res);
  if (!item) return;
  await peoplePrisma.deletedItem.delete({ where: { id: item.id } });
  if (item.kind === 'employee') {
    await peoplePrisma.employmentEvent.deleteMany({ where: { orgId: item.orgId, employeeId: item.entityId } });
    await peoplePrisma.checklistTask.deleteMany({ where: { orgId: item.orgId, employeeId: item.entityId } });
  }
  const k = BIN_KINDS[item.kind]!;
  await recordAudit(req, {
    entity: `${k.module}_RECYCLE_BIN`,
    entityId: item.entityId,
    action: 'DELETE_FOREVER',
    message: `Deleted ${k.noun.toLowerCase()} ${item.label} for good from the recycle bin`,
    metadata: { kind: item.kind },
  });
  res.json({ ok: true });
});

export default recycleBinRouter;
