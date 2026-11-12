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
import { fnfCapPercent } from '../services/payroll/fnfRecoveryCap.js';
import { resolveAccess } from '../services/access.js';
import {
  DEDUCTOR_CODES,
  compactNumber,
  registrationProblem,
  registrationsShape,
  setPfContributeOnFullWage,
} from '../services/payroll/statutoryRegistrations.js';
import { seedStatutoryCatalogue } from '../services/payroll/statutory/resolve.js';
import { canonicalState, stateLabel } from '../constants/stateLevies.js';

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
  /** Payroll can run without it; the checklist still shows it until it is done. */
  optional?: boolean;
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
    const registrations = await registrationsShape(orgId);
    const applied = [
      registrations.pf.applies ? 'PF' : null,
      registrations.esi.applies ? 'ESI' : null,
      registrations.pt.applies ? 'professional tax' : null,
      registrations.tds.applies ? 'income tax' : null,
    ].filter(Boolean);

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
        key: 'registrations',
        title: 'Statutory registrations',
        blurb: 'The numbers each return is filed under: the PF establishment code, the ESI employer code, professional tax by state and the TAN.',
        done: registrations.done,
        detail: !registrations.answeredAt
          ? 'Not entered yet. Payroll can run without them, but no return can be filed until they are added.'
          : registrations.missing.length
            ? `Missing: ${registrations.missing.map((m) => m.short).join(', ')}`
            : applied.length
              ? `${applied.join(', ')} registered`
              : 'None apply to this company',
        screen: 'payrollSetup',
        optional: true,
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
    /* A payslip needs every step but the optional ones; those stay on the list until done. */
    const blocking = outstanding.filter((s) => !s.optional);

    res.json({
      setup: {
        /* Whether the company has started using payroll at all. */
        enabled,
        steps,
        done: steps.filter((s) => s.done).length,
        total: steps.length,
        /* Payroll can actually produce a payslip. */
        ready: blocking.length === 0,
        /* Where somebody resuming should be sent. */
        nextStep: outstanding[0] || null,
      },
    });
  }
);

// ---------------------------------------------------------------- statutory registrations

/**
 * The numbers each statutory return is filed under (roadmap 15): one reading
 * for the setup step, the Compliance screen and the pay run screen. The
 * numbers themselves live where they always did — on the scheme rows and the
 * payroll settings — so this is a second door to the same room, not a copy.
 */
payrollSetupRouter.get(
  '/orgs/:orgId/payroll/settings/statutory-registrations',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.settings),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    res.json(await registrationsShape(req.tenant!.orgId));
  }
);

const text = (max: number) => z.string().trim().max(max).optional().nullable();
const registrationsBody = z.object({
  pf: z.object({ applies: z.boolean(), code: text(40), contributeOnFullWage: z.boolean().optional() }).optional(),
  esi: z.object({ applies: z.boolean(), code: text(40) }).optional(),
  pt: z
    .object({
      applies: z.boolean(),
      registrations: z.array(z.object({ state: z.string().trim().min(1).max(60), registrationNumber: text(30) })).max(40).default([]),
    })
    .optional(),
  tds: z
    .object({
      applies: z.boolean(),
      tan: text(20),
      deductorType: z.enum(DEDUCTOR_CODES).optional().nullable(),
      responsibleName: text(120),
      responsibleDesignation: text(80),
    })
    .optional(),
});

payrollSetupRouter.put(
  '/orgs/:orgId/payroll/settings/statutory-registrations',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, PAYROLL_RESOURCE.settings),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const userId = req.auth!.userId;
    const parsed = registrationsBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Say which schemes apply and give their numbers.' });
    const body = parsed.data;
    if (!body.pf && !body.esi && !body.pt && !body.tds) return res.status(400).json({ error: 'Nothing to save.' });

    /* Each number in the shape its portal uses, or a plain sentence about what is wrong. */
    const numbers: Array<[string, unknown]> = [
      ['PF', body.pf?.code],
      ['ESI', body.esi?.code],
      ['TDS', body.tds?.tan],
      ...(body.pt?.registrations || []).map((r): [string, unknown] => ['PT', r.registrationNumber]),
    ];
    for (const [scheme, value] of numbers) {
      const problem = registrationProblem(scheme, value);
      if (problem) return res.status(400).json({ error: problem, scheme });
    }
    if (body.pt) {
      for (const r of body.pt.registrations) {
        if (!canonicalState(r.state)) return res.status(400).json({ error: 'Each professional tax registration needs its state.' });
      }
    }

    /* A scheme cannot be switched on without rates behind it, so a company that skipped Compliance gets the standard rates first. */
    if ((await payrollPrisma.statutoryScheme.count({ where: { orgId } })) === 0) {
      await seedStatutoryCatalogue(orgId, accountId, userId);
    }
    const schemes = await payrollPrisma.statutoryScheme.findMany({ where: { orgId }, select: { id: true, code: true, name: true } });
    const schemeOf = (code: string) => schemes.find((s) => s.code.toUpperCase() === code);

    const before = await registrationsShape(orgId);

    const setScheme = async (code: 'PF' | 'ESI' | 'PT' | 'TDS', applies: boolean, number?: string | null) => {
      const scheme = schemeOf(code);
      if (!scheme) return `${code} is not among this company's statutory schemes. Add the standard rates in Compliance first.`;
      if (applies) {
        const rules = await payrollPrisma.statutoryRule.count({ where: { orgId, schemeId: scheme.id, status: 'ACTIVE' } });
        if (!rules) return `${scheme.name} has no rates set, so switching it on would deduct nothing. Add a rate in Compliance first.`;
      }
      const data: { isEnabled: boolean; registrationNumber?: string | null } = { isEnabled: applies };
      if (number !== undefined) data.registrationNumber = compactNumber(number) || null;
      await payrollPrisma.statutoryScheme.update({ where: { id: scheme.id }, data });
      return null;
    };

    const refused =
      (body.pf ? await setScheme('PF', body.pf.applies, body.pf.code) : null) ||
      (body.esi ? await setScheme('ESI', body.esi.applies, body.esi.code) : null) ||
      (body.pt ? await setScheme('PT', body.pt.applies) : null) ||
      (body.tds ? await setScheme('TDS', body.tds.applies, body.tds.tan) : null);
    if (refused) return res.status(409).json({ error: refused, code: 'SCHEME_HAS_NO_RULES' });

    if (body.pf && body.pf.contributeOnFullWage !== undefined) {
      await setPfContributeOnFullWage(orgId, accountId, userId, body.pf.contributeOnFullWage);
    }

    const settingData: Record<string, unknown> = { statutoryRegistrationsAt: new Date(), updatedByUserId: userId };
    if (body.pt) {
      /* One row per state, the later entry winning, in the canonical spelling so the run finds it. */
      const rows = new Map<string, string>();
      for (const r of body.pt.registrations) rows.set(canonicalState(r.state), String(r.registrationNumber || '').trim().toUpperCase());
      settingData.ptRegistrationsJson = JSON.stringify([...rows.entries()].map(([state, registrationNumber]) => ({ state, registrationNumber })));
    }
    if (body.tds) {
      settingData.tdsDeductorType = body.tds.deductorType || null;
      settingData.tdsResponsibleName = body.tds.responsibleName?.trim() || null;
      settingData.tdsResponsibleDesignation = body.tds.responsibleDesignation?.trim() || null;
    }
    await payrollPrisma.payrollSetting.upsert({
      where: { orgId },
      update: settingData,
      create: { accountId, orgId, ...settingData } as any,
    });

    const after = await registrationsShape(orgId);
    const said = [
      body.pf ? (after.pf.applies ? `PF applies${after.pf.code ? ` (${after.pf.code})` : ', code to come'}${after.pf.contributeOnFullWage ? ', on the full wage' : ''}` : 'PF does not apply') : null,
      body.esi ? (after.esi.applies ? `ESI applies${after.esi.code ? ` (${after.esi.code})` : ', code to come'}` : 'ESI does not apply') : null,
      body.pt
        ? after.pt.applies
          ? `professional tax in ${after.pt.registrations.filter((r) => r.registrationNumber).map((r) => stateLabel(r.state)).join(', ') || 'no state yet'}`
          : 'professional tax does not apply'
        : null,
      body.tds ? (after.tds.applies ? `TDS applies${after.tds.tan ? ` (TAN ${after.tds.tan})` : ', TAN to come'}` : 'TDS does not apply') : null,
    ].filter(Boolean);
    if (req.res) req.res.locals.audited = true;
    await recordAudit(req, {
      entity: 'PAYROLL_SETTINGS',
      entityId: orgId,
      action: 'EDIT',
      message: `Statutory registrations saved: ${said.join('; ')}`,
      metadata: {
        before: { pf: before.pf, esi: before.esi, pt: before.pt.registrations, tds: before.tds },
        after: { pf: after.pf, esi: after.esi, pt: after.pt.registrations, tds: after.tds },
      },
    });
    res.json(after);
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
 * The share of wages deductions may take (Code on Wages 2019 s.18(3), excess
 * carried under s.18(4); Payment of Wages Act 1936 s.7(3) (repealed 21 Nov
 * 2025) before it), applied when a pay run is worked out: loan
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
  /* Not decided by the owner yet: counted unless a company turns it off. Older screens leave it as it was. */
  countsPenalties: z.boolean().optional(),
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
    const countsPenalties = parsed.data.countsPenalties ?? before.countsPenalties;
    await payrollPrisma.payrollSetting.upsert({
      where: { orgId },
      update: { deductionCapPercent: percent, deductionCapCountsStatutory: countsStatutory, deductionCapCountsPenalties: countsPenalties, updatedByUserId: req.auth!.userId },
      create: { accountId, orgId, deductionCapPercent: percent, deductionCapCountsStatutory: countsStatutory, deductionCapCountsPenalties: countsPenalties, updatedByUserId: req.auth!.userId },
    });
    if (req.res) req.res.locals.audited = true;
    await recordAudit(req, {
      entity: 'PAYROLL_SETTINGS',
      entityId: orgId,
      action: 'EDIT',
      message: `Deductions held to ${percent}% of wages${countsStatutory ? ', statutory deductions counted' : ', statutory deductions not counted'}${countsPenalties ? ', late-mark penalties counted' : ', late-mark penalties not counted'}`,
      metadata: { before, after: { percent, countsStatutory, countsPenalties } },
    });
    res.json(await capSetting(orgId));
  }
);

/**
 * How much of a leaver's final wages loans and advances may take in a full
 * and final settlement (fnfRecoveryCap.ts; owner, 31 Oct 2026). Half is the
 * law's limit (Code on Wages 2019 s.18(3)); a company may hold it lower. The
 * rest stays owed by the person. Changed by the owner or an admin only, and
 * audited with what it was and what it became. A settlement keeps the share
 * it was worked out with.
 */
const fnfView = requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.settings);
const fnfEdit = requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, PAYROLL_RESOURCE.settings);
const fnfShape = async (req: any) => ({
  percent: await fnfCapPercent(req.tenant!.orgId),
  /* Who may change it, so the screen offers the field only to them. */
  canEdit: (await resolveAccess(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId)).isAdmin,
});

payrollSetupRouter.get('/orgs/:orgId/payroll/settings/fnf-recovery', fnfView, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  res.json(await fnfShape(req));
});

const fnfBody = z.object({
  /* 0 to 50: stricter than the law, never looser. */
  percent: z.number().int('A whole percentage, such as 50.').min(0, 'Between 0% and 50%.').max(50, 'Between 0% and 50%: the law does not let deductions pass half of the wages.'),
});

payrollSetupRouter.put('/orgs/:orgId/payroll/settings/fnf-recovery', fnfEdit, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  if (!(await resolveAccess(accountId, orgId, req.auth!.userId)).isAdmin) {
    return res.status(403).json({ error: 'Only the owner or an admin changes how much a full and final recovers. Ask them.', code: 'OWNER_OR_ADMIN' });
  }
  const parsed = fnfBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Give the share of final wages, from 0 to 50.' });
  const before = await fnfCapPercent(orgId);
  const { percent } = parsed.data;
  await payrollPrisma.payrollSetting.upsert({
    where: { orgId },
    update: { fnfRecoveryCapPercent: percent, updatedByUserId: req.auth!.userId },
    create: { accountId, orgId, fnfRecoveryCapPercent: percent, updatedByUserId: req.auth!.userId },
  });
  if (req.res) req.res.locals.audited = true;
  if (before !== percent) {
    await recordAudit(req, {
      entity: 'COMPANY_SETTING',
      entityId: 'payroll.fnfRecovery',
      action: 'CHANGED',
      message: `Full and final settlements recover loans and advances up to ${percent}% of the final wages (was ${before}%)`,
      metadata: { before: { percent: before }, after: { percent } },
    });
  }
  res.json(await fnfShape(req));
});
