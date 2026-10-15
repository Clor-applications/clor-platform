import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { istDate } from '../services/attendance/compute.js';
import { pushEmployeeToReaders, revokeFromReaders } from './iclock.js';

/**
 * Personnel operations from ClorTime (routes/personnel_expansion.js,
 * routes/contractors.js): contractors, resignation and rehire, bulk transfer.
 * On the shared employee list, so they work for Attendance alone or with
 * People and Payroll.
 */
export const personnelRouter = Router();
personnelRouter.use(requireAuth, requireTenantContext);

const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const R = PEOPLE_RESOURCE;
const base = '/orgs/:orgId/people';
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const blank = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const sendError = (res: any, e: any) => {
  if (e?.status) return res.status(e.status).json({ error: e.message });
  if (String(e?.code) === 'P2002') return res.status(409).json({ error: 'That name is already used in this organisation.' });
  throw e;
};

// ---------------------------------------------------------------------------
// Contractors
// ---------------------------------------------------------------------------

const contractorSchema = z.object({
  name: z.string().trim().min(1, 'Name the contractor.').max(150),
  code: text(30),
  contactPerson: text(120),
  phone: text(30),
  email: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  gstin: text(20),
  licenceNo: text(60),
  licenceValidTo: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').optional().nullable().or(z.literal('')),
  address: text(500),
  isActive: z.boolean().optional(),
});
const contractorData = (b: z.infer<typeof contractorSchema>) => ({
  name: b.name,
  code: blank(b.code),
  contactPerson: blank(b.contactPerson),
  phone: blank(b.phone),
  email: blank(b.email),
  gstin: blank(b.gstin)?.toUpperCase() ?? null,
  licenceNo: blank(b.licenceNo),
  licenceValidTo: blank(b.licenceValidTo),
  address: blank(b.address),
  ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
});

/** Each contractor with its workforce today: how many, how many in (ClorTime's contractor summary). */
personnelRouter.get(`${base}/contractors`, can(PermissionAction.VIEW, R.structure), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const today = istDate(new Date());
  const [rows, staff, present] = await Promise.all([
    peoplePrisma.contractor.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } }),
    peoplePrisma.employee.groupBy({ by: ['contractorId'], where: { accountId, orgId, status: { not: 'LEFT' }, contractorId: { not: null } }, _count: { _all: true } }),
    peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, date: today, checkIn: { not: null } }, select: { employeeId: true } }),
  ]);
  const presentIds = new Set(present.map((p) => p.employeeId));
  const inToday = presentIds.size
    ? await peoplePrisma.employee.groupBy({ by: ['contractorId'], where: { orgId, id: { in: [...presentIds] }, contractorId: { not: null } }, _count: { _all: true } })
    : [];
  const n = (list: any[], id: string) => list.find((x) => x.contractorId === id)?._count._all || 0;
  res.json({
    contractors: rows.map((c) => ({
      ...c,
      workers: n(staff, c.id),
      presentToday: n(inToday, c.id),
      licenceExpired: Boolean(c.licenceValidTo && c.licenceValidTo < today),
    })),
  });
});

personnelRouter.post(`${base}/contractors`, can(PermissionAction.CREATE, R.structure), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = contractorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  try {
    const contractor = await peoplePrisma.contractor.create({ data: { accountId, orgId, ...contractorData(parsed.data), createdByUserId: req.auth!.userId } });
    res.status(201).json({ contractor });
  } catch (e) {
    return sendError(res, e);
  }
});

personnelRouter.put(`${base}/contractors/:id`, can(PermissionAction.EDIT, R.structure), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.contractor.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such contractor.' });
  const parsed = contractorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  try {
    const contractor = await peoplePrisma.contractor.update({ where: { id: existing.id }, data: contractorData(parsed.data) });
    res.json({ contractor });
  } catch (e) {
    return sendError(res, e);
  }
});

personnelRouter.delete(`${base}/contractors/:id`, can(PermissionAction.DELETE, R.structure), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.contractor.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such contractor.' });
  if (await peoplePrisma.employee.count({ where: { orgId, contractorId: existing.id } })) {
    return res.status(409).json({ error: 'People are linked to this contractor. Mark it inactive instead.' });
  }
  await peoplePrisma.contractor.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Resignation and rehire
// ---------------------------------------------------------------------------

export const LEAVING_TYPES = ['RESIGNED', 'TERMINATED', 'RETIRED', 'ABSCONDED', 'CONTRACT_ENDED', 'DECEASED'] as const;

/**
 * Someone leaves: last day, why, and whether they are still expected at work
 * until then. From the day after their last day they are not counted, and
 * they come off every reader at once (ClorTime: resignation, then
 * queueTemplateRemoval) — door access ends with employment.
 */
personnelRouter.post(`${base}/employees/:id/resign`, can(PermissionAction.EDIT, R.employees), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      lastDay: z.string().regex(ISO_DATE, 'Choose the last working day.'),
      leavingType: z.enum(LEAVING_TYPES),
      reason: text(500),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such employee.' });
  if (existing.status === 'LEFT') return res.status(409).json({ error: 'This person has already left.' });
  if (existing.dateOfJoining && parsed.data.lastDay < existing.dateOfJoining) return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
  const employee = await peoplePrisma.employee.update({
    where: { id: existing.id },
    data: { status: 'LEFT', dateOfLeaving: parsed.data.lastDay, leavingType: parsed.data.leavingType, leavingReason: blank(parsed.data.reason) },
  });
  const removed = await revokeFromReaders(orgId, existing, req.auth!.userId);
  res.json({ employee, readers: removed.readers });
});

/** Back to work: active again, leaving details cleared, put back on every reader. */
personnelRouter.post(`${base}/employees/:id/rehire`, can(PermissionAction.EDIT, R.employees), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ rejoinDate: z.string().regex(ISO_DATE).optional().nullable() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Dates are YYYY-MM-DD.' });
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such employee.' });
  if (existing.status !== 'LEFT') return res.status(409).json({ error: 'This person has not left.' });
  const employee = await peoplePrisma.employee.update({
    where: { id: existing.id },
    data: {
      status: 'ACTIVE',
      dateOfLeaving: null,
      leavingType: null,
      leavingReason: null,
      ...(parsed.data.rejoinDate ? { dateOfJoining: parsed.data.rejoinDate } : {}),
    },
  });
  /* Their fingerprints and faces were deleted when they left: they enrol again at a reader. */
  const pushed = await pushEmployeeToReaders(orgId, employee, req.auth!.userId);
  res.json({ employee, readers: pushed.readers });
});

// ---------------------------------------------------------------------------
// Bulk transfer
// ---------------------------------------------------------------------------

/** Move people to another department, area, position or contractor in one go (ClorTime personnel-transfer). */
personnelRouter.post(`${base}/employees/transfer`, can(PermissionAction.EDIT, R.employees), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      employeeIds: z.array(z.string().min(1)).min(1, 'Choose people to move.').max(2000),
      field: z.enum(['departmentId', 'areaId', 'jobPositionId', 'contractorId']),
      targetId: z.string().min(1).nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const { employeeIds, field, targetId } = parsed.data;
  const target =
    targetId === null
      ? { name: null }
      : field === 'departmentId'
        ? await peoplePrisma.department.findFirst({ where: { id: targetId, orgId }, select: { name: true } })
        : field === 'areaId'
          ? await peoplePrisma.area.findFirst({ where: { id: targetId, orgId }, select: { name: true } })
          : field === 'jobPositionId'
            ? await peoplePrisma.jobPosition.findFirst({ where: { id: targetId, orgId }, select: { name: true } })
            : await peoplePrisma.contractor.findFirst({ where: { id: targetId, orgId }, select: { name: true } });
  if (!target) return res.status(400).json({ error: 'That is not in this organisation.' });
  /* The department and position names are kept on the employee for lists and payslips. */
  const mirror = field === 'departmentId' ? { department: target.name } : field === 'jobPositionId' ? { designation: target.name } : {};
  const r = await peoplePrisma.employee.updateMany({ where: { accountId, orgId, id: { in: employeeIds } }, data: { [field]: targetId, ...mirror } as any });
  res.json({ moved: r.count });
});
