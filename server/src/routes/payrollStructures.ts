import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { validateFormula } from '../services/payroll/formula.js';
import { calculateStructure, type EngineComponent } from '../services/payroll/engine/calculator.js';

/**
 * A reusable salary template: which components a person on it is paid, and how.
 *
 * A structure is not a salary. It is the shape of one — Basic at half of CTC,
 * HRA at two fifths of Basic, an allowance taking the remainder — and it turns
 * into an actual salary only when an assignment gives it a CTC and a person.
 * That separation is what lets one structure serve four hundred people on four
 * hundred different packages.
 *
 * Effective-dated, and immutable once it has produced a payslip. A structure
 * edited in place would rewrite payslips already issued from it, because what
 * the slip stores is a snapshot but what a report joins on is the structure.
 * Changing what a structure pays means a new structure from a new date, which
 * is also how an auditor expects to read it.
 *
 * The preview is the interesting part of this route. It calculates without
 * saving anything, using the same engine a pay run uses, so what somebody sees
 * while they are still typing is what they will actually be paid. A preview
 * computed by a different code path would be a second answer, and the one on
 * the screen would be the one nobody could reproduce.
 */
export const payrollStructuresRouter = Router();
payrollStructuresRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.structures;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const lineSchema = z.object({
  componentId: z.string().trim().min(1),
  /* Null means "whatever the component itself says". A structure overrides
     only what it needs to — the usual case is nothing. */
  calculationMethod: z.enum(['FIXED', 'PERCENTAGE', 'FORMULA', 'VARIABLE', 'STATUTORY', 'BALANCING']).optional().nullable(),
  amount: z.number().finite().min(0).optional().nullable(),
  percentage: z.number().finite().min(0).max(1000).optional().nullable(),
  formula: z.string().trim().max(500).optional().nullable(),
  calculationBase: z.string().trim().max(40).optional().nullable(),
  isBalancing: z.boolean().default(false),
  displayOrder: z.number().int().min(0).default(0),
});

const bodySchema = z.object({
  name: z.string().trim().min(1, 'A structure needs a name.').max(120),
  code: z.string().trim().max(40).optional().nullable(),
  payGroupId: z.string().trim().optional().nullable(),
  frequency: z.enum(['MONTHLY', 'WEEKLY', 'FORTNIGHTLY']).default('MONTHLY'),
  effectiveFrom: z.string().trim().regex(ISO_DATE, 'The effective date must be a date.'),
  effectiveTo: z.string().trim().regex(ISO_DATE).optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  description: z.string().trim().max(500).optional().nullable(),
  branchId: z.string().trim().optional().nullable(),
  components: z.array(lineSchema).default([]),
});

type Body = z.infer<typeof bodySchema>;

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, FORTNIGHTLY: 26, WEEKLY: 52 };

/**
 * A structure's lines, merged with the components they point at.
 *
 * The override wins where it is set; the component answers for everything else.
 * The engine never sees this distinction — by the time it runs, each line is
 * one settled set of rules.
 */
function toEngineComponents(
  lines: { componentId: string; calculationMethod: string | null; amount: any; percentage: any; formula: string | null; calculationBase: string | null; isBalancing: boolean; displayOrder: number }[],
  components: any[]
): { engine: EngineComponent[]; missing: string[] } {
  const byId = new Map(components.map((c) => [c.id, c]));
  const missing: string[] = [];
  const engine: EngineComponent[] = [];

  for (const line of lines) {
    const c = byId.get(line.componentId);
    if (!c) {
      missing.push(line.componentId);
      continue;
    }
    engine.push({
      componentId: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      calculationMethod: (line.calculationMethod || c.calculationMethod) as EngineComponent['calculationMethod'],
      amount: Number(line.amount ?? c.amount ?? 0),
      percentage: Number(line.percentage ?? c.percentage ?? 0),
      formula: line.formula ?? c.formula ?? null,
      calculationBase: line.calculationBase ?? c.calculationBase ?? null,
      rounding: c.rounding,
      statutoryScheme: c.statutoryScheme,
      isTaxable: !!c.isTaxable,
      prorate: !!c.prorate,
      includeInPfWage: !!c.includeInPfWage,
      includeInEsiWage: !!c.includeInEsiWage,
      includeInGratuityWage: !!c.includeInGratuityWage,
      includeInGross: !!c.includeInGross,
      includeInNetPay: !!c.includeInNetPay,
      isVariable: !!c.isVariable,
      isBalancing: !!line.isBalancing,
      displayOrder: line.displayOrder ?? c.displayOrder ?? 0,
      expenseLedgerId: c.expenseLedgerId,
      liabilityLedgerId: c.liabilityLedgerId,
    });
  }
  return { engine, missing };
}

const shape = (row: any) => ({
  id: row.id,
  name: row.name,
  code: row.code || '',
  payGroupId: row.payGroupId || null,
  frequency: row.frequency,
  effectiveFrom: row.effectiveFrom,
  effectiveTo: row.effectiveTo || null,
  status: row.status,
  description: row.description || '',
  branchId: row.branchId || null,
  components: (row.components || [])
    .slice()
    .sort((a: any, b: any) => a.displayOrder - b.displayOrder)
    .map((l: any) => ({
      id: l.id,
      componentId: l.componentId,
      calculationMethod: l.calculationMethod || null,
      amount: l.amount == null ? null : Number(l.amount),
      percentage: l.percentage == null ? null : Number(l.percentage),
      formula: l.formula || null,
      calculationBase: l.calculationBase || null,
      isBalancing: !!l.isBalancing,
      displayOrder: l.displayOrder,
    })),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Whether any payslip was produced from this structure. */
async function isInUse(orgId: string, structureId: string) {
  const assigned = await payrollPrisma.salaryAssignment.findFirst({
    where: { orgId, structureId },
    select: { id: true },
  });
  return Boolean(assigned);
}

/** The rules a structure has to satisfy before it can be stored. */
async function problems(orgId: string, body: Body): Promise<string | null> {
  if (body.effectiveTo && body.effectiveTo < body.effectiveFrom) {
    return 'A structure cannot stop being effective before it starts.';
  }
  if (!body.components.length) return 'A salary structure needs at least one component.';

  const ids = body.components.map((l) => l.componentId);
  if (new Set(ids).size !== ids.length) return 'The same component cannot appear twice in one structure.';

  const balancing = body.components.filter((l) => l.isBalancing);
  if (balancing.length > 1) return 'Only one component can take the balance of CTC.';

  const found = await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: ids } } });
  if (found.length !== ids.length) return 'This structure refers to a component that no longer exists.';

  /*
   * A formula override is checked against the codes THIS structure has. A line
   * referring to a component the structure does not include would evaluate to
   * zero forever, which reads on a payslip as a deliberate nil rather than a
   * mistake.
   */
  const codes = found.map((c) => c.code);
  for (const line of body.components) {
    const formula = String(line.formula || '').trim();
    if (!formula) continue;
    const verdict = validateFormula(formula, undefined, codes);
    if (!verdict.ok) {
      const c = found.find((x) => x.id === line.componentId);
      return `${c?.name || 'A component'}: ${verdict.error}`;
    }
  }
  return null;
}

payrollStructuresRouter.get(
  '/orgs/:orgId/payroll/structures',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const rows = await payrollPrisma.salaryStructure.findMany({
      where: {
        accountId,
        orgId,
        ...(String(req.query.status || '').trim() ? { status: String(req.query.status) } : {}),
        ...(String(req.query.payGroupId || '').trim() ? { payGroupId: String(req.query.payGroupId) } : {}),
      },
      include: { components: true },
      orderBy: [{ effectiveFrom: 'desc' }, { name: 'asc' }],
    });

    const counts = await Promise.all(
      rows.map((r) => payrollPrisma.salaryAssignment.count({ where: { orgId, structureId: r.id, status: 'ACTIVE' } }))
    );
    res.json({ structures: rows.map((r, i) => ({ ...shape(r), assignedCount: counts[i] })) });
  }
);

payrollStructuresRouter.get(
  '/orgs/:orgId/payroll/structures/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const row = await payrollPrisma.salaryStructure.findFirst({
      where: { id: String(req.params.id), accountId, orgId },
      include: { components: true },
    });
    if (!row) return res.status(404).json({ error: 'No such salary structure.' });
    const assignedCount = await payrollPrisma.salaryAssignment.count({
      where: { orgId, structureId: row.id, status: 'ACTIVE' },
    });
    res.json({ structure: { ...shape(row), assignedCount } });
  }
);

payrollStructuresRouter.post(
  '/orgs/:orgId/payroll/structures',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid structure.' });
    const body = parsed.data;

    const problem = await problems(orgId, body);
    if (problem) return res.status(400).json({ error: problem });

    const clash = await payrollPrisma.salaryStructure.findFirst({
      where: { orgId, name: body.name, effectiveFrom: body.effectiveFrom },
      select: { id: true },
    });
    if (clash) {
      return res.status(409).json({ error: `A structure called ${body.name} already starts on ${body.effectiveFrom}.` });
    }

    const row = await payrollPrisma.salaryStructure.create({
      data: {
        accountId,
        orgId,
        branchId: body.branchId || null,
        name: body.name,
        code: body.code || null,
        payGroupId: body.payGroupId || null,
        frequency: body.frequency,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo || null,
        status: body.status,
        description: body.description || null,
        createdByUserId: req.auth!.userId,
        components: {
          create: body.components.map((l, i) => ({
            accountId,
            orgId,
            componentId: l.componentId,
            calculationMethod: l.calculationMethod || null,
            amount: l.amount ?? null,
            percentage: l.percentage ?? null,
            formula: l.formula || null,
            calculationBase: l.calculationBase || null,
            isBalancing: l.isBalancing,
            displayOrder: l.displayOrder ?? i,
          })),
        },
      },
      include: { components: true },
    });
    res.status(201).json({ structure: { ...shape(row), assignedCount: 0 } });
  }
);

payrollStructuresRouter.put(
  '/orgs/:orgId/payroll/structures/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.salaryStructure.findFirst({
      where: { id: String(req.params.id), accountId, orgId },
      include: { components: true },
    });
    if (!existing) return res.status(404).json({ error: 'No such salary structure.' });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid structure.' });
    const body = parsed.data;

    const problem = await problems(orgId, body);
    if (problem) return res.status(400).json({ error: problem });

    /*
     * Once somebody is on this structure, what it pays is frozen.
     *
     * The payslips already issued carry their own snapshot, so they do not
     * change — but every report that groups by structure would start describing
     * past months with today's rules. Raising pay means a new structure from a
     * new date, which is also how the change is meant to read to an auditor.
     * The name, the description and retiring it are all still available.
     */
    const inUse = await isInUse(orgId, existing.id);
    if (inUse) {
      const sameLines =
        existing.components.length === body.components.length &&
        body.components.every((l) => {
          const was = existing.components.find((x) => x.componentId === l.componentId);
          if (!was) return false;
          return (
            (was.calculationMethod || null) === (l.calculationMethod || null) &&
            Number(was.amount ?? 0) === Number(l.amount ?? 0) &&
            Number(was.percentage ?? 0) === Number(l.percentage ?? 0) &&
            (was.formula || null) === (l.formula || null) &&
            (was.calculationBase || null) === (l.calculationBase || null) &&
            was.isBalancing === l.isBalancing
          );
        });

      if (!sameLines || body.effectiveFrom !== existing.effectiveFrom || body.frequency !== existing.frequency) {
        return res.status(409).json({
          error:
            'People are on this structure, so what it pays can no longer change. ' +
            'Create a new structure from the date the new pay applies.',
          code: 'STRUCTURE_IN_USE',
        });
      }
    }

    const row = await payrollPrisma.$transaction(async (tx) => {
      /* Replaced wholesale rather than diffed: the lines have no meaning apart
         from the structure, and a partial update is how an ordering ends up
         half applied. */
      await tx.salaryStructureComponent.deleteMany({ where: { structureId: existing.id } });
      return tx.salaryStructure.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          code: body.code || null,
          payGroupId: body.payGroupId || null,
          frequency: body.frequency,
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo || null,
          status: body.status,
          description: body.description || null,
          branchId: body.branchId || null,
          components: {
            create: body.components.map((l, i) => ({
              accountId,
              orgId,
              componentId: l.componentId,
              calculationMethod: l.calculationMethod || null,
              amount: l.amount ?? null,
              percentage: l.percentage ?? null,
              formula: l.formula || null,
              calculationBase: l.calculationBase || null,
              isBalancing: l.isBalancing,
              displayOrder: l.displayOrder ?? i,
            })),
          },
        },
        include: { components: true },
      });
    });

    const assignedCount = await payrollPrisma.salaryAssignment.count({
      where: { orgId, structureId: row.id, status: 'ACTIVE' },
    });
    res.json({ structure: { ...shape(row), assignedCount } });
  }
);

payrollStructuresRouter.delete(
  '/orgs/:orgId/payroll/structures/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.DELETE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const existing = await payrollPrisma.salaryStructure.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!existing) return res.status(404).json({ error: 'No such salary structure.' });

    if (await isInUse(orgId, existing.id)) {
      return res.status(409).json({
        error: 'People have been assigned to this structure. Archive it instead, so their payslips keep the structure they name.',
        code: 'STRUCTURE_IN_USE',
      });
    }

    await payrollPrisma.salaryStructure.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }
);

/**
 * What a structure pays, without saving it.
 *
 * Deliberately accepts an unsaved structure: the screen calls this while
 * somebody is still assembling one, which is exactly when the answer is worth
 * having. It runs the same engine a payroll run uses — a preview computed
 * another way would be a second answer to the same question, and the one on
 * screen would be the one nobody could reproduce.
 */
payrollStructuresRouter.post(
  '/orgs/:orgId/payroll/structures/preview',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;

    const schema = z.object({
      components: z.array(lineSchema).default([]),
      frequency: z.enum(['MONTHLY', 'WEEKLY', 'FORTNIGHTLY']).default('MONTHLY'),
      annualCtc: z.number().finite().min(0).default(0),
      workingDays: z.number().finite().min(0).max(366).default(30),
      payableDays: z.number().finite().min(0).max(366).default(30),
      lwpDays: z.number().finite().min(0).max(366).default(0),
      variableAmounts: z.record(z.number().finite()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid preview.' });
    const body = parsed.data;

    const ids = body.components.map((l) => l.componentId);
    const components = ids.length
      ? await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: ids } } })
      : [];

    const { engine, missing } = toEngineComponents(body.components as any, components);
    if (missing.length) {
      return res.status(400).json({ error: 'This structure refers to a component that no longer exists.' });
    }

    const result = calculateStructure(engine, {
      annualCtc: body.annualCtc,
      periodsPerYear: PERIODS_PER_YEAR[body.frequency] ?? 12,
      workingDays: body.workingDays,
      payableDays: body.payableDays,
      lwpDays: body.lwpDays,
      variableAmounts: body.variableAmounts,
    });

    res.json({
      preview: {
        ...result,
        /* Annual figures the screen shows beside the monthly ones, so a CTC
           conversation and a payslip conversation use the same numbers. */
        annual: {
          gross: Math.round(result.grossEarnings * (PERIODS_PER_YEAR[body.frequency] ?? 12)),
          netPay: Math.round(result.netPay * (PERIODS_PER_YEAR[body.frequency] ?? 12)),
          employerCost: Math.round(result.employerCost * (PERIODS_PER_YEAR[body.frequency] ?? 12)),
        },
      },
    });
  }
);
