import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';

/**
 * People: the staff directory.
 *
 * Feature set after Horilla HRMS's employee and base modules (design and
 * operations reference; none of its code): employee files with personal and
 * work details, an org structure (departments, job positions and roles,
 * employee and work types), tags, notes, an org chart, import, and an overview.
 *
 * Bank account, PAN and statutory numbers are payroll's and stay there; this
 * directory does not read them.
 */
export const peopleRouter = Router();
peopleRouter.use(requireAuth, requireTenantContext);

const { employees: EMPLOYEES, structure: STRUCTURE, notes: NOTES } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);

const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = z.string().trim().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').optional().nullable().or(z.literal(''));
const text = (max: number) => z.string().trim().max(max).optional().nullable();

const blank = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s ? s : null;
};

const employeeSchema = z.object({
  name: z.string().trim().max(120).optional(),
  firstName: text(60),
  lastName: text(60),
  code: text(40),
  email: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  phone: text(40),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  branchId: text(60),
  dateOfJoining: date,
  dateOfLeaving: date,
  notes: text(500),

  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable().or(z.literal('')),
  dateOfBirth: date,
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']).optional().nullable().or(z.literal('')),
  personalEmail: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  photoUrl: z.string().max(300_000, 'That photo is too large; use one under 200 KB.').optional().nullable(),
  addressLine: text(240),
  city: text(80),
  state: text(80),
  country: text(80),
  pincode: text(12),
  emergencyContactName: text(120),
  emergencyContactPhone: text(40),
  emergencyContactRelation: text(60),

  departmentId: text(60),
  jobPositionId: text(60),
  jobRoleId: text(60),
  employeeTypeId: text(60),
  workTypeId: text(60),
  reportingManagerId: text(60),
  workEmail: z.string().trim().email('That is not an email address.').max(160).optional().nullable().or(z.literal('')),
  workPhone: text(40),
  workLocation: text(120),
  devicePin: text(40),
  probationEndDate: date,
  contractEndDate: date,

  tagIds: z.array(z.string().trim().min(1)).max(50).optional(),
});
type EmployeeBody = z.infer<typeof employeeSchema>;

/** The display name: what was typed, or first + last. */
const composeName = (b: EmployeeBody, fallback = '') =>
  String(b.name || '').trim() || [b.firstName, b.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || fallback;

/**
 * The org-structure ids a body names, checked against this org, and the
 * display strings they imply: `department` and `designation` stay the strings
 * payroll and every older screen read, so they are written alongside the ids.
 */
async function resolveStructure(orgId: string, b: EmployeeBody) {
  const out: Record<string, string | null> = {};
  const check = async (key: keyof EmployeeBody, find: (id: string) => Promise<{ name: string } | null>) => {
    if (b[key] === undefined) return null;
    const id = blank(b[key]);
    if (!id) {
      out[key as string] = null;
      return null;
    }
    const row = await find(id);
    if (!row) throw Object.assign(new Error(`That ${String(key).replace(/Id$/, '')} is not in this organisation.`), { status: 400 });
    out[key as string] = id;
    return row;
  };
  const dept = await check('departmentId', (id) => peoplePrisma.department.findFirst({ where: { id, orgId }, select: { name: true } }));
  const pos = await check('jobPositionId', (id) => peoplePrisma.jobPosition.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('jobRoleId', (id) => peoplePrisma.jobRole.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('employeeTypeId', (id) => peoplePrisma.employeeType.findFirst({ where: { id, orgId }, select: { name: true } }));
  await check('workTypeId', (id) => peoplePrisma.workType.findFirst({ where: { id, orgId }, select: { name: true } }));
  if (b.departmentId !== undefined) out.department = dept?.name ?? null;
  if (b.jobPositionId !== undefined) out.designation = pos?.name ?? null;
  return out;
}

/** A manager must be another person in this org, and not someone who reports to this one. */
async function checkManager(orgId: string, employeeId: string | null, managerId: string | null) {
  if (!managerId) return;
  if (employeeId && managerId === employeeId) throw Object.assign(new Error('Somebody cannot report to themselves.'), { status: 400 });
  let cursor: string | null = managerId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row: { id: string; reportingManagerId: string | null } | null = await peoplePrisma.employee.findFirst({
      where: { id: cursor, orgId },
      select: { id: true, reportingManagerId: true },
    });
    if (!row) throw Object.assign(new Error('That manager is not in this organisation.'), { status: 400 });
    if (employeeId && row.reportingManagerId === employeeId) {
      throw Object.assign(new Error('That would make a reporting loop: the manager already reports to this person.'), { status: 400 });
    }
    cursor = row.reportingManagerId;
  }
}

const employeeData = (b: EmployeeBody) => {
  const d: Record<string, unknown> = {};
  const keys = [
    'firstName', 'lastName', 'phone', 'branchId', 'dateOfJoining', 'dateOfLeaving', 'notes', 'gender', 'dateOfBirth',
    'maritalStatus', 'photoUrl', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName',
    'emergencyContactPhone', 'emergencyContactRelation', 'reportingManagerId', 'workPhone', 'workLocation',
    'probationEndDate', 'contractEndDate', 'email', 'personalEmail', 'workEmail', 'devicePin',
  ] as const;
  for (const k of keys) if (b[k] !== undefined) d[k] = blank(b[k]);
  if (b.status) d.status = b.status;
  return d;
};

const withMeta = async (orgId: string, rows: any[]) => {
  const managerIds = [...new Set(rows.map((r) => r.reportingManagerId).filter(Boolean))] as string[];
  const managers = managerIds.length
    ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: managerIds } }, select: { id: true, name: true } })
    : [];
  const managerName = new Map(managers.map((m) => [m.id, m.name]));
  return rows.map((r) => ({
    ...r,
    reportingManagerName: r.reportingManagerId ? managerName.get(r.reportingManagerId) || null : null,
    tags: (r.tags || []).map((l: any) => ({ id: l.tag.id, name: l.tag.name, color: l.tag.color })),
  }));
};

const sendError = (res: any, e: any) => {
  if (e?.status) return res.status(e.status).json({ error: e.message });
  if (String(e?.code) === 'P2002') return res.status(409).json({ error: 'That code, name or reader ID is already used in this organisation.' });
  throw e;
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

peopleRouter.get('/orgs/:orgId/people/overview', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.employee.findMany({
    where: { accountId, orgId },
    select: { id: true, name: true, status: true, departmentId: true, department: true, dateOfJoining: true, dateOfLeaving: true, dateOfBirth: true, photoUrl: true, designation: true },
  });
  const today = new Date();
  const ym = today.toISOString().slice(0, 7);
  const active = rows.filter((r) => r.status !== 'LEFT');
  const byDepartment = new Map<string, number>();
  for (const r of active) {
    const k = r.department || 'Unassigned';
    byDepartment.set(k, (byDepartment.get(k) || 0) + 1);
  }
  /* Birthdays in the next 30 days, by month-day, whatever the year. */
  const soon = active
    .filter((r) => r.dateOfBirth && ISO_DATE.test(r.dateOfBirth))
    .map((r) => {
      const [, m, d] = r.dateOfBirth!.split('-').map(Number);
      let next = new Date(today.getFullYear(), m - 1, d);
      if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) next = new Date(today.getFullYear() + 1, m - 1, d);
      return { id: r.id, name: r.name, photoUrl: r.photoUrl, date: next.toISOString().slice(0, 10), days: Math.round((next.getTime() - today.getTime()) / 86_400_000) };
    })
    .filter((b) => b.days <= 30)
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);
  res.json({
    headcount: active.length,
    byStatus: Object.fromEntries(EMPLOYEE_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])),
    byDepartment: [...byDepartment.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    joinedThisMonth: rows
      .filter((r) => String(r.dateOfJoining || '').startsWith(ym))
      .map((r) => ({ id: r.id, name: r.name, designation: r.designation, date: r.dateOfJoining })),
    leftThisMonth: rows.filter((r) => String(r.dateOfLeaving || '').startsWith(ym)).length,
    upcomingBirthdays: soon,
  });
});

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

peopleRouter.get('/orgs/:orgId/people/employees', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const q = String(req.query.q || '').trim();
  const pick = (k: string) => String(req.query[k] || '').trim() || undefined;
  const tagId = pick('tagId');
  const where: any = {
    accountId,
    orgId,
    ...(pick('status') ? { status: pick('status') } : {}),
    ...(pick('departmentId') ? { departmentId: pick('departmentId') } : {}),
    ...(pick('jobPositionId') ? { jobPositionId: pick('jobPositionId') } : {}),
    ...(pick('employeeTypeId') ? { employeeTypeId: pick('employeeTypeId') } : {}),
    ...(pick('workTypeId') ? { workTypeId: pick('workTypeId') } : {}),
    ...(pick('managerId') ? { reportingManagerId: pick('managerId') } : {}),
    ...(tagId ? { tags: { some: { tagId } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { workEmail: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { designation: { contains: q, mode: 'insensitive' } },
            { department: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const take = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  const skip = Math.max(0, Number(req.query.offset || 0));
  const [rows, total] = await Promise.all([
    peoplePrisma.employee.findMany({
      where,
      include: { tags: { include: { tag: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take,
      skip,
    }),
    peoplePrisma.employee.count({ where }),
  ]);
  res.json({ employees: await withMeta(orgId, rows), total });
});

peopleRouter.get('/orgs/:orgId/people/employees/:id', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const row = await peoplePrisma.employee.findFirst({
    where: { id: String(req.params.id), accountId, orgId },
    include: { tags: { include: { tag: true } } },
  });
  if (!row) return res.status(404).json({ error: 'No such employee.' });
  const reports = await peoplePrisma.employee.findMany({
    where: { orgId, reportingManagerId: row.id, status: { not: 'LEFT' } },
    select: { id: true, name: true, designation: true, photoUrl: true },
    orderBy: { name: 'asc' },
  });
  const [shaped] = await withMeta(orgId, [row]);
  res.json({ employee: { ...shaped, directReports: reports } });
});

async function setTags(accountId: string, orgId: string, employeeId: string, tagIds: string[]) {
  const valid = await peoplePrisma.employeeTag.findMany({ where: { orgId, id: { in: tagIds } }, select: { id: true } });
  await peoplePrisma.$transaction([
    peoplePrisma.employeeTagLink.deleteMany({ where: { employeeId } }),
    ...valid.map((t) => peoplePrisma.employeeTagLink.create({ data: { accountId, orgId, employeeId, tagId: t.id } })),
  ]);
}

peopleRouter.post('/orgs/:orgId/people/employees', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid employee.' });
  const b = parsed.data;
  const name = composeName(b);
  if (!name) return res.status(400).json({ error: 'An employee needs a name.' });
  if (b.dateOfLeaving && b.dateOfJoining && b.dateOfLeaving < b.dateOfJoining) {
    return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
  }
  try {
    const structure = await resolveStructure(orgId, b);
    await checkManager(orgId, null, blank(b.reportingManagerId));
    const row = await peoplePrisma.employee.create({
      data: {
        accountId,
        orgId,
        name,
        code: blank(b.code),
        ...employeeData(b),
        ...structure,
        status: b.status || 'ACTIVE',
        createdByUserId: req.auth!.userId,
      } as any,
    });
    if (b.tagIds?.length) await setTags(accountId, orgId, row.id, b.tagIds);
    res.status(201).json({ employee: row });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.put('/orgs/:orgId/people/employees/:id', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such employee.' });
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid employee.' });
  const b = parsed.data;
  const joined = b.dateOfJoining !== undefined ? blank(b.dateOfJoining) : existing.dateOfJoining;
  const left = b.dateOfLeaving !== undefined ? blank(b.dateOfLeaving) : existing.dateOfLeaving;
  if (joined && left && left < joined) return res.status(400).json({ error: 'Somebody cannot leave before they joined.' });
  try {
    const structure = await resolveStructure(orgId, b);
    if (b.reportingManagerId !== undefined) await checkManager(orgId, existing.id, blank(b.reportingManagerId));
    const nameChanged = b.name !== undefined || b.firstName !== undefined || b.lastName !== undefined;
    const row = await peoplePrisma.employee.update({
      where: { id: existing.id },
      data: {
        ...(nameChanged ? { name: composeName({ ...existing, ...b } as any, existing.name) } : {}),
        ...(b.code !== undefined ? { code: blank(b.code) } : {}),
        ...employeeData(b),
        ...structure,
      } as any,
    });
    if (b.tagIds) await setTags(accountId, orgId, row.id, b.tagIds);
    res.json({ employee: row });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Removing someone. A person payroll has paid is part of the books' history:
 * they are marked as having left, never deleted. Only a file with no payroll
 * record goes, and their reports are moved up to their own manager.
 */
peopleRouter.delete('/orgs/:orgId/people/employees/:id', can(PermissionAction.DELETE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such employee.' });
  const [profile, slips] = await Promise.all([
    payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId: existing.id }, select: { id: true } }),
    payrollPrisma.salarySlip.count({ where: { orgId, employeeId: existing.id } }),
  ]);
  if (profile || slips) {
    return res.status(409).json({
      error: 'This person is in payroll. Mark them as having left instead of deleting their file.',
      code: 'EMPLOYEE_IN_PAYROLL',
    });
  }
  await peoplePrisma.$transaction([
    peoplePrisma.employee.updateMany({
      where: { orgId, reportingManagerId: existing.id },
      data: { reportingManagerId: existing.reportingManagerId },
    }),
    peoplePrisma.employee.delete({ where: { id: existing.id } }),
  ]);
  res.json({ ok: true });
});

/**
 * Import. One row per person, the same fields as the form (names of the
 * department, position and type rather than ids, so a spreadsheet can be
 * filled in by hand). Each row stands or falls alone and the answer says which.
 */
const importRow = z.object({
  name: z.string().trim().min(1).max(120),
  code: text(40),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
  phone: text(40),
  department: text(120),
  jobPosition: text(120),
  employeeType: text(120),
  workType: text(120),
  dateOfJoining: date,
  dateOfBirth: date,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable().or(z.literal('')),
  workEmail: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
});

peopleRouter.post('/orgs/:orgId/people/employees/import', can(PermissionAction.CREATE, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Import up to 1,000 people at a time.' });
  const userId = req.auth!.userId;

  /* Names to ids, creating what does not exist yet — the way a spreadsheet
     of staff usually arrives before anyone has set up departments. */
  /* Matched case-insensitively, and the stored name is the one used after: a
     row typing "warehouse" joins Warehouse rather than starting a second. */
  const cache = new Map<string, { id: string; name: string }>();
  const ensure = async (kind: 'department' | 'jobPosition' | 'employeeType' | 'workType', name: string | null | undefined) => {
    const n = blank(name);
    if (!n) return null;
    const key = `${kind}:${n.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key)!;
    const model: any = (peoplePrisma as any)[kind];
    const found = await model.findFirst({ where: { orgId, name: { equals: n, mode: 'insensitive' } }, select: { id: true, name: true } });
    const row = found || (await model.create({ data: { accountId, orgId, name: n, createdByUserId: userId }, select: { id: true, name: true } }));
    cache.set(key, row);
    return row as { id: string; name: string };
  };

  const results: Array<{ row: number; ok: boolean; id?: string; error?: string }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const parsed = importRow.safeParse(rows[i]);
    if (!parsed.success) {
      results.push({ row: i + 1, ok: false, error: parsed.error.issues[0]?.message || 'Invalid row.' });
      continue;
    }
    const r = parsed.data;
    try {
      const code = blank(r.code);
      if (code && (await peoplePrisma.employee.findFirst({ where: { orgId, code }, select: { id: true } }))) {
        results.push({ row: i + 1, ok: false, error: `Code ${code} is already used.` });
        continue;
      }
      const department = await ensure('department', r.department);
      const jobPosition = await ensure('jobPosition', r.jobPosition);
      const created = await peoplePrisma.employee.create({
        data: {
          accountId,
          orgId,
          name: r.name,
          code,
          email: blank(r.email),
          workEmail: blank(r.workEmail),
          phone: blank(r.phone),
          department: department?.name ?? null,
          departmentId: department?.id ?? null,
          designation: jobPosition?.name ?? null,
          jobPositionId: jobPosition?.id ?? null,
          employeeTypeId: (await ensure('employeeType', r.employeeType))?.id ?? null,
          workTypeId: (await ensure('workType', r.workType))?.id ?? null,
          dateOfJoining: blank(r.dateOfJoining),
          dateOfBirth: blank(r.dateOfBirth),
          gender: blank(r.gender),
          status: 'ACTIVE',
          createdByUserId: userId,
        },
        select: { id: true },
      });
      results.push({ row: i + 1, ok: true, id: created.id });
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: String(e?.code) === 'P2002' ? 'Already exists.' : String(e?.message || e) });
    }
  }
  res.json({ imported: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});

peopleRouter.get('/orgs/:orgId/people/org-chart', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const nodes = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' } },
    select: { id: true, name: true, code: true, designation: true, department: true, photoUrl: true, reportingManagerId: true },
    orderBy: { name: 'asc' },
  });
  res.json({ nodes });
});

// ---------------------------------------------------------------------------
// Org structure: one shape for five lists
// ---------------------------------------------------------------------------

const STRUCTURE_KINDS = {
  departments: { model: 'department', usedBy: 'departmentId', extra: ['parentId', 'description'] },
  'job-positions': { model: 'jobPosition', usedBy: 'jobPositionId', extra: ['departmentId', 'description'] },
  'job-roles': { model: 'jobRole', usedBy: 'jobRoleId', extra: ['jobPositionId', 'description'] },
  'employee-types': { model: 'employeeType', usedBy: 'employeeTypeId', extra: [] },
  'work-types': { model: 'workType', usedBy: 'workTypeId', extra: [] },
} as const;
type Kind = keyof typeof STRUCTURE_KINDS;

const structureSchema = z.object({
  name: z.string().trim().min(1, 'A name is needed.').max(120),
  description: text(500),
  parentId: text(60),
  departmentId: text(60),
  jobPositionId: text(60),
  isActive: z.boolean().optional(),
});

const kindOf = (req: any): Kind | null => (String(req.params.kind) in STRUCTURE_KINDS ? (String(req.params.kind) as Kind) : null);

peopleRouter.get('/orgs/:orgId/people/structure/:kind', can(PermissionAction.VIEW, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const cfg = STRUCTURE_KINDS[kind];
  const rows = await (peoplePrisma as any)[cfg.model].findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  const counts = await peoplePrisma.employee.groupBy({
    by: [cfg.usedBy] as any,
    where: { accountId, orgId, status: { not: 'LEFT' } },
    _count: { _all: true },
  });
  const used = new Map((counts as any[]).map((c) => [c[cfg.usedBy], c._count._all]));
  res.json({ items: rows.map((r: any) => ({ ...r, employeeCount: used.get(r.id) || 0 })) });
});

peopleRouter.post('/orgs/:orgId/people/structure/:kind', can(PermissionAction.CREATE, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const parsed = structureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid.' });
  const cfg = STRUCTURE_KINDS[kind];
  const data: any = { accountId, orgId, name: parsed.data.name, createdByUserId: req.auth!.userId };
  for (const k of cfg.extra) if ((parsed.data as any)[k] !== undefined) data[k] = blank((parsed.data as any)[k]);
  try {
    const row = await (peoplePrisma as any)[cfg.model].create({ data });
    res.status(201).json({ item: row });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.put('/orgs/:orgId/people/structure/:kind/:id', can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const cfg = STRUCTURE_KINDS[kind];
  const model: any = (peoplePrisma as any)[cfg.model];
  const existing = await model.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  const parsed = structureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid.' });
  if (kind === 'departments' && parsed.data.parentId === existing.id) {
    return res.status(400).json({ error: 'A department cannot sit under itself.' });
  }
  const data: any = { name: parsed.data.name };
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  for (const k of cfg.extra) if ((parsed.data as any)[k] !== undefined) data[k] = blank((parsed.data as any)[k]);
  try {
    const row = await model.update({ where: { id: existing.id }, data });
    /* Renaming a department or position renames what the files display. */
    if (kind === 'departments' && row.name !== existing.name) {
      await peoplePrisma.employee.updateMany({ where: { orgId, departmentId: row.id }, data: { department: row.name } });
    }
    if (kind === 'job-positions' && row.name !== existing.name) {
      await peoplePrisma.employee.updateMany({ where: { orgId, jobPositionId: row.id }, data: { designation: row.name } });
    }
    res.json({ item: row });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.delete('/orgs/:orgId/people/structure/:kind/:id', can(PermissionAction.DELETE, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const kind = kindOf(req);
  if (!kind) return res.status(404).json({ error: 'Unknown list.' });
  const { accountId, orgId } = req.tenant!;
  const cfg = STRUCTURE_KINDS[kind];
  const model: any = (peoplePrisma as any)[cfg.model];
  const existing = await model.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  const inUse = await peoplePrisma.employee.count({ where: { orgId, [cfg.usedBy]: existing.id } as any });
  if (inUse) {
    return res.status(409).json({ error: `${inUse} ${inUse === 1 ? 'person uses' : 'people use'} this. Move them first, or mark it inactive.` });
  }
  await model.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tags and notes
// ---------------------------------------------------------------------------

peopleRouter.get('/orgs/:orgId/people/tags', can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  res.json({ tags: await peoplePrisma.employeeTag.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } }) });
});

peopleRouter.post('/orgs/:orgId/people/tags', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({ name: z.string().trim().min(1).max(40), color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A tag needs a name, and a colour like #E54F38.' });
  try {
    const tag = await peoplePrisma.employeeTag.create({
      data: { accountId, orgId, name: parsed.data.name, ...(parsed.data.color ? { color: parsed.data.color } : {}), createdByUserId: req.auth!.userId },
    });
    res.status(201).json({ tag });
  } catch (e) {
    return sendError(res, e);
  }
});

peopleRouter.delete('/orgs/:orgId/people/tags/:id', can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const tag = await peoplePrisma.employeeTag.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!tag) return res.status(404).json({ error: 'No such tag.' });
  await peoplePrisma.employeeTag.delete({ where: { id: tag.id } });
  res.json({ ok: true });
});

peopleRouter.get('/orgs/:orgId/people/employees/:id/notes', can(PermissionAction.VIEW, NOTES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  res.json({
    notes: await peoplePrisma.employeeNote.findMany({ where: { orgId, employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
  });
});

peopleRouter.post('/orgs/:orgId/people/employees/:id/notes', can(PermissionAction.CREATE, NOTES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  const parsed = z.object({ body: z.string().trim().min(1, 'Write something first.').max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid note.' });
  const note = await peoplePrisma.employeeNote.create({
    data: { accountId, orgId, employeeId: employee.id, body: parsed.data.body, createdByUserId: req.auth!.userId },
  });
  res.status(201).json({ note });
});

peopleRouter.delete('/orgs/:orgId/people/notes/:noteId', can(PermissionAction.DELETE, NOTES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const note = await peoplePrisma.employeeNote.findFirst({ where: { id: String(req.params.noteId), accountId, orgId } });
  if (!note) return res.status(404).json({ error: 'No such note.' });
  await peoplePrisma.employeeNote.delete({ where: { id: note.id } });
  res.json({ ok: true });
});
