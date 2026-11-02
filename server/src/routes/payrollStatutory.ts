import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { ensureStatutoryCatalogue, NOT_IN_FORCE, ruleNeedsCheck, seedStatutoryCatalogue } from '../services/payroll/statutory/resolve.js';
import { ruleInForce } from '../services/payroll/statutory/engine.js';
import { SCHEME_NAMES, SEED_CATALOGUE_VERSION } from '../services/payroll/statutory/defaults.js';
import { canonicalState, stateLabel } from '../constants/stateLevies.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { todayIst } from '../utils/istDate.js';

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
  note: r.note || '',
  /* CLOR's figures, or a version the company published. */
  origin: r.origin === 'COMPANY' ? 'COMPANY' : r.origin === 'SEED' ? 'SEED' : null,
  /* CLOR could not confirm these from an official notice, and nobody has checked them yet. */
  needsCheck: ruleNeedsCheck(r),
  checkedAt: r.checkedAt || null,
});

payrollStatutoryRouter.get(
  '/orgs/:orgId/payroll/statutory',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    /*
     * A company that took the standard rates before gets CLOR's newer ones,
     * once (never over its own). Only for somebody who may edit the rates —
     * a read by a viewer writes nothing; the startup job covers the rest —
     * and a top-up that fails never fails the screen.
     */
    if (!(await authorize(req, PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE))) {
      await ensureStatutoryCatalogue(orgId, accountId, req.auth!.userId).catch((e) =>
        console.error(`[statutory-catalogue] ${orgId}:`, e instanceof Error ? e.message : e) // eslint-disable-line no-console
      );
    }

    const schemes = await payrollPrisma.statutoryScheme.findMany({ where: { accountId, orgId }, orderBy: { code: 'asc' } });
    const rules = schemes.length
      ? await payrollPrisma.statutoryRule.findMany({
          /* A CLOR rate the company removed is kept only so it does not come back. */
          where: { orgId, schemeId: { in: schemes.map((s) => s.id) }, status: { not: 'WITHDRAWN' } },
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

    /* The states payroll has people in, which is where an unconfirmed rule matters. */
    const profiles = await payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, payrollStatus: 'IN_PAYROLL' }, select: { professionalTaxState: true } });
    const peopleByState = new Map<string, number>();
    for (const p of profiles) {
      const st = canonicalState(p.professionalTaxState);
      if (st) peopleByState.set(st, (peopleByState.get(st) || 0) + 1);
    }

    /*
     * Check before use: a rule CLOR could not confirm, in force today (or on a
     * payslip) for a state the company has people in, that nobody has checked.
     */
    const today = todayIst();
    const checks: Array<{ ruleId: string; scheme: string; schemeName: string; state: string; version: string; effectiveFrom: string; note: string; people: number; usedOnPayslips: number }> = [];
    for (const s of schemes) {
      if (s.code !== 'PT' && s.code !== 'LWF') continue;
      const own = rules.filter((r) => r.schemeId === s.id);
      for (const [state, people] of peopleByState) {
        const inForce = ruleInForce(own, today, state);
        for (const r of own) {
          if (canonicalState(r.jurisdiction) !== state || !ruleNeedsCheck(r)) continue;
          if (r.id !== inForce?.id && !usedBy.get(r.id)) continue;
          checks.push({
            ruleId: r.id,
            scheme: s.code,
            schemeName: s.name || SCHEME_NAMES[s.code] || s.code,
            state: stateLabel(state),
            version: r.version,
            effectiveFrom: r.effectiveFrom,
            note: r.note || '',
            people,
            usedOnPayslips: usedBy.get(r.id) || 0,
          });
        }
      }
    }

    const setting = await payrollPrisma.payrollSetting.findUnique({ where: { orgId }, select: { lwfCoverage: true, lwfManagerDesignations: true, lwfSupervisorDesignations: true } });

    /* "CLOR has newer figures": offered beside the company's own rule, not in force until adopted. */
    const offers = schemes.flatMap((s) =>
      rules
        .filter((r) => r.schemeId === s.id && r.status === 'DRAFT' && r.origin === 'SEED')
        .map((r) => {
          const current = ruleInForce(rules.filter((o) => o.schemeId === s.id), today, r.jurisdiction);
          return {
            ruleId: r.id,
            scheme: s.code,
            schemeName: s.name || SCHEME_NAMES[s.code] || s.code,
            state: stateLabel(String(r.jurisdiction || '')),
            effectiveFrom: r.effectiveFrom,
            note: r.note || '',
            /* What stays in force until somebody adopts the offer. */
            yours: current && current.origin !== 'SEED' ? { effectiveFrom: current.effectiveFrom, version: current.version } : null,
          };
        })
    );

    res.json({
      checks,
      offers,
      states: [...peopleByState.entries()].map(([state, people]) => ({ state, label: stateLabel(state), people })).sort((a, b) => a.label.localeCompare(b.label)),
      lwf: lwfSettingsShape(setting),
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
    const { created, kept, offered } = await seedStatutoryCatalogue(orgId, accountId, req.auth!.userId);
    await payrollPrisma.payrollSetting.upsert({
      where: { orgId },
      update: { statutoryCatalogue: SEED_CATALOGUE_VERSION },
      create: { accountId, orgId, statutoryCatalogue: SEED_CATALOGUE_VERSION, updatedByUserId: req.auth!.userId },
    });
    /* `kept`: newer CLOR figures not added because the company's own rate there is later. */
    /* `offered`: newer CLOR figures beside the company's own, waiting as drafts to be adopted. */
    res.json({ created, count: created.length, kept, offered });
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
      config: z.record(z.string(), z.any()).default({}),
      note: z.string().trim().max(1000).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid rate.' });
    const body = parsed.data;

    /* One spelling per state, so "KA" and "Karnataka" are the same rule. */
    const jurisdiction = (scheme.code === 'PT' || scheme.code === 'LWF' ? canonicalState(body.jurisdiction) : body.jurisdiction?.trim().toUpperCase()) || null;

    /*
     * A rate already starting that day. The company's own: refused — remove it
     * or pick another date. Only CLOR's: a correction from the same date is
     * allowed as a suffixed version (2023-04-01.2, .3…), the way CLOR corrected
     * Maharashtra, and CLOR's version is closed so it never applies again.
     */
    const sameDay = await payrollPrisma.statutoryRule.findMany({
      where: { orgId, schemeId: scheme.id, jurisdiction, effectiveFrom: body.effectiveFrom },
      select: { id: true, origin: true, version: true, status: true },
    });
    if (sameDay.some((r) => r.origin !== 'SEED')) {
      return res.status(409).json({
        error: `A ${scheme.name} rate already starts on ${body.effectiveFrom}${jurisdiction ? ` for ${jurisdiction}` : ''}.`,
        code: 'RULE_EXISTS',
      });
    }
    const suffix = sameDay.reduce((n, r) => Math.max(n, Number(String(r.version).split('.')[1]) || 1), 0);
    const version = sameDay.length ? `${body.effectiveFrom}.${suffix + 1}` : body.effectiveFrom;

    const row = await payrollPrisma.$transaction(async (tx) => {
      /* CLOR's version from the same day: closed before it starts, kept for any payslip that used it. */
      for (const r of sameDay) {
        if (r.status === 'ACTIVE' || r.status === 'SUPERSEDED') {
          await tx.statutoryRule.update({ where: { id: r.id }, data: { effectiveTo: dayBefore(body.effectiveFrom), status: 'SUPERSEDED' } });
        }
      }
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
          version,
          employeeRate: body.employeeRate,
          employerRate: body.employerRate,
          wageCeiling: body.wageCeiling ?? null,
          eligibilityThreshold: body.eligibilityThreshold ?? null,
          rounding: body.rounding,
          configJson: JSON.stringify(body.config || {}),
          status: 'ACTIVE',
          note: body.note?.trim() || null,
          /* The company's own figures: the seed step never replaces them, and
             whoever wrote them has checked them. */
          origin: 'COMPANY',
          checkedAt: new Date(),
          checkedByUserId: req.auth!.userId,
          createdByUserId: req.auth!.userId,
        },
      });
    });

    res.status(201).json({ rule: shapeRule(row) });
  }
);

/**
 * Adopt CLOR's newer figures offered beside the company's own rule.
 *
 * The seed step never puts CLOR's figures in force over a company's own; it
 * leaves them as a DRAFT ("CLOR has newer figures"). Adopting one puts it in
 * force from its date and closes the company's rule the day before — the
 * same as publishing a new rate. The company's rule stays on record.
 */
payrollStatutoryRouter.post(
  '/orgs/:orgId/payroll/statutory/rules/:id/adopt',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const rule = await payrollPrisma.statutoryRule.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!rule) return res.status(404).json({ error: 'No such rate.' });
    if (rule.status !== 'DRAFT') return res.status(409).json({ error: 'Only figures CLOR is offering can be adopted.', code: 'NOT_AN_OFFER' });
    /* The same state however it is spelt: a company rule written "KA" is Karnataka's. */
    const state = canonicalState(rule.jurisdiction);
    const sameState = (await payrollPrisma.statutoryRule.findMany({ where: { orgId, schemeId: rule.schemeId, id: { not: rule.id } } })).filter(
      (r) => canonicalState(r.jurisdiction) === state
    );
    const later = sameState.find((r) => (r.status === 'ACTIVE' || r.status === 'SUPERSEDED') && r.effectiveFrom >= rule.effectiveFrom);
    if (later) {
      return res.status(409).json({ error: `Your own rate from ${later.effectiveFrom} is later than these figures, so they would never apply. Remove the offer, or publish a new rate.`, code: 'OFFER_OUTDATED' });
    }
    const row = await payrollPrisma.$transaction(async (tx) => {
      const previous = sameState
        .filter((r) => r.status === 'ACTIVE' && r.effectiveFrom < rule.effectiveFrom)
        .sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? 1 : -1))[0];
      if (previous) await tx.statutoryRule.update({ where: { id: previous.id }, data: { effectiveTo: dayBefore(rule.effectiveFrom), status: 'SUPERSEDED' } });
      return tx.statutoryRule.update({ where: { id: rule.id }, data: { status: 'ACTIVE' } });
    });
    res.json({ rule: shapeRule(row) });
  }
);

/**
 * Confirm a rule CLOR marked "check before use": somebody has read the state's
 * notice and the figures match. Recorded on this version only — a new version
 * is its own set of figures. The figures themselves do not change, so a rule
 * already on payslips can be confirmed.
 */
payrollStatutoryRouter.post(
  '/orgs/:orgId/payroll/statutory/rules/:id/confirm',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const rule = await payrollPrisma.statutoryRule.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!rule) return res.status(404).json({ error: 'No such rate.' });
    if (rule.checkedAt) return res.json({ rule: shapeRule(rule) });
    /*
     * Written without moving `updatedAt`: confirming changes no figure, so a
     * run calculated under this rule is not made stale by it (runStale reads
     * rule updates) and can be approved straight after.
     */
    await payrollPrisma.$executeRaw`UPDATE "StatutoryRule" SET "checkedAt" = NOW(), "checkedByUserId" = ${req.auth!.userId} WHERE "id" = ${rule.id} AND "orgId" = ${orgId}`;
    const row = await payrollPrisma.statutoryRule.findUniqueOrThrow({ where: { id: rule.id } });
    const who = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { fullName: true, email: true } }).catch(() => null);
    res.json({ rule: { ...shapeRule(row), checkedBy: who?.fullName || who?.email || '' } });
  }
);

const listOf = (json: string | null | undefined) => {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.map((d) => String(d)).filter(Boolean) : [];
  } catch {
    return [];
  }
};
const lwfSettingsShape = (setting: { lwfCoverage?: string | null; lwfManagerDesignations?: string | null; lwfSupervisorDesignations?: string | null } | null) => ({
  coverage: setting?.lwfCoverage === 'ALWAYS' ? 'ALWAYS' : 'BY_HEADCOUNT',
  managerDesignations: listOf(setting?.lwfManagerDesignations),
  supervisorDesignations: listOf(setting?.lwfSupervisorDesignations),
});

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Labour Welfare Fund: what CLOR cannot know from payroll alone.
 *
 * coverage            BY_HEADCOUNT (default) reads each state's size threshold
 *                     against the people in payroll there; ALWAYS treats every
 *                     establishment as covered (staff payroll does not pay).
 * managerDesignations    counted as managers: left out wherever a state's Act
 *                        leaves managers out, whatever they earn.
 * supervisorDesignations counted as supervisors: left out only above the
 *                        state's supervisory pay limit, where it sets one.
 * Both empty by default: nobody is left out, the safe side — the fund is
 * paid for everybody.
 */
payrollStatutoryRouter.put(
  '/orgs/:orgId/payroll/statutory/lwf-settings',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const parsed = z
      .object({
        coverage: z.enum(['BY_HEADCOUNT', 'ALWAYS']),
        managerDesignations: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
        supervisorDesignations: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say how LWF coverage is decided, and list designations one per line.' });
    const managers = [...new Set(parsed.data.managerDesignations.map((d) => d.trim()))];
    const managerKeys = new Set(managers.map((d) => d.toLowerCase()));
    /* A designation is one or the other; on both lists, it counts as a manager. */
    const supervisors = [...new Set(parsed.data.supervisorDesignations.map((d) => d.trim()))].filter((d) => !managerKeys.has(d.toLowerCase()));
    const data = { lwfCoverage: parsed.data.coverage, lwfManagerDesignations: JSON.stringify(managers), lwfSupervisorDesignations: JSON.stringify(supervisors), updatedByUserId: req.auth!.userId };
    const row = await payrollPrisma.payrollSetting.upsert({ where: { orgId }, update: data, create: { accountId, orgId, ...data } });
    res.json({ lwf: lwfSettingsShape(row) });
  }
);

/**
 * Remove a rate that has never been used — or decline CLOR's offered figures.
 *
 * One that has produced a payslip is a permanent record: the payslip names its
 * version, and deleting it would leave figures nobody could explain.
 *
 * A CLOR rate is not deleted but WITHDRAWN: the row stays, never in force and
 * not shown, so the seed step and later catalogues know the company removed
 * it and do not bring it back.
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

    const ours = rule.origin === 'SEED';
    const wasInForce = rule.status === 'ACTIVE' || rule.status === 'SUPERSEDED';
    await payrollPrisma.$transaction(async (tx) => {
      /*
       * The version this one closed reopens, taking over its window — only if
       * this one was ever in force: a declined offer (DRAFT) closed nothing.
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
          status: { notIn: NOT_IN_FORCE },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (ours) await tx.statutoryRule.update({ where: { id: rule.id }, data: { status: 'WITHDRAWN', effectiveTo: null } });
      else await tx.statutoryRule.delete({ where: { id: rule.id } });
      if (previous && wasInForce) {
        await tx.statutoryRule.update({
          where: { id: previous.id },
          data: { effectiveTo: rule.effectiveTo || null, status: rule.status },
        });
      }
    });
    res.json({ ok: true });
  }
);
