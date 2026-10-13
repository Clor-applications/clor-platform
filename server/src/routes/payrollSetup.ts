import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { accountingFor } from '../services/payroll/accounting/client.js';
import { isFeatureEnabled } from '../services/features.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, orgMatches } from '../services/payroll/guards.js';

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
