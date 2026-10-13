import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { seedStatutoryRules } from '../services/payroll/statutory/resolve.js';
import { SCHEME_NAMES } from '../services/payroll/statutory/defaults.js';

/**
 * The statutory schemes a company runs under, and the dated rules behind them.
 *
 * Two things this route is careful about.
 *
 * A scheme arrives switched off. A deduction nobody asked for is money taken
 * from somebody's pay by default, so a company says which schemes apply to it.
 *
 * A rule is never edited once payroll has used it. Rates change on dates
 * somebody else picks, and a payslip records the version it was computed
 * under — editing a live rate in place would restate months that have already
 * been filed, with no way to tell what the old answer had been. Changing a rate
 * means a new version from the day it changes.
 */
export const payrollStatutoryRouter = Router();
payrollStatutoryRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.settings;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const shapeRule = (r: any) => ({
  id: r.id,
  schemeId: r.schemeId,
  jurisdiction: r.jurisdiction || null,
  version: r.version,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo || null,
  employeeRate: Number(r.employeeRate ?? 0),
  employerRate: Number(r.employerRate ?? 0),
  wageCeiling: r.wageCeiling == null ? null : Number(r.wageCeiling),
  eligibilityThreshold: r.eligibilityThreshold == null ? null : Number(r.eligibilityThreshold),
  rounding: r.rounding,
  config: (() => {
    try {
      return JSON.parse(String(r.configJson || '{}')) || {};
    } catch {
      return {};
    }
  })(),
  status: r.status,
});

payrollStatutoryRouter.get(
  '/orgs/:orgId/payroll/statutory',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const schemes = await payrollPrisma.statutoryScheme.findMany({ where: { accountId, orgId }, orderBy: { code: 'asc' } });
    const rules = schemes.length
      ? await payrollPrisma.statutoryRule.findMany({
          where: { orgId, schemeId: { in: schemes.map((s) => s.id) } },
          orderBy: [{ effectiveFrom: 'desc' }],
        })
      : [];

    /* How many payslips were computed under each rule — the reason a rule
       cannot simply be edited. */
    const usage = await payrollPrisma.payrollCalculationTrace.groupBy({
      by: ['statutoryRuleId'],
      where: { orgId, statutoryRuleId: { not: null } },
      _count: { _all: true },
    });
    const usedBy = new Map(usage.map((u) => [u.statutoryRuleId, u._count._all]));

    res.json({
      schemes: schemes.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name || SCHEME_NAMES[s.code] || s.code,
        description: s.description || '',
        isEnabled: !!s.isEnabled,
        registrationNumber: s.registrationNumber || '',
        rules: rules.filter((r) => r.schemeId === s.id).map((r) => ({ ...shapeRule(r), usedOnPayslips: usedBy.get(r.id) || 0 })),
      })),
    });
  }
);

/** Give a company the rates to start from. Idempotent, and never overwrites. */
payrollStatutoryRouter.post(
  '/orgs/:orgId/payroll/statutory/seed',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const created = await seedStatutoryRules(orgId, accountId, req.auth!.userId);
    res.json({ created, count: created.length });
  }
);

payrollStatutoryRouter.put(
  '/orgs/:orgId/payroll/statutory/schemes/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const scheme = await payrollPrisma.statutoryScheme.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!scheme) return res.status(404).json({ error: 'No such statutory scheme.' });

    const schema = z.object({
      isEnabled: z.boolean(),
      registrationNumber: z.string().trim().max(60).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say whether the scheme applies.' });

    /* Switching a scheme on with no rule behind it would compute nothing and
       say nothing about why. */
    if (parsed.data.isEnabled) {
      const rules = await payrollPrisma.statutoryRule.count({ where: { orgId, schemeId: scheme.id, status: 'ACTIVE' } });
      if (!rules) {
        return res.status(409).json({
          error: `${scheme.name} has no rates set, so switching it on would deduct nothing. Add a rate first.`,
          code: 'SCHEME_HAS_NO_RULES',
        });
      }
    }

    const row = await payrollPrisma.statutoryScheme.update({
      where: { id: scheme.id },
      data: { isEnabled: parsed.data.isEnabled, registrationNumber: parsed.data.registrationNumber?.trim() || null },
    });
    res.json({ scheme: { id: row.id, code: row.code, isEnabled: row.isEnabled, registrationNumber: row.registrationNumber || '' } });
  }
);

/**
 * A new version of a rate, from the day it changes.
 *
 * This is the only way a rate moves. The version it supersedes is closed the
 * day before, so a payroll run for any past date still finds the rule that
 * applied then.
 */
payrollStatutoryRouter.post(
  '/orgs/:orgId/payroll/statutory/schemes/:id/rules',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const scheme = await payrollPrisma.statutoryScheme.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!scheme) return res.status(404).json({ error: 'No such statutory scheme.' });

    const schema = z.object({
      jurisdiction: z.string().trim().max(60).optional().nullable(),
      effectiveFrom: z.string().trim().regex(ISO_DATE, 'The effective date must be a date.'),
      employeeRate: z.number().finite().min(0).max(100).default(0),
      employerRate: z.number().finite().min(0).max(100).default(0),
      wageCeiling: z.number().finite().min(0).optional().nullable(),
      eligibilityThreshold: z.number().finite().min(0).optional().nullable(),
      rounding: z.enum(['NONE', 'NEAREST', 'UP', 'DOWN']).default('NEAREST'),
      config: z.record(z.any()).default({}),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid rate.' });
    const body = parsed.data;

    const jurisdiction = body.jurisdiction?.trim().toUpperCase() || null;

    const clash = await payrollPrisma.statutoryRule.findFirst({
      where: { orgId, schemeId: scheme.id, jurisdiction, effectiveFrom: body.effectiveFrom },
      select: { id: true },
    });
    if (clash) {
      return res.status(409).json({
        error: `A ${scheme.name} rate already starts on ${body.effectiveFrom}${jurisdiction ? ` for ${jurisdiction}` : ''}.`,
        code: 'RULE_EXISTS',
      });
    }

    const row = await payrollPrisma.$transaction(async (tx) => {
      /* The version before this one ends the day before it starts, so no two
         versions ever cover the same day. */
      const previous = await tx.statutoryRule.findFirst({
        where: { orgId, schemeId: scheme.id, jurisdiction, status: 'ACTIVE', effectiveFrom: { lt: body.effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (previous) {
        const end = new Date(`${body.effectiveFrom}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() - 1);
        await tx.statutoryRule.update({
          where: { id: previous.id },
          data: { effectiveTo: end.toISOString().slice(0, 10), status: 'SUPERSEDED' },
        });
      }
      return tx.statutoryRule.create({
        data: {
          accountId,
          orgId,
          schemeId: scheme.id,
          jurisdiction,
          effectiveFrom: body.effectiveFrom,
          version: body.effectiveFrom,
          employeeRate: body.employeeRate,
          employerRate: body.employerRate,
          wageCeiling: body.wageCeiling ?? null,
          eligibilityThreshold: body.eligibilityThreshold ?? null,
          rounding: body.rounding,
          configJson: JSON.stringify(body.config || {}),
          status: 'ACTIVE',
          createdByUserId: req.auth!.userId,
        },
      });
    });

    res.status(201).json({ rule: shapeRule(row) });
  }
);

/**
 * Remove a rate that has never been used.
 *
 * One that has produced a payslip is a permanent record: the payslip names its
 * version, and deleting it would leave figures nobody could explain.
 */
payrollStatutoryRouter.delete(
  '/orgs/:orgId/payroll/statutory/rules/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const rule = await payrollPrisma.statutoryRule.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!rule) return res.status(404).json({ error: 'No such rate.' });

    const used = await payrollPrisma.payrollCalculationTrace.count({ where: { orgId, statutoryRuleId: rule.id } });
    if (used > 0) {
      return res.status(409).json({
        error: `This rate produced ${used} payslip line${used === 1 ? '' : 's'}, so it is a permanent record. Supersede it with a new rate instead.`,
        code: 'RULE_IN_USE',
      });
    }

    await payrollPrisma.$transaction(async (tx) => {
      /*
       * The version this one closed reopens, taking over its window.
       *
       * Publishing a rate ends the one before it the day prior. Deleting the
       * new one without undoing that would leave the old one SUPERSEDED with an
       * end date and nothing in force after it — and `loadRules` reads only
       * ACTIVE rules, so payroll would quietly deduct nil from that date on
       * rather than say anything.
       */
      const previous = await tx.statutoryRule.findFirst({
        where: {
          orgId,
          schemeId: rule.schemeId,
          jurisdiction: rule.jurisdiction,
          id: { not: rule.id },
          effectiveFrom: { lt: rule.effectiveFrom },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      await tx.statutoryRule.delete({ where: { id: rule.id } });
      if (previous) {
        await tx.statutoryRule.update({
          where: { id: previous.id },
          data: { effectiveTo: rule.effectiveTo || null, status: rule.status },
        });
      }
    });
    res.json({ ok: true });
  }
);
