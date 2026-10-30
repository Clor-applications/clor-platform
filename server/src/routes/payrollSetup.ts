import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { accountingFor } from '../services/payroll/accounting/client.js';
import { isFeatureEnabled } from '../services/features.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, orgMatches, payrollRouteOk } from '../services/payroll/guards.js';
import { z } from 'zod';
import { platformPrisma } from '../utils/platformPrisma.js';
import { entitlementFor } from '../services/entitlements.js';
import { recordAudit } from '../services/auditTrail.js';
import { FEATURE as PROVISIONAL, ordinal, provisionalSetting } from '../services/payroll/provisionalDays.js';
import { capSetting } from '../services/payroll/deductionCap.js';

/**
 * Whether payroll is ready to run, and what is left to do.
 *
 * Payroll is its own application, and like any application it has to be set up
 * before it does anything. The question "can I run payroll yet" has one answer,
 * and this is where it lives — the setup screen reads it to know which step to
 * open on, and the overview reads it to say what is in the way. Two places
 * working it out separately would eventually disagree.
 *
 * ## Derived, never stored
 *
 * Every step's completeness is worked out from the records that would make it
 * true. Nothing sets a "statutory done" flag, because a flag can be set by a
 * wizard somebody clicked through and then say "done" about a company with no
 * rates. A step is complete when the thing it asks for exists, and stops being
 * complete if that thing is deleted — which is the honest behaviour, and the
 * one that survives somebody tidying up six months later.
 *
 * ## Deliberately not gated on the feature flag
 *
 * This route answers for an organisation that has never switched payroll on,
 * because that is exactly who needs it: the setup screen has to be able to ask
 * "where am I" before the app is in use. Every route that does real work still
 * refuses without the flag.
 */
export const payrollSetupRouter = Router();
payrollSetupRouter.use(requireAuth, requireTenantContext);

export type SetupStep = {
  key: string;
  title: string;
  /** What this step is for, in the words of somebody who has not done it. */
  blurb: string;
  done: boolean;
  /** What is missing, when it is not done. */
  detail: string;
  /** The screen that completes it. */
  screen: string;
};

payrollSetupRouter.get(
  '/orgs/:orgId/payroll/setup',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.settings),
  async (req, res) => {
    if (!orgMatches(req, res)) return;
    const { accountId, orgId } = req.tenant!;

    const enabled = await isFeatureEnabled(accountId, orgId, 'payroll');

    const [periods, components, structures, schemes, profiles, ledgerCount] = await Promise.all([
      payrollPrisma.payrollPeriod.findMany({ where: { orgId }, select: { id: true, isLocked: true } }),
      payrollPrisma.salaryComponent.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true, type: true, expenseLedgerId: true, liabilityLedgerId: true },
      }),
      payrollPrisma.salaryStructure.count({ where: { orgId, status: 'ACTIVE' } }),
      payrollPrisma.statutoryScheme.findMany({ where: { orgId }, select: { id: true, isEnabled: true } }),
      payrollPrisma.employeePayrollProfile.findMany({
        where: { orgId, payrollStatus: 'IN_PAYROLL' },
        select: { employeeId: true },
      }),
      accountingFor(accountId).getLedgers(orgId).then((l) => l.length),
    ]);

    const openPeriods = periods.filter((p) => !p.isLocked).length;
    const earnings = components.filter((c) => c.type === 'EARNING').length;

    /* Somebody in payroll is only really in it once they have a salary. */
    const ids = profiles.map((p) => p.employeeId);
    const [withSalary, known] = await Promise.all([
      ids.length
        ? payrollPrisma.salaryAssignment.findMany({
            where: { orgId, employeeId: { in: ids }, status: 'ACTIVE' },
            select: { employeeId: true },
            distinct: ['employeeId'],
          })
        : Promise.resolve([]),
      ids.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true } }) : Promise.resolve([]),
    ]);
    const liveIds = new Set(known.map((e) => e.id));
    const payable = withSalary.filter((a) => liveIds.has(a.employeeId)).length;

    /* Which components still have nowhere to post. An earning needs an expense
       account; a deduction needs somewhere the money is owed to; an employer
       contribution needs both. */
    const unmapped = components.filter((c) => {
      if (c.type === 'EARNING') return !c.expenseLedgerId;
      if (c.type === 'DEDUCTION') return !c.liabilityLedgerId;
      return !c.expenseLedgerId || !c.liabilityLedgerId;
    });

    const steps: SetupStep[] = [
      {
        key: 'calendar',
        title: 'Pay calendar',
        blurb: 'The months payroll runs for, and when people are paid.',
        done: openPeriods > 0,
        detail: openPeriods > 0 ? `${openPeriods} open` : 'No month is open, so payroll has nothing to run for.',
        screen: 'payrollPeriods',
      },
      {
        key: 'components',
        title: 'What a salary is made of',
        blurb: 'The earnings and deductions a salary is built from, and the structures that combine them.',
        done: earnings > 0 && structures > 0,
        detail:
          earnings === 0
            ? 'Nothing to pay yet — add at least one earning.'
            : structures === 0
              ? 'Components exist, but no active structure combines them.'
              : `${components.length} components, ${structures} ${structures === 1 ? 'structure' : 'structures'}`,
        screen: earnings === 0 ? 'payrollComponents' : 'salaryStructures',
      },
      {
        key: 'statutory',
        title: 'Statutory',
        blurb: 'Provident fund, ESI, professional tax and income tax — which apply, and at what rates.',
        done: schemes.length > 0,
        detail:
          schemes.length === 0
            ? 'No schemes set up. Add the standard Indian rates to start from.'
            : `${schemes.filter((s) => s.isEnabled).length} of ${schemes.length} apply to this company`,
        screen: 'payrollCompliancePage',
      },
      {
        key: 'accounting',
        title: 'Accounting',
        blurb: 'Which account each part of a salary posts to. Payroll cannot reach the books without it.',
        /* Nothing to map yet is not the same as mapped — this step waits for
           the components step rather than passing vacuously. */
        done: components.length > 0 && unmapped.length === 0 && ledgerCount > 0,
        detail:
          ledgerCount === 0
            ? 'This company has no chart of accounts to post into yet.'
            : components.length === 0
              ? 'Waiting for the salary components above.'
              : unmapped.length
                ? `${unmapped.length} with nowhere to post: ${unmapped.slice(0, 3).map((c) => c.name).join(', ')}${unmapped.length > 3 ? '…' : ''}`
                : 'Everything has somewhere to post',
        screen: 'payrollLedgerMapping',
      },
      {
        key: 'people',
        title: 'Who is paid',
        blurb: 'The people in payroll, and what each of them is on.',
        done: payable > 0,
        detail:
          profiles.length === 0
            ? 'Nobody is in payroll yet.'
            : payable === 0
              ? `${profiles.length} in payroll, none with a salary assigned.`
              : `${payable} ready to be paid`,
        screen: 'salaryAssignments',
      },
    ];

    const outstanding = steps.filter((s) => !s.done);

    res.json({
      setup: {
        /* Whether the company has started using payroll at all. */
        enabled,
        steps,
        done: steps.filter((s) => s.done).length,
        total: steps.length,
        /* Payroll can actually produce a payslip. */
        ready: outstanding.length === 0,
        /* Where somebody resuming should be sent. */
        nextStep: outstanding[0] || null,
      },
    });
  }
);

// ---------------------------------------------------------------- paying before the month ends

/**
 * Paying before the month ends (payrollProvisionalDays, closure audit O-11):
 * whether the days after a cut-off are counted as present, and the cut-off
 * day. A payroll setting, so whoever looks after payroll settings switches it
 * without the company-settings permission the Features screen needs. It needs
 * Attendance: without it there are no days to assume or correct.
 */
payrollSetupRouter.get(
  '/orgs/:orgId/payroll/settings/provisional-days',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.settings),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const [setting, attendance] = await Promise.all([provisionalSetting(accountId, orgId), isFeatureEnabled(accountId, orgId, 'attendance')]);
    res.json({ ...setting, attendance });
  }
);

const provisionalBody = z.object({
  enabled: z.boolean(),
  cutoffDay: z.number().int('The cut-off is a day of the month, such as 25.').min(1, 'The cut-off is a day of the month, from 1 to 30.').max(30, 'The cut-off is a day of the month, from 1 to 30.'),
});

payrollSetupRouter.put(
  '/orgs/:orgId/payroll/settings/provisional-days',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, PAYROLL_RESOURCE.settings),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const parsed = provisionalBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Say whether to count the days after the cut-off, and the cut-off day.' });
    const { enabled, cutoffDay } = parsed.data;
    if (enabled) {
      if (!(await isFeatureEnabled(accountId, orgId, 'attendance'))) {
        return res.status(409).json({ error: 'Switch Attendance on first: the days after the cut-off are counted, and corrected, from Attendance.', code: 'ATTENDANCE_DISABLED' });
      }
      if (!(await entitlementFor(accountId)).features.has(PROVISIONAL)) {
        return res.status(403).json({ error: 'Paying before the month ends is not in your Payroll plan.', code: 'NOT_ENTITLED', feature: PROVISIONAL });
      }
    }
    const before = await provisionalSetting(accountId, orgId);
    await payrollPrisma.payrollSetting.upsert({
      where: { orgId },
      update: { provisionalCutoffDay: cutoffDay, updatedByUserId: req.auth!.userId },
      create: { accountId, orgId, provisionalCutoffDay: cutoffDay, updatedByUserId: req.auth!.userId },
    });
    await platformPrisma.featureSetting.upsert({
      where: { orgId_key: { orgId, key: PROVISIONAL } },
      update: { enabled, updatedByUserId: req.auth!.userId },
      create: { accountId, orgId, key: PROVISIONAL, enabled, updatedByUserId: req.auth!.userId },
    });
    if (req.res) req.res.locals.audited = true;
    await recordAudit(req, {
      entity: 'PAYROLL_SETTINGS',
      entityId: orgId,
      action: 'EDIT',
      message: enabled ? `Days after the ${ordinal(cutoffDay)} of the month counted as present in payroll, corrected the next month` : 'Payroll counts only the days that have happened',
      metadata: { before, after: { enabled, cutoffDay } },
    });
    const after = await provisionalSetting(accountId, orgId);
    res.json({ ...after, attendance: await isFeatureEnabled(accountId, orgId, 'attendance') });
  }
);

/**
 * The share of wages deductions may take (Code on Wages 2019 s.18(2); Payment
 * of Wages Act s.7(3) before it), applied when a pay run is worked out: loan
 * and advance instalments past it carry to the next run (deductionCap.ts).
 * Whether statutory deductions count toward it is read differently, so it is
 * the company's to set.
 */
payrollSetupRouter.get(
  '/orgs/:orgId/payroll/settings/deduction-cap',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.settings),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    res.json(await capSetting(req.tenant!.orgId));
  }
);

const capBody = z.object({
  /* Never above half: a company may hold deductions lower than the law does, not higher. */
  percent: z.number().int('A whole percentage, such as 50.').min(10, 'Between 10% and 50%.').max(50, 'Between 10% and 50%: the law does not let deductions pass half of the wages.'),
  countsStatutory: z.boolean(),
});

payrollSetupRouter.put(
  '/orgs/:orgId/payroll/settings/deduction-cap',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, PAYROLL_RESOURCE.settings),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const parsed = capBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Give the share of wages, and whether statutory deductions count.' });
    const before = await capSetting(orgId);
    const { percent, countsStatutory } = parsed.data;
    await payrollPrisma.payrollSetting.upsert({
      where: { orgId },
      update: { deductionCapPercent: percent, deductionCapCountsStatutory: countsStatutory, updatedByUserId: req.auth!.userId },
      create: { accountId, orgId, deductionCapPercent: percent, deductionCapCountsStatutory: countsStatutory, updatedByUserId: req.auth!.userId },
    });
    if (req.res) req.res.locals.audited = true;
    await recordAudit(req, {
      entity: 'PAYROLL_SETTINGS',
      entityId: orgId,
      action: 'EDIT',
      message: `Deductions held to ${percent}% of wages${countsStatutory ? ', statutory deductions counted' : ', statutory deductions not counted'}`,
      metadata: { before, after: { percent, countsStatutory } },
    });
    res.json(await capSetting(orgId));
  }
);
