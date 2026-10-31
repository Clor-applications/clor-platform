import { payrollPrisma, type PayrollDb } from '../../utils/payrollPrisma.js';
import { Prisma } from '../../generated/payroll/index.js';
import { round2 } from '../../utils/money.js';
import type { SettlementLine } from './finalSettlement.js';

/**
 * The most a full and final settlement recovers of loans and advances
 * (decided by the owner, 31 Oct 2026; spec docs/people/workflow-engine 3.4).
 *
 * Code on Wages 2019 s.18(3): the deductions from a wage period's wages may
 * not pass half of them. The last wage period is still a wage period, so a
 * leaver's loans and advances come off the final pay only up to the
 * company's share (50 by default, never more) of the **final wages**, less
 * the other deductions of that period:
 *
 *  - **counted as final wages:** salary for days worked (the leaving month's
 *    payslip, once its payroll is approved; it pays them), notice pay the
 *    company owes, leave encashment, and any other earning HR adds;
 *  - **never counted:** gratuity (s.2(y) excludes it) and reimbursements
 *    (an expense claim, or one approved in Payroll: money given back, not
 *    wages);
 *  - **other deductions first:** a deduction HR enters (notice not served,
 *    say) and what the leaving month's payslip already took count toward the
 *    share before any recovery.
 *
 * Whatever the share does not allow **stays owed by the person**. There is no
 * "recover with consent" option (owner, Q2). It is not written off: a loan
 * keeps it as its balance, an expense advance keeps it open in People, and
 * HR collects it outside payroll. s.18(4) says the excess "may be recovered
 * in such manner as may be prescribed"; how that applies to somebody who has
 * left is for a labour lawyer to confirm.
 */

export const FNF_CAP_DEFAULT = 50;

export async function fnfCapPercent(orgId: string, db: PayrollDb = payrollPrisma): Promise<number> {
  const row = await (db as any).payrollSetting.findUnique({ where: { orgId }, select: { fnfRecoveryCapPercent: true } });
  return row?.fnfRecoveryCapPercent ?? FNF_CAP_DEFAULT;
}

/** What a recovery line carries about the limit: what is owed, what HR asked to recover, and what the limit held back. */
export type Recover = { due: number; wanted: number; capped: number };

/** What the leaving month's payslip adds: its wages, and what it already took toward their share. */
export type SlipBasis = { wages: number; deducted: number; ref: string | null; periodName: string | null };

/** Saved with the settlement (FinalSettlement.recoveryCap), so a later change of the setting does not move it. */
export type RecoveryCap = {
  percent: number;
  /** Final wages counted: the settlement's own wage lines plus the leaving month's payslip. */
  finalWages: number;
  settlementWages: number;
  /** The leaving month's payslip, or null when its payroll is not approved yet (then days worked are not counted). */
  slip: SlipBasis | null;
  /** The settlement's other deductions, and what the payslip already took. */
  otherDeductions: number;
  limit: number;
  /** What the limit left for loans and advances. */
  room: number;
  due: number;
  recovered: number;
  /** Held back by the limit: stays owed by the person. */
  heldBack: number;
  /** Everything the recovery lines leave owed: held back by the limit, or left by HR. */
  owed: number;
};

const RECOVERY_SOURCES = new Set(['LOAN', 'ADVANCE', 'CARRY']);

/** A loan, an expense advance, or a recovery waiting in Payroll, coming off the final pay. */
export const isRecovery = (l: SettlementLine) => l.kind === 'DEDUCTION' && Boolean(l.source && RECOVERY_SOURCES.has(l.source.type));

/** An earning that is wages: not gratuity, not a reimbursement (a claim, or one approved in Payroll). */
export const isFinalWage = (l: SettlementLine) =>
  l.kind === 'EARNING' && l.code !== 'GRATUITY' && !/^REIMBURSE_|^CLAIM_/.test(l.code) && !(l.source && (l.source.type === 'CLAIM' || l.source.type === 'CARRY'));

const sum = (xs: number[]) => round2(xs.reduce((t, x) => t + x, 0));

/**
 * The lines with each recovery held to the limit, oldest first (the order
 * they are listed in), and the figures the screen shows. Pure: what a line
 * is owed comes from its source (`recover.due`, never the request), and what
 * HR asked for (`recover.wanted`) is kept, so a wage line raised later lets
 * the recovery grow back to it.
 */
export function applyRecoveryCap(lines: SettlementLine[], o: { percent: number; slip: SlipBasis | null }): { lines: SettlementLine[]; cap: RecoveryCap } {
  const percent = Math.max(0, Math.min(50, Math.round(o.percent)));
  const settlementWages = sum(lines.filter(isFinalWage).map((l) => Math.max(0, Number(l.amount) || 0)));
  const ownOther = sum(lines.filter((l) => l.kind === 'DEDUCTION' && !isRecovery(l)).map((l) => Math.max(0, Number(l.amount) || 0)));
  const finalWages = round2(settlementWages + Math.max(0, o.slip?.wages || 0));
  const otherDeductions = round2(ownOther + Math.max(0, o.slip?.deducted || 0));
  const limit = round2((finalWages * percent) / 100);
  let room = Math.max(0, round2(limit - otherDeductions));
  const roomAtStart = room;
  let due = 0;
  let recovered = 0;
  let heldBack = 0;
  let owed = 0;
  const out = lines.map((l) => {
    if (!isRecovery(l)) {
      const { recover: _drop, ...rest } = l;
      return rest;
    }
    const r = l.recover;
    const lineDue = round2(Math.max(0, r?.due ?? l.source?.owed ?? (Number(l.amount) || 0)));
    const wanted = round2(Math.max(0, Math.min(lineDue, r?.wanted ?? lineDue)));
    const take = round2(Math.min(wanted, room));
    room = round2(room - take);
    due = round2(due + lineDue);
    recovered = round2(recovered + take);
    heldBack = round2(heldBack + wanted - take);
    owed = round2(owed + lineDue - take);
    return { ...l, amount: take, recover: { due: lineDue, wanted, capped: round2(wanted - take) } };
  });
  return {
    lines: out,
    cap: { percent, finalWages, settlementWages, slip: o.slip, otherDeductions, limit, room: roomAtStart, due, recovered, heldBack, owed },
  };
}

/**
 * The lines HR saved, with what each recovery is owed taken from the lines
 * the settlement had, never from the request. An amount HR changed is what
 * they want recovered (never more than is owed); one left as it was keeps
 * what they wanted before.
 */
export function withRecoverWishes(next: SettlementLine[], before: SettlementLine[]): SettlementLine[] {
  const key = (l: SettlementLine) => (l.source ? `${l.source.type}:${l.source.id}` : '');
  const prior = new Map(before.filter((l) => isRecovery(l)).map((l) => [key(l), l]));
  return next.map((l) => {
    const { recover: _client, ...line } = l;
    if (!isRecovery(line)) return line;
    const was = prior.get(key(line));
    const due = round2(was?.recover?.due ?? was?.source?.owed ?? (Number(was?.amount ?? line.amount) || 0));
    const asked = round2(Math.max(0, Number(line.amount) || 0));
    const changed = !was || Math.abs(asked - Number(was.amount)) > 0.005;
    const wanted = round2(Math.min(due, changed ? asked : was?.recover?.wanted ?? asked));
    return { ...line, recover: { due, wanted, capped: 0 } };
  });
}

/**
 * The leaving month's payslip, from a payroll that is approved or later: its
 * wages and what it already took toward their share (recorded on the
 * payslip when it was worked out, run.ts `capBasis`). Null while that
 * payroll is not approved, so days worked count only once they are paid.
 *
 * With `lock`, inside a transaction, the leaving month's payroll runs are
 * locked first (their rows, FOR UPDATE) and read after: a cancel or an
 * approval of one of them waits until that transaction ends, and one that
 * landed just before is what this reads. So a settlement approved or paid
 * on this basis cannot meet a payroll cancelled and redone in between
 * (review of #86).
 */
export async function leavingSlipBasis(orgId: string, employeeId: string, leaving: string, db: PayrollDb = payrollPrisma, o: { lock?: boolean } = {}): Promise<SlipBasis | null> {
  const d = db as any;
  const periods = await d.payrollPeriod.findMany({ where: { orgId, startDate: { lte: leaving }, endDate: { gte: leaving } }, select: { id: true, name: true } });
  if (!periods.length) return null;
  if (o.lock) {
    await d.$queryRaw`SELECT "id" FROM "PayrollRun" WHERE "orgId" = ${orgId} AND "periodId" IN (${Prisma.join(periods.map((p: { id: string }) => p.id))}) ORDER BY "id" FOR UPDATE`;
  }
  const runs = await d.payrollRun.findMany({ where: { orgId, periodId: { in: periods.map((p: { id: string }) => p.id) }, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } }, select: { id: true, periodId: true } });
  if (!runs.length) return null;
  const slips = await d.salarySlip.findMany({
    where: { orgId, employeeId, runId: { in: runs.map((r: { id: string }) => r.id) } },
    select: { number: true, periodId: true, grossEarnings: true, totalDeductions: true, inputSnapshotJson: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!slips.length) return null;
  let wages = 0;
  let deducted = 0;
  for (const s of slips) {
    let basis: { wages?: number; deducted?: number } | null = null;
    try { basis = JSON.parse(s.inputSnapshotJson || '{}').capBasis || null; } catch { /* an old payslip */ }
    /* A payslip from before 31 Oct 2026 has no basis: its gross and all its deductions, the careful reading. */
    wages = round2(wages + Number(basis?.wages ?? s.grossEarnings));
    deducted = round2(deducted + Number(basis?.deducted ?? s.totalDeductions));
  }
  const period = periods.find((p: { id: string; name: string }) => p.id === slips[0].periodId);
  return { wages, deducted, ref: slips.map((s: { number: string | null }) => s.number).filter(Boolean).join(', ') || null, periodName: period?.name || null };
}
