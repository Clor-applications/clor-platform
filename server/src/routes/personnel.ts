import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { StayOnError, cancelLeaving } from '../services/people/lifecycle/stayOn.js';
import { istDate } from '../services/attendance/compute.js';
import { pushEmployeeToReaders, revokeFromReaders } from '../services/attendance/readerSync.js';
import { deleteToBin } from '../services/recycleBin.js';
import { openNextEpisode } from '../services/people/episodes.js';
import { LEAVING_TYPES, leaveEmployee } from '../services/people/lifecycle/leaving.js';
import { correlationOf, employeeSummary, withoutSecrets } from '../services/people/employees.js';
import { diffEmployee, writeChangeLog } from '../services/people/changeLog.js';
import { writeEvent } from '../services/people/outbox.js';
import { recordChanges } from '../services/people/employmentHistory.js';
import { ownPlanRefusal, startChecklist } from '../services/people/checklists.js';

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

export { LEAVING_TYPES };

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
      /* Notice (W15): when the resignation came, and whether the notice owed is waived. */
      resignedOn: z.string().regex(ISO_DATE, 'Give the date the resignation was received.').optional().nullable().or(z.literal('')).transform((v) => v || null),
      noticeWaived: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing || !inScope(await teamScope(req), existing.id)) return res.status(404).json({ error: 'No such employee.' });
  if (existing.status === 'LEFT') return res.status(409).json({ error: 'This person has already left.' });
  /* Did not join: the day they were to start closes the record, whatever date was sent (W5). A duplicate closes today. */
  const lastDay = parsed.data.leavingType === 'NOT_JOINED' ? existing.dateOfJoining || parsed.data.lastDay : parsed.data.lastDay;
  if (parsed.data.leavingType !== 'NOT_JOINED' && parsed.data.leavingType !== 'DUPLICATE' && existing.dateOfJoining && lastDay < existing.dateOfJoining) return res.status(400).json({ error: 'Somebody cannot leave before they joined. If they never came, choose Did not join.' });
  if (parsed.data.resignedOn && parsed.data.resignedOn > lastDay) return res.status(400).json({ error: 'The resignation came before the last day, not after it.' });
  const r = await leaveEmployee({ accountId, orgId, userId: req.auth!.userId }, existing as any, { lastDay, leavingType: parsed.data.leavingType, reason: blank(parsed.data.reason), resignedOn: parsed.data.resignedOn ?? undefined, noticeWaived: parsed.data.noticeWaived });
  res.json({ employee: withoutSecrets(r.employee as any), readers: r.readers });
});

/** Leaving withdrawn while on notice (Workforce audit O11): active again, the leaving tasks closed as not needed. */
personnelRouter.post(`${base}/employees/:id/stay`, can(PermissionAction.EDIT, R.employees), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!existing || !inScope(await teamScope(req), existing.id)) return res.status(404).json({ error: 'No such employee.' });
  /* Withdrawing a leaving decides its exit interview and closes its no-dues lines: never on your own (JCL-007), unless nobody else can. */
  if (await ownPlanRefusal({ accountId, orgId, userId: req.auth!.userId }, { employeeId: existing.id, owner: 'HR' })) return res.status(403).json({ error: 'This is your own leaving: someone else withdraws it.', code: 'OWN_PLAN' });
  try {
    const employee = await cancelLeaving({ accountId, orgId, userId: req.auth!.userId }, existing.id, typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) || null : null);
    res.json({ employee: withoutSecrets(employee as any) });
  } catch (e) {
    if (e instanceof StayOnError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
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
  const parsed = z.object({ rejoinDate: z.string().regex(ISO_DATE, 'Give the rejoin date, YYYY-MM-DD.'), employeeTypeId: z.string().trim().max(60).optional().nullable().or(z.literal('')).transform((v) => v || null), reportingManagerId: z.string().trim().max(60).optional().nullable().or(z.literal('')).transform((v) => v || null), probationEndDate: optDay, contractEndDate: optDay }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Give the rejoin date (YYYY-MM-DD).', code: 'REJOIN_DATE_REQUIRED' });
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing || !inScope(await teamScope(req), existing.id)) return res.status(404).json({ error: 'No such employee.' });
  if (existing.status !== 'LEFT') return res.status(409).json({ error: 'This person has not left.' });
  if (existing.dateOfLeaving && parsed.data.rejoinDate <= existing.dateOfLeaving) return res.status(400).json({ error: `The rejoin date must be after their last day, ${existing.dateOfLeaving}.` });
  for (const k of ['probationEndDate', 'contractEndDate'] as const) if (parsed.data[k] && parsed.data[k]! < parsed.data.rejoinDate) return res.status(400).json({ error: k === 'probationEndDate' ? 'Probation cannot end before they rejoin.' : 'The contract cannot end before they rejoin.' });
  if (parsed.data.employeeTypeId && !(await peoplePrisma.employeeType.findFirst({ where: { id: parsed.data.employeeTypeId, orgId }, select: { id: true } }))) return res.status(400).json({ error: 'Choose an employment type from the list.' });
  /* The manager they come back to: the one chosen, else the old one only if still here (W18). */
  const managerId = parsed.data.reportingManagerId ?? existing.reportingManagerId ?? null;
  const manager = managerId ? await peoplePrisma.employee.findFirst({ where: { id: managerId, orgId, status: { not: 'LEFT' } }, select: { id: true } }) : null;
  if (parsed.data.reportingManagerId && (!manager || manager.id === existing.id)) return res.status(400).json({ error: 'Choose a manager who works here.' });
  const employee = await peoplePrisma.$transaction(async (tx) => {
    const next = await openNextEpisode({ accountId, orgId }, existing, parsed.data.rejoinDate, tx);
    const row = await tx.employee.update({
      where: { id: existing.id },
      data: {
        status: 'ACTIVE',
        dateOfLeaving: null,
        leavingType: null,
        leavingReason: null,
        /* A new stint: last stint's resignation and waiver must not count against the next leaving. */
        resignedOn: null,
        noticeWaived: false,
        dateOfJoining: parsed.data.rejoinDate,
        firstJoiningDate: existing.firstJoiningDate || existing.dateOfJoining || null,
        probationEndDate: parsed.data.probationEndDate,
        confirmedOn: null,
        contractEndDate: parsed.data.contractEndDate,
        ...(parsed.data.employeeTypeId ? { employeeTypeId: parsed.data.employeeTypeId } : {}),
        reportingManagerId: manager?.id ?? null,
        /* Their old position was freed when they left (W12). */
        seatId: null,
        currentEpisodeSeq: next.seq,
      },
    });
    /* The one write path's log and event, in the same transaction (FND-04, FND-05). */
    const actor = { accountId, orgId, userId: req.auth!.userId, source: 'HIRE' as const, correlationId: correlationOf(req as any), reason: `Rejoined (employment period ${next.seq})` };
    await writeChangeLog(tx, actor, { kind: 'Employee', id: row.id, employeeId: row.id }, diffEmployee(existing as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>));
    await writeEvent(tx, actor, 'people.employee.rejoined.v1', { rejoinDate: parsed.data.rejoinDate, stint: next.seq, employee: employeeSummary(row) }, row.id);
    return row;
  });
  await recordChanges({ accountId, orgId, userId: req.auth!.userId }, existing, employee, { source: 'REHIRE', effectiveDate: parsed.data.rejoinDate, note: `Stint ${employee.currentEpisodeSeq}` });
  await startChecklist({ accountId, orgId, userId: req.auth!.userId }, employee, 'JOINING', employee.dateOfJoining);
  /* Their fingerprints and faces were deleted when they left: they enrol again at a reader. */
  const pushed = await pushEmployeeToReaders(orgId, employee, req.auth!.userId);
  res.json({ employee: withoutSecrets(employee as any), readers: pushed.readers });
});

// ---------------------------------------------------------------------------
// Bulk transfer
// ---------------------------------------------------------------------------

/**
 * Move people to another department, area, position or contractor in one go
 * (ClorTime personnel-transfer). It is a bulk change like the directory's
 * (services/people/bulk.ts): only people in the mover's team scope, refused
 * while a job-change approval rule is in force, each person through the one
 * write path (change log, events, version, history), and a later date waits
 * for that day instead of applying now.
 */
personnelRouter.post(`${base}/employees/transfer`, can(PermissionAction.EDIT, R.employees), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      employeeIds: z.array(z.string().min(1)).min(1, 'Choose people to move.').max(2000),
      field: z.enum(['departmentId', 'areaId', 'jobPositionId', 'contractorId']),
      targetId: z.string().min(1).nullable(),
      /** From when the move counts; today when not given. A later day is scheduled. */
      effectiveDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').optional().nullable(),
      note: text(500),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const { employeeIds, field, targetId } = parsed.data;
  const { BulkError, bulkUpdate } = await import('../services/people/bulk.js');
  const actor = { accountId, orgId, userId: req.auth!.userId, source: 'BULK' as const, correlationId: `transfer_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, reason: blank(parsed.data.note) };
  try {
    const r = await bulkUpdate(actor, { ids: employeeIds, set: { [field]: targetId }, reason: blank(parsed.data.note), effectiveFrom: parsed.data.effectiveDate || null }, await teamScope(req));
    res.json({ moved: r.changed, ...r });
  } catch (e) {
    if (e instanceof BulkError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});
