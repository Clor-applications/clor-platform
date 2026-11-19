import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { ACT_DEFAULTS, RULE_NOTES, bonusComponent, bonusRules, bonusYear, type BonusRules } from '../services/payroll/bonus.js';
import { ownWorkRefusal } from '../services/makerChecker.js';
import { notifyUsers, usersWithPermission } from '../services/notifications.js';
import { recordAudit } from '../services/auditTrail.js';
import { round2 } from '../utils/money.js';

/**
 * Statutory bonus runs (round 66 pick): the Payment of Bonus Act's yearly
 * bonus, worked out from the year's approved payslips (services/payroll/bonus.ts).
 *
 *   Work it out: a draft run for the year at the rate HR picks, a line per
 *   person paid in the year, eligible first, with why anybody is not.
 *   Working it out again replaces the draft.
 *   Approve: by somebody other than whoever worked it out where the company
 *   has a second approver. Each eligible line becomes an approved earning
 *   (STAT_BONUS) on the pay run of the month chosen, the way any one-off
 *   payment reaches a payslip. The approver's own bonus waits in Adjustments
 *   for somebody else.
 *   Cancel: a draft any time; an approved run while none of its earnings has
 *   been paid on a payslip.
 *   Register: Form C's columns, with the date each bonus was paid.
 */
export const payrollBonusRouter = Router();
payrollBonusRouter.use(requireAuth, requireTenantContext);

const ADJ = PAYROLL_RESOURCE.adjustments;
const VIEW = requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, ADJ);
const SETTINGS_VIEW = requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.settings);
const SETTINGS_EDIT = requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, PAYROLL_RESOURCE.settings);
const FY = /^\d{4}-\d{2}$/;
const fyOk = (fy: string) => FY.test(fy) && Number(fy.slice(5, 7)) === (Number(fy.slice(0, 4)) + 1) % 100;
const fyWords = (fy: string) => `FY ${fy.slice(0, 4)}–${fy.slice(5, 7)}`;

const rulesOf = (json: string): BonusRules => {
  try {
    return { ...ACT_DEFAULTS, ...JSON.parse(json || '{}') };
  } catch {
    return { ...ACT_DEFAULTS };
  }
};

const shapeRun = (r: any) => ({
  id: r.id,
  financialYear: r.financialYear,
  status: r.status,
  ratePercent: Number(r.ratePercent),
  rules: rulesOf(r.rulesJson),
  totalAmount: Number(r.totalAmount),
  eligibleCount: r.eligibleCount,
  periodId: r.periodId || null,
  componentId: r.componentId || null,
  note: r.note || '',
  createdByUserId: r.createdByUserId,
  approvedAt: r.approvedAt || null,
  cancelledAt: r.cancelledAt || null,
  cancelReason: r.cancelReason || '',
  createdAt: r.createdAt,
});
const shapeLine = (l: any) => ({
  id: l.id,
  employeeId: l.employeeId,
  name: l.name,
  code: l.code,
  designation: l.designation,
  daysWorked: Number(l.daysWorked),
  wages: Number(l.wages),
  bonusWages: Number(l.bonusWages),
  amount: Number(l.amount),
  eligible: l.eligible,
  reason: l.reason || '',
  months: (() => {
    try {
      return JSON.parse(l.monthsJson || '[]');
    } catch {
      return [];
    }
  })(),
  adjustmentId: l.adjustmentId || null,
});

/* ---- The Act's figures, as company settings ---------------------------- */

payrollBonusRouter.get('/orgs/:orgId/payroll/bonus/settings', SETTINGS_VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  res.json({ rules: await bonusRules(req.tenant!.orgId), defaults: ACT_DEFAULTS, notes: RULE_NOTES });
});

const money = (what: string) => z.number({ error: `${what} must be a number.` }).finite().min(0, `${what} cannot be below zero.`).max(10000000, `${what} is too large.`);
const settingsBody = z
  .object({
    eligibilityCeiling: money('The eligibility ceiling').refine((n) => n > 0, 'The eligibility ceiling must be more than nothing.'),
    calculationCeiling: money('The calculation ceiling').refine((n) => n > 0, 'The calculation ceiling must be more than nothing.'),
    minimumWage: money('The minimum wage'),
    minPercent: z.number().finite().gt(0, 'The lowest share must be more than nothing.').max(100, 'A share is at most 100%.'),
    maxPercent: z.number().finite().gt(0, 'The highest share must be more than nothing.').max(100, 'A share is at most 100%.'),
    minimumAmount: money('The minimum bonus'),
    minDays: z.number().int('Days are whole days.').min(0, 'Days cannot be below zero.').max(366, 'A year has at most 366 days.'),
  })
  .refine((v) => v.minPercent <= v.maxPercent, { message: 'The lowest share cannot be more than the highest.' });

payrollBonusRouter.put('/orgs/:orgId/payroll/bonus/settings', SETTINGS_EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = settingsBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the bonus settings.' });
  const v = parsed.data;
  const before = await bonusRules(orgId);
  const data = {
    bonusEligibilityCeiling: v.eligibilityCeiling,
    bonusCalculationCeiling: v.calculationCeiling,
    bonusMinimumWage: v.minimumWage,
    bonusMinPercent: v.minPercent,
    bonusMaxPercent: v.maxPercent,
    bonusMinimumAmount: v.minimumAmount,
    bonusMinDays: v.minDays,
    updatedByUserId: req.auth!.userId,
  };
  await payrollPrisma.payrollSetting.upsert({ where: { orgId }, update: data, create: { accountId, orgId, ...data } });
  const changed = (Object.keys(v) as Array<keyof BonusRules>).filter((k) => Number(before[k]) !== Number(v[k]));
  await recordAudit(req, {
    entity: 'PAYROLL_SETTING',
    entityId: orgId,
    action: 'UPDATE',
    message: changed.length ? `Statutory bonus settings changed: ${changed.join(', ')}` : 'Statutory bonus settings saved unchanged',
    metadata: { before, after: v },
  });
  res.json({ rules: await bonusRules(orgId), defaults: ACT_DEFAULTS, notes: RULE_NOTES });
});

/* ---- Runs ---------------------------------------------------------------- */

/** The year's runs, newest first, and the open one (draft or approved) with its lines. */
payrollBonusRouter.get('/orgs/:orgId/payroll/bonus-runs', VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const fy = String(req.query.fy || '');
  if (!fyOk(fy)) return res.status(400).json({ error: 'Choose a financial year, like 2026-27.' });
  const runs = await payrollPrisma.payrollBonusRun.findMany({ where: { orgId, financialYear: fy }, orderBy: { createdAt: 'desc' } });
  const open = runs.find((r) => r.status !== 'CANCELLED') || null;
  const lines = open ? await payrollPrisma.payrollBonusLine.findMany({ where: { orgId, runId: open.id } }) : [];
  lines.sort((x, y) => Number(y.eligible) - Number(x.eligible) || x.name.localeCompare(y.name));
  res.json({
    financialYear: fy,
    rules: await bonusRules(orgId),
    run: open ? { ...shapeRun(open), lines: lines.map(shapeLine) } : null,
    history: runs.filter((r) => r !== open).map(shapeRun),
  });
});

const runBody = z.object({
  financialYear: z.string().trim(),
  ratePercent: z.number({ error: 'Give the bonus share as a number, like 8.33.' }).finite(),
  note: z.string().trim().max(240).optional().nullable(),
});

payrollBonusRouter.post('/orgs/:orgId/payroll/bonus-runs', requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, ADJ), async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = runBody.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the bonus run.' });
  const { financialYear: fy, note } = parsed.data;
  if (!fyOk(fy)) return res.status(400).json({ error: 'Choose a financial year, like 2026-27.' });
  const rules = await bonusRules(orgId);
  const rate = round2(parsed.data.ratePercent);
  if (rate < rules.minPercent || rate > rules.maxPercent) {
    return res.status(400).json({ error: `The bonus share must be between ${rules.minPercent}% and ${rules.maxPercent}%.`, code: 'RATE_OUT_OF_RANGE' });
  }

  const people = await bonusYear(orgId, fy, rules, rate);
  if (!people.length) return res.status(409).json({ error: `Nobody was paid on an approved payroll in ${fyWords(fy)}, so there is no bonus to work out yet.`, code: 'NO_PAYSLIPS' });
  const eligible = people.filter((p) => p.eligible);
  const total = round2(eligible.reduce((t, p) => t + p.amount, 0));
  const userId = req.auth!.userId;

  let run: any;
  try {
    run = await payrollPrisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-bonus:${orgId}:${fy}`}))`;
      const open = await tx.payrollBonusRun.findFirst({ where: { orgId, financialYear: fy, status: { not: 'CANCELLED' } } });
      if (open?.status === 'APPROVED') throw Object.assign(new Error(`The bonus for ${fyWords(fy)} is already approved. Cancel it first to work it out again.`), { status: 409, code: 'ALREADY_APPROVED' });
      const data = { ratePercent: rate, rulesJson: JSON.stringify(rules), totalAmount: total, eligibleCount: eligible.length, note: note || null, createdByUserId: userId };
      const row = open
        ? await tx.payrollBonusRun.update({ where: { id: open.id }, data })
        : await tx.payrollBonusRun.create({ data: { accountId, orgId, financialYear: fy, status: 'DRAFT', ...data } });
      if (open) await tx.payrollBonusLine.deleteMany({ where: { runId: row.id } });
      await tx.payrollBonusLine.createMany({
        data: people.map((p) => ({
          accountId,
          orgId,
          runId: row.id,
          employeeId: p.employeeId,
          name: p.name,
          code: p.code,
          designation: p.designation,
          daysWorked: p.daysWorked,
          wages: p.wages,
          bonusWages: p.bonusWages,
          amount: p.amount,
          eligible: p.eligible,
          reason: p.reason,
          monthsJson: JSON.stringify(p.months),
        })),
      });
      return { row, replaced: Boolean(open) };
    });
  } catch (e: any) {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }

  await recordAudit(req, {
    entity: 'PAYROLL_BONUS_RUN',
    entityId: run.row.id,
    action: run.replaced ? 'UPDATE' : 'CREATE',
    message: `Statutory bonus for ${fyWords(fy)} worked out${run.replaced ? ' again' : ''} at ${rate}%: ${eligible.length} of ${people.length} people, ₹${total.toLocaleString('en-IN')}`,
    metadata: { financialYear: fy, ratePercent: rate, eligible: eligible.length, total, rules },
  });
  const approvers = (await usersWithPermission(accountId, orgId, `${PAYROLL_MODULE}::${ADJ}::APPROVE`).catch(() => [] as string[])).filter((u) => u !== userId);
  if (approvers.length) {
    await notifyUsers(accountId, orgId, approvers, {
      kind: 'payroll.bonus',
      title: `Bonus to approve: ${fyWords(fy)}`,
      body: `${eligible.length} ${eligible.length === 1 ? 'person' : 'people'}, ₹${total.toLocaleString('en-IN')} at ${rate}%. Check the list and approve it in Payroll.`,
      link: { app: 'payroll', screen: 'bonus', params: { fy } } as any,
    }).catch(() => undefined);
  }

  const lines = await payrollPrisma.payrollBonusLine.findMany({ where: { orgId, runId: run.row.id } });
  lines.sort((x, y) => Number(y.eligible) - Number(x.eligible) || x.name.localeCompare(y.name));
  res.status(run.replaced ? 200 : 201).json({ run: { ...shapeRun(run.row), lines: lines.map(shapeLine) } });
});

payrollBonusRouter.post('/orgs/:orgId/payroll/bonus-runs/:id/approve', requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, ADJ), async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const userId = req.auth!.userId;
  const run = await payrollPrisma.payrollBonusRun.findFirst({ where: { orgId, id: String(req.params.id) } });
  if (!run) return res.status(404).json({ error: 'No such bonus run.' });
  if (run.status !== 'DRAFT') return res.status(409).json({ error: run.status === 'APPROVED' ? 'This bonus is already approved.' : 'This bonus run was cancelled.', code: 'NOT_DRAFT' });

  const periodId = String(req.body?.periodId || '').trim();
  if (!periodId) return res.status(400).json({ error: 'Choose the month whose pay run pays the bonus.' });
  const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: periodId }, select: { id: true, name: true, isLocked: true } });
  if (!period) return res.status(404).json({ error: 'No such payroll period.' });
  if (period.isLocked) return res.status(409).json({ error: `${period.name} is closed. Choose an open month.`, code: 'PERIOD_LOCKED' });

  const lines = (await payrollPrisma.payrollBonusLine.findMany({ where: { orgId, runId: run.id } })).filter((l) => l.eligible && Number(l.amount) > 0);
  if (!lines.length) return res.status(409).json({ error: 'Nobody on this run qualifies for a bonus, so there is nothing to pay.', code: 'NOBODY' });

  const refusal = await ownWorkRefusal(req, { makers: [run.createdByUserId], module: PAYROLL_MODULE, resource: ADJ, entity: 'PAYROLL_BONUS_RUN', entityId: run.id, what: 'bonus run' });
  if (refusal) return res.status(refusal.status).json(refusal.body);

  /* The approver's own bonus is never approved by them: it waits in Adjustments for somebody else. */
  const own = new Set(
    (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: lines.map((l) => l.employeeId) }, userId }, select: { id: true } })).map((e) => e.id)
  );
  const rate = Number(run.ratePercent);
  const reason = `Statutory bonus, ${fyWords(run.financialYear)} at ${rate}%`;

  let component: any;
  try {
    component = await payrollPrisma.$transaction(async (tx: any) => {
      const claimed = await tx.payrollBonusRun.updateMany({ where: { id: run.id, orgId, status: 'DRAFT' }, data: { status: 'APPROVED', periodId: period.id, approvedByUserId: userId, approvedAt: new Date() } });
      if (claimed.count !== 1) throw Object.assign(new Error('Somebody else changed this bonus run just now. Reload it.'), { status: 409, code: 'STALE' });
      const c = await bonusComponent(tx, accountId, orgId, userId);
      for (const l of lines) {
        const mine = own.has(l.employeeId);
        const adj = await tx.payrollAdjustment.create({
          data: {
            id: `bonus:${l.id}`,
            accountId,
            orgId,
            branchId: branchId || null,
            employeeId: l.employeeId,
            componentId: c.id,
            periodId: period.id,
            type: 'EARNING',
            amount: l.amount,
            reason,
            reference: `bonus:${run.id}`,
            status: mine ? 'DRAFT' : 'APPROVED',
            approvedByUserId: mine ? null : userId,
            approvedAt: mine ? null : new Date(),
            createdByUserId: run.createdByUserId,
          },
        });
        await tx.payrollBonusLine.update({ where: { id: l.id }, data: { adjustmentId: adj.id } });
      }
      await tx.payrollBonusRun.update({ where: { id: run.id }, data: { componentId: c.id } });
      return c;
    });
  } catch (e: any) {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }

  await recordAudit(req, {
    entity: 'PAYROLL_BONUS_RUN',
    entityId: run.id,
    action: 'APPROVE',
    message: `Statutory bonus for ${fyWords(run.financialYear)} approved: ${lines.length} earnings on the ${period.name} pay run, ₹${Number(run.totalAmount).toLocaleString('en-IN')}`,
    metadata: { periodId: period.id, componentId: component.id, earnings: lines.length, waitingForAnother: own.size },
  });
  const after = await payrollPrisma.payrollBonusRun.findFirst({ where: { id: run.id, orgId } });
  res.json({ run: shapeRun(after), earnings: lines.length, waiting: own.size, periodName: period.name });
});

payrollBonusRouter.post('/orgs/:orgId/payroll/bonus-runs/:id/cancel', requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, ADJ), async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const run = await payrollPrisma.payrollBonusRun.findFirst({ where: { orgId, id: String(req.params.id) } });
  if (!run) return res.status(404).json({ error: 'No such bonus run.' });
  if (run.status === 'CANCELLED') return res.status(409).json({ error: 'This bonus run is already cancelled.' });
  const reason = String(req.body?.reason || '').trim().slice(0, 240);
  if (run.status === 'APPROVED' && reason.length < 5) return res.status(400).json({ error: 'Say why an approved bonus is cancelled.', code: 'REASON_NEEDED' });

  try {
    await payrollPrisma.$transaction(async (tx: any) => {
      if (run.status === 'APPROVED') {
        const earnings = await tx.payrollAdjustment.findMany({ where: { orgId, reference: `bonus:${run.id}` }, select: { id: true, status: true } });
        const paid = earnings.filter((a: any) => a.status === 'CONSUMED').length;
        if (paid) throw Object.assign(new Error(`${paid} of these bonuses ${paid === 1 ? 'is' : 'are'} already on a payslip. Cancel or recalculate that pay run first.`), { status: 409, code: 'PAID' });
        await tx.payrollAdjustment.updateMany({ where: { orgId, reference: `bonus:${run.id}`, status: { in: ['DRAFT', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
      }
      const done = await tx.payrollBonusRun.updateMany({ where: { id: run.id, orgId, status: run.status }, data: { status: 'CANCELLED', cancelledByUserId: req.auth!.userId, cancelledAt: new Date(), cancelReason: reason || null } });
      if (done.count !== 1) throw Object.assign(new Error('Somebody else changed this bonus run just now. Reload it.'), { status: 409, code: 'STALE' });
    });
  } catch (e: any) {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  await recordAudit(req, {
    entity: 'PAYROLL_BONUS_RUN',
    entityId: run.id,
    action: 'CANCEL',
    message: `Statutory bonus for ${fyWords(run.financialYear)} cancelled${reason ? `: ${reason}` : ''}`,
    metadata: { was: run.status },
  });
  res.json({ ok: true });
});

/**
 * Form C (Payment of Bonus Rules 1975, r.4(c)): the bonus register. Columns
 * CLOR does not hold (father's name, customary or interim bonus, tax or
 * misconduct deductions) come back empty for the employer to fill in.
 */
payrollBonusRouter.get('/orgs/:orgId/payroll/bonus-runs/:id/register', VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const run = await payrollPrisma.payrollBonusRun.findFirst({ where: { orgId, id: String(req.params.id) } });
  if (!run) return res.status(404).json({ error: 'No such bonus run.' });
  const lines = (await payrollPrisma.payrollBonusLine.findMany({ where: { orgId, runId: run.id, eligible: true } })).sort((x, y) => x.name.localeCompare(y.name));
  const adjIds = lines.map((l) => l.adjustmentId).filter(Boolean) as string[];
  const adjustments = adjIds.length ? await payrollPrisma.payrollAdjustment.findMany({ where: { orgId, id: { in: adjIds } }, select: { id: true, status: true, consumedByRunId: true } }) : [];
  const runIds = [...new Set(adjustments.map((a) => a.consumedByRunId).filter(Boolean) as string[])];
  const payRuns = new Map(
    (runIds.length ? await payrollPrisma.payrollRun.findMany({ where: { orgId, id: { in: runIds } }, select: { id: true, status: true, payrollDate: true } }) : []).map((r) => [r.id, r])
  );
  const adjOf = new Map(adjustments.map((a) => [a.id, a]));
  const rows = lines.map((l, i) => {
    const a = l.adjustmentId ? adjOf.get(l.adjustmentId) : undefined;
    const pr = a?.status === 'CONSUMED' && a.consumedByRunId ? payRuns.get(a.consumedByRunId) : undefined;
    const paid = pr && ['PAID', 'POSTED'].includes(pr.status);
    return {
      serial: i + 1,
      name: l.name,
      code: l.code,
      fatherName: '',
      designation: l.designation,
      daysWorked: Number(l.daysWorked),
      wages: Number(l.wages),
      bonusPayable: Number(l.amount),
      customaryBonus: null,
      interimBonus: null,
      incomeTax: null,
      lossDeduction: null,
      totalDeductions: null,
      netPayable: Number(l.amount),
      amountPaid: paid ? Number(l.amount) : null,
      paidOn: paid ? pr!.payrollDate : '',
    };
  });
  res.json({ run: shapeRun(run), rows });
});
