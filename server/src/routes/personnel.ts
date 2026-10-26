import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { istDate } from '../services/attendance/compute.js';
import { pushEmployeeToReaders, revokeFromReaders } from '../services/attendance/readerSync.js';
import { deleteToBin } from '../services/recycleBin.js';
import { openNextEpisode } from '../services/people/episodes.js';
import { leaveEmployee } from '../services/people/lifecycle/leaving.js';
import { correlationOf, employeeSummary } from '../services/people/employees.js';
import { diffEmployee, writeChangeLog } from '../services/people/changeLog.js';
import { writeEvent } from '../services/people/outbox.js';
import { recordChanges } from '../services/people/employmentHistory.js';
import { READER_ACCESS_ITEM, startChecklist } from '../services/people/checklists.js';

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

/** Contractors from a list (AT-02): name, code, contact, phone, e-mail, GSTIN, licence and its expiry, address. A name already on the list is updated, not repeated. */
personnelRouter.post(`${base}/contractors/import`, can(PermissionAction.CREATE, R.structure), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 500) return res.status(400).json({ error: 'Import up to 500 contractors at a time.' });
  const dryRun = req.body?.dryRun === true;
  /* Changing a contractor already on the list is an edit, and needs the edit grant; without it those rows are refused. */
  const mayUpdate = !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, R.structure));
  const existing = new Map((await peoplePrisma.contractor.findMany({ where: { accountId, orgId }, select: { id: true, name: true } })).map((c) => [c.name.trim().toLowerCase(), c.id]));
  const results: Array<{ row: number; ok: boolean; error?: string }> = [];
  let imported = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const parsed = contractorSchema.safeParse({
      name: String(r.name || '').trim(),
      code: String(r.code || '').trim() || null,
      contactPerson: String(r.contactPerson || '').trim() || null,
      phone: String(r.phone || '').trim() || null,
      email: String(r.email || '').trim() || null,
      gstin: String(r.gstin || '').trim() || null,
      licenceNo: String(r.licenceNo || '').trim() || null,
      licenceValidTo: String(r.licenceValidTo || '').trim() || null,
      address: String(r.address || '').trim() || null,
    });
    if (!parsed.success) { results.push({ row: i + 1, ok: false, error: parsed.error.issues[0]?.message || 'Check the row.' }); continue; }
    const id = existing.get(parsed.data.name.trim().toLowerCase());
    if (id && !mayUpdate) { results.push({ row: i + 1, ok: false, error: `${parsed.data.name} is already on the list; changing it needs the edit permission.` }); continue; }
    if (!dryRun) {
      /* Each row stands alone: a clash (a code another contractor uses) fails that row, not the file. */
      try {
        if (id) await peoplePrisma.contractor.update({ where: { id }, data: contractorData(parsed.data) });
        else existing.set(parsed.data.name.trim().toLowerCase(), (await peoplePrisma.contractor.create({ data: { accountId, orgId, ...contractorData(parsed.data), createdByUserId: req.auth!.userId } })).id);
      } catch (e: any) {
        results.push({ row: i + 1, ok: false, error: String(e?.code) === 'P2002' ? 'That code is already used by another contractor.' : 'This row could not be saved.' });
        continue;
      }
    } else if (!id) existing.set(parsed.data.name.trim().toLowerCase(), 'new');
    if (id) updated += 1;
    else imported += 1;
  }
  res.json({ dryRun, imported, updated, failed: results.length, results });
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
  await deleteToBin(req, 'contractor', existing);
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
  if (!existing || !inScope(await teamScope(req), existing.id)) return res.status(404).json({ error: 'No such employee.' });
  if (existing.status === 'LEFT') return res.status(409).json({ error: 'This person has already left.' });
  if (existing.dateOfJoining && parsed.data.lastDay < existing.dateOfJoining) return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
  const r = await leaveEmployee({ accountId, orgId, userId: req.auth!.userId }, existing as any, { lastDay: parsed.data.lastDay, leavingType: parsed.data.leavingType, reason: blank(parsed.data.reason) });
  res.json({ employee: r.employee, readers: r.readers });
});

/**
 * Back to work (docs/people/02-PRD.md LIFE-06): a new stint from the rejoin
 * date, active again, leaving details cleared, put back on every reader. The
 * rejoin date is required: without it the old code kept the original joining
 * date, and with it the original was overwritten (review R-03). Now
 * `dateOfJoining` becomes the rejoin date (the current stint, which
 * Attendance and leave proration read), `firstJoiningDate` stays, and the
 * earlier stint keeps its own dates.
 */
personnelRouter.post(`${base}/employees/:id/rehire`, can(PermissionAction.EDIT, R.employees), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  /* A new stint has its own terms: the type, probation and contract end are asked again; last time's dates never carry over (Workforce audit O6). */
  const optDay = z.string().regex(ISO_DATE).optional().nullable().or(z.literal('')).transform((v) => v || null);
  const parsed = z.object({ rejoinDate: z.string().regex(ISO_DATE, 'Give the rejoin date, YYYY-MM-DD.'), employeeTypeId: z.string().trim().max(60).optional().nullable().or(z.literal('')).transform((v) => v || null), probationEndDate: optDay, contractEndDate: optDay }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Give the rejoin date (YYYY-MM-DD).', code: 'REJOIN_DATE_REQUIRED' });
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing || !inScope(await teamScope(req), existing.id)) return res.status(404).json({ error: 'No such employee.' });
  if (existing.status !== 'LEFT') return res.status(409).json({ error: 'This person has not left.' });
  if (existing.dateOfLeaving && parsed.data.rejoinDate <= existing.dateOfLeaving) return res.status(400).json({ error: `The rejoin date must be after their last day, ${existing.dateOfLeaving}.` });
  for (const k of ['probationEndDate', 'contractEndDate'] as const) if (parsed.data[k] && parsed.data[k]! < parsed.data.rejoinDate) return res.status(400).json({ error: k === 'probationEndDate' ? 'Probation cannot end before they rejoin.' : 'The contract cannot end before they rejoin.' });
  if (parsed.data.employeeTypeId && !(await peoplePrisma.employeeType.findFirst({ where: { id: parsed.data.employeeTypeId, orgId }, select: { id: true } }))) return res.status(400).json({ error: 'Choose an employment type from the list.' });
  const employee = await peoplePrisma.$transaction(async (tx) => {
    const next = await openNextEpisode({ accountId, orgId }, existing, parsed.data.rejoinDate, tx);
    const row = await tx.employee.update({
      where: { id: existing.id },
      data: {
        status: 'ACTIVE',
        dateOfLeaving: null,
        leavingType: null,
        leavingReason: null,
        dateOfJoining: parsed.data.rejoinDate,
        firstJoiningDate: existing.firstJoiningDate || existing.dateOfJoining || null,
        probationEndDate: parsed.data.probationEndDate,
        confirmedOn: null,
        contractEndDate: parsed.data.contractEndDate,
        ...(parsed.data.employeeTypeId ? { employeeTypeId: parsed.data.employeeTypeId } : {}),
        currentEpisodeSeq: next.seq,
      },
    });
    /* The one write path's log and event, in the same transaction (FND-04, FND-05). */
    const actor = { accountId, orgId, userId: req.auth!.userId, source: 'HIRE' as const, correlationId: correlationOf(req as any), reason: `Rejoined: stint ${next.seq}` };
    await writeChangeLog(tx, actor, { kind: 'Employee', id: row.id, employeeId: row.id }, diffEmployee(existing as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>));
    await writeEvent(tx, actor, 'people.employee.rejoined.v1', { rejoinDate: parsed.data.rejoinDate, stint: next.seq, employee: employeeSummary(row) }, row.id);
    return row;
  });
  await recordChanges({ accountId, orgId, userId: req.auth!.userId }, existing, employee, { source: 'REHIRE', effectiveDate: parsed.data.rejoinDate, note: `Stint ${employee.currentEpisodeSeq}` });
  await startChecklist({ accountId, orgId, userId: req.auth!.userId }, employee, 'JOINING', employee.dateOfJoining);
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
      /** From when the move counts (employment history); today when not given. */
      effectiveDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').optional().nullable(),
      note: text(500),
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
  const before = await peoplePrisma.employee.findMany({ where: { accountId, orgId, id: { in: employeeIds } } });
  const r = await peoplePrisma.employee.updateMany({ where: { accountId, orgId, id: { in: employeeIds } }, data: { [field]: targetId, ...mirror } as any });
  const who = { accountId, orgId, userId: req.auth!.userId };
  for (const e of before) await recordChanges(who, e, { ...e, [field]: targetId }, { source: 'TRANSFER', effectiveDate: parsed.data.effectiveDate || null, note: blank(parsed.data.note) });
  res.json({ moved: r.count });
});
