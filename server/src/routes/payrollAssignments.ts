import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';

/**
 * What one person is paid, from a date.
 *
 * An assignment is where a structure stops being a template and becomes a
 * salary: this person, on that structure, at this CTC, from this date.
 *
 * ## Never edited to change pay
 *
 * A raise writes a NEW assignment from the date the new pay applies. The old
 * one keeps its dates and its figure, so a payroll run for March finds March's
 * salary however many raises have happened since. Editing the existing row
 * instead — the obvious thing, and the wrong thing — would silently restate
 * every past payslip's basis, and a payslip whose basis has moved is a payslip
 * nobody can defend.
 *
 * So the rule is: an assignment that has produced a payslip is immutable. One
 * that has not can still be corrected, because a typo caught the same afternoon
 * is not history.
 *
 * ## Assignments do not overlap
 *
 * One person has one salary on any given day. Writing a new assignment closes
 * the one before it the day before the new one starts, which is done here
 * rather than asked of whoever is typing — an open-ended assignment left open
 * while a second one starts is two salaries for the same day, and the run would
 * pick whichever it saw first.
 */
export const payrollAssignmentsRouter = Router();
payrollAssignmentsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.assignments;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, FORTNIGHTLY: 26, WEEKLY: 52 };

const bodySchema = z.object({
  employeeId: z.string().trim().min(1, 'An assignment needs an employee.'),
  structureId: z.string().trim().min(1, 'An assignment needs a salary structure.'),
  payGroupId: z.string().trim().optional().nullable(),
  effectiveFrom: z.string().trim().regex(ISO_DATE, 'The effective date must be a date.'),
  annualCtc: z.number().finite().min(0, 'A salary cannot be negative.'),
  costCenterId: z.string().trim().optional().nullable(),
  branchId: z.string().trim().optional().nullable(),
});

const blank = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** The day before a date, so one assignment closes where the next begins. */
const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const shape = (row: any, extra: Record<string, unknown> = {}) => ({
  id: row.id,
  employeeId: row.employeeId,
  structureId: row.structureId,
  payGroupId: row.payGroupId || null,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo || null,
  annualCtc: Number(row.annualCtc ?? 0),
  monthlyCtc: Number(row.monthlyCtc ?? 0),
  costCenterId: row.costCenterId || null,
  branchId: row.branchId || null,
  status: row.status,
  revisionId: row.revisionId || null,
  createdAt: row.createdAt,
  ...extra,
});

/** Whether a payslip has been produced on this assignment. */
async function hasPayslip(orgId: string, assignmentId: string) {
  const slip = await payrollPrisma.salarySlip.findFirst({
    where: { orgId, assignmentSnapshotJson: { contains: `"assignmentId":"${assignmentId}"` } },
    select: { id: true },
  });
  return Boolean(slip);
}

payrollAssignmentsRouter.get(
  '/orgs/:orgId/payroll/assignments',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const employeeId = String(req.query.employeeId || '').trim();
    const rows = await payrollPrisma.salaryAssignment.findMany({
      where: {
        accountId,
        orgId,
        ...(employeeId ? { employeeId } : {}),
        ...(String(req.query.status || '').trim() ? { status: String(req.query.status) } : {}),
      },
      orderBy: [{ effectiveFrom: 'desc' }],
      take: Math.min(500, Math.max(1, Number(req.query.limit || 200))),
    });

    /* The names the screen shows, fetched once rather than per row. */
    const [employees, structures] = await Promise.all([
      peoplePrisma.employee.findMany({
        where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } },
        select: { id: true, name: true, code: true, designation: true, department: true, status: true },
      }),
      payrollPrisma.salaryStructure.findMany({
        where: { orgId, id: { in: [...new Set(rows.map((r) => r.structureId))] } },
        select: { id: true, name: true, frequency: true },
      }),
    ]);
    const byEmployee = new Map(employees.map((e) => [e.id, e]));
    const byStructure = new Map(structures.map((s) => [s.id, s]));

    res.json({
      assignments: rows.map((r) =>
        shape(r, {
          employee: byEmployee.get(r.employeeId) || null,
          structure: byStructure.get(r.structureId) || null,
        })
      ),
    });
  }
);

payrollAssignmentsRouter.post(
  '/orgs/:orgId/payroll/assignments',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid assignment.' });
    const body = parsed.data;

    const [employee, structure] = await Promise.all([
      peoplePrisma.employee.findFirst({ where: { orgId, id: body.employeeId } }),
      payrollPrisma.salaryStructure.findFirst({ where: { orgId, id: body.structureId } }),
    ]);
    if (!employee) return res.status(400).json({ error: 'No such employee.' });
    if (!structure) return res.status(400).json({ error: 'No such salary structure.' });

    if (structure.status === 'ARCHIVED') {
      return res.status(400).json({ error: `${structure.name} is archived, so nobody new can be put on it.` });
    }

    /* A structure that is not yet effective cannot pay anybody, and one that
       has ended cannot start. Both are typed dates, and both are silent
       disasters if they are not checked. */
    if (body.effectiveFrom < structure.effectiveFrom) {
      return res.status(400).json({
        error: `${structure.name} only takes effect on ${structure.effectiveFrom}, so a salary cannot start on it before then.`,
      });
    }
    if (structure.effectiveTo && body.effectiveFrom > structure.effectiveTo) {
      return res.status(400).json({ error: `${structure.name} stopped being effective on ${structure.effectiveTo}.` });
    }
    if (employee.dateOfJoining && body.effectiveFrom < employee.dateOfJoining) {
      return res.status(400).json({
        error: `${employee.name} joined on ${employee.dateOfJoining}, so a salary cannot start before that.`,
      });
    }

    const existing = await payrollPrisma.salaryAssignment.findFirst({
      where: { orgId, employeeId: body.employeeId, effectiveFrom: body.effectiveFrom },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({
        error: `${employee.name} already has a salary starting on ${body.effectiveFrom}.`,
        code: 'ASSIGNMENT_EXISTS',
      });
    }

    const periods = PERIODS_PER_YEAR[structure.frequency] ?? 12;
    const monthlyCtc = Math.round((body.annualCtc / periods) * 100) / 100;

    /*
     * The previous salary closes the day before this one starts, in the same
     * transaction. Two open assignments would be two salaries for one day and
     * the run would take whichever it read first.
     */
    const row = await payrollPrisma.$transaction(async (tx) => {
      const previous = await tx.salaryAssignment.findFirst({
        where: { orgId, employeeId: body.employeeId, status: 'ACTIVE', effectiveFrom: { lt: body.effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (previous) {
        await tx.salaryAssignment.update({
          where: { id: previous.id },
          data: { effectiveTo: dayBefore(body.effectiveFrom), status: 'SUPERSEDED' },
        });
      }
      return tx.salaryAssignment.create({
        data: {
          accountId,
          orgId,
          branchId: blank(body.branchId) ?? employee.branchId ?? null,
          employeeId: body.employeeId,
          structureId: body.structureId,
          payGroupId: blank(body.payGroupId),
          effectiveFrom: body.effectiveFrom,
          annualCtc: body.annualCtc,
          monthlyCtc,
          costCenterId: blank(body.costCenterId),
          status: 'ACTIVE',
          createdByUserId: req.auth!.userId,
        },
      });
    });

    res.status(201).json({ assignment: shape(row, { employee, structure }) });
  }
);

payrollAssignmentsRouter.put(
  '/orgs/:orgId/payroll/assignments/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.salaryAssignment.findFirst({
      where: { id: String(req.params.id), accountId, orgId },
    });
    if (!existing) return res.status(404).json({ error: 'No such salary assignment.' });

    /*
     * Correcting a typo is allowed; rewriting history is not. Once a payslip
     * has been produced on this assignment, the way to change pay is a new
     * assignment from a new date — which is also how a raise is meant to read.
     */
    if (await hasPayslip(orgId, existing.id)) {
      return res.status(409).json({
        error:
          'Somebody has already been paid on this salary, so it can no longer be edited. ' +
          'Record the new pay as a new salary from the date it applies.',
        code: 'ASSIGNMENT_PAID',
      });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid assignment.' });
    const body = parsed.data;

    if (body.employeeId !== existing.employeeId) {
      return res.status(400).json({ error: 'A salary cannot be moved to another person. Record one for them instead.' });
    }

    const structure = await payrollPrisma.salaryStructure.findFirst({ where: { orgId, id: body.structureId } });
    if (!structure) return res.status(400).json({ error: 'No such salary structure.' });
    if (body.effectiveFrom < structure.effectiveFrom) {
      return res.status(400).json({
        error: `${structure.name} only takes effect on ${structure.effectiveFrom}.`,
      });
    }

    const periods = PERIODS_PER_YEAR[structure.frequency] ?? 12;
    const row = await payrollPrisma.salaryAssignment.update({
      where: { id: existing.id },
      data: {
        structureId: body.structureId,
        payGroupId: blank(body.payGroupId),
        effectiveFrom: body.effectiveFrom,
        annualCtc: body.annualCtc,
        monthlyCtc: Math.round((body.annualCtc / periods) * 100) / 100,
        costCenterId: blank(body.costCenterId),
        branchId: blank(body.branchId),
      },
    });
    res.json({ assignment: shape(row) });
  }
);

payrollAssignmentsRouter.delete(
  '/orgs/:orgId/payroll/assignments/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.DELETE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.salaryAssignment.findFirst({
      where: { id: String(req.params.id), accountId, orgId },
    });
    if (!existing) return res.status(404).json({ error: 'No such salary assignment.' });

    if (await hasPayslip(orgId, existing.id)) {
      return res.status(409).json({
        error: 'Somebody has been paid on this salary, so it is a permanent record.',
        code: 'ASSIGNMENT_PAID',
      });
    }

    /* Deleting the current salary reopens the one it superseded, otherwise the
       person is left with no salary at all on a day they were employed. */
    await payrollPrisma.$transaction(async (tx) => {
      await tx.salaryAssignment.delete({ where: { id: existing.id } });
      const previous = await tx.salaryAssignment.findFirst({
        where: { orgId, employeeId: existing.employeeId, effectiveFrom: { lt: existing.effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (previous && previous.status === 'SUPERSEDED') {
        await tx.salaryAssignment.update({
          where: { id: previous.id },
          data: { status: 'ACTIVE', effectiveTo: existing.effectiveTo ?? null },
        });
      }
    });

    res.json({ ok: true });
  }
);

/**
 * The salary in force for one person on one day.
 *
 * This is the question a payroll run asks for every employee, and the reason
 * assignments are dated rather than edited: the answer for a day in March must
 * stay the same however many raises have happened since.
 */
payrollAssignmentsRouter.get(
  '/orgs/:orgId/payroll/assignments/effective',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const employeeId = String(req.query.employeeId || '').trim();
    const onDate = String(req.query.on || '').trim();
    if (!employeeId || !ISO_DATE.test(onDate)) {
      return res.status(400).json({ error: 'Ask for an employee and a date.' });
    }

    const row = await payrollPrisma.salaryAssignment.findFirst({
      where: {
        accountId,
        orgId,
        employeeId,
        status: { not: 'CANCELLED' },
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    res.json({ assignment: row ? shape(row) : null });
  }
);
