import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { advanceOpen } from '../people/money/expenses.js';
import type { SettlementLine } from './finalSettlement.js';

/**
 * What People hands a leaver's full and final (WORKFLOW-GAP-RESEARCH 4.1.7,
 * 4.2.7, 4.6.5), read from People's own records:
 *
 *  - an absconding case's **hold** on the settlement (services/people/
 *    absconding.ts, event `people.settlement.hold.v1`): paying is refused
 *    until it is lifted, with a reason, in People or here;
 *  - **expense advances** still open (paid out, not spent, given back or taken
 *    from salary): recovered;
 *  - **expense claims** approved and not yet paid: paid as a reimbursement;
 *  - **deductions carried** by a pay run that could not take them in full
 *    (deductionCap.ts) that no run has taken since: recovered.
 *
 * Loans, salary advances included, are Payroll's own and come with their
 * outstanding balance (finalSettlement.ts). Every line names its source, and
 * marking the settlement paid closes each source once (closeSources).
 */

export type Source = { type: 'LOAN' | 'ADVANCE' | 'CLAIM' | 'CARRY'; id: string; ref?: string | null };

const inr = (n: number) => `₹${round2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The hold on this person's settlement, if an absconding case holds it now. */
export async function settlementHold(orgId: string, employeeId: string) {
  const c = await peoplePrisma.absenceCase.findFirst({
    where: { orgId, employeeId, heldAt: { not: null }, holdReleasedAt: null },
    orderBy: { heldAt: 'desc' },
    select: { id: true, holdReason: true, heldAt: true },
  });
  return c ? { caseId: c.id, reason: c.holdReason || '', since: c.heldAt } : null;
}

/** Holds now, for a list: employeeId → hold. */
export async function settlementHolds(orgId: string, employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, { caseId: string; reason: string; since: Date | null }>();
  const rows = await peoplePrisma.absenceCase.findMany({
    where: { orgId, employeeId: { in: [...new Set(employeeIds)] }, heldAt: { not: null }, holdReleasedAt: null },
    orderBy: { heldAt: 'desc' },
    select: { id: true, employeeId: true, holdReason: true, heldAt: true },
  });
  const out = new Map<string, { caseId: string; reason: string; since: Date | null }>();
  for (const r of rows) if (!out.has(r.employeeId)) out.set(r.employeeId, { caseId: r.id, reason: r.holdReason || '', since: r.heldAt });
  return out;
}

/** The lines People's money adds to a leaver's settlement, each traceable to its record. */
export async function peopleMoneyLines(orgId: string, employeeId: string): Promise<SettlementLine[]> {
  const lines: SettlementLine[] = [];
  const [advances, claims, carried] = await Promise.all([
    peoplePrisma.employeeAdvance.findMany({ where: { orgId, employeeId, status: 'PAID' }, orderBy: { createdAt: 'asc' } }),
    peoplePrisma.expenseClaim.findMany({ where: { orgId, employeeId, status: 'APPROVED' }, orderBy: { createdAt: 'asc' } }),
    payrollPrisma.payrollAdjustment.findMany({ where: { orgId, employeeId, type: 'DEDUCTION', status: 'APPROVED', carriedByRunId: { not: null } }, orderBy: { createdAt: 'asc' } }),
  ]);

  for (const a of advances) {
    let owed = advanceOpen(a);
    let waiting = '';
    /* A recovery People sent Payroll that Payroll never approved is not recovered: it is owed here instead. */
    if (Number(a.recoveringAmount) > 0 && a.payrollAdjustmentId) {
      const adj = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId, id: a.payrollAdjustmentId }, select: { status: true } });
      if (!adj || adj.status === 'DRAFT' || adj.status === 'CANCELLED') {
        owed = round2(owed + Number(a.recoveringAmount));
        if (adj?.status === 'DRAFT') waiting = ` Includes ${inr(Number(a.recoveringAmount))} sent to Payroll as a draft deduction; settling this cancels that draft.`;
      }
    }
    if (owed <= 0) continue;
    lines.push({
      code: `ADVANCE_${a.number}`.replace(/[^A-Z0-9_-]+/gi, '_').slice(0, 40),
      label: `Advance ${a.number} not settled`,
      kind: 'DEDUCTION',
      amount: owed,
      explanation: `${a.purpose}: ${inr(Number(a.amount))} paid${a.paidOn ? ` on ${a.paidOn.split('-').reverse().join('/')}` : ''}, ${inr(owed)} not spent, given back or taken from salary.${waiting}`.slice(0, 500),
      source: { type: 'ADVANCE', id: a.id, ref: a.number },
    });
  }

  for (const c of claims) {
    const toPay = round2(Number(c.approvedTotal ?? 0) - Number(c.advanceSettled ?? 0));
    if (toPay <= 0) continue;
    lines.push({
      code: `CLAIM_${c.number}`.replace(/[^A-Z0-9_-]+/gi, '_').slice(0, 40),
      label: `Expense claim ${c.number}`,
      kind: 'EARNING',
      amount: toPay,
      explanation: `${c.title}: approved ${inr(Number(c.approvedTotal ?? 0))}${Number(c.advanceSettled ?? 0) > 0 ? `, ${inr(Number(c.advanceSettled))} set against an advance` : ''}, not paid yet. A reimbursement, not wages.`.slice(0, 500),
      source: { type: 'CLAIM', id: c.id, ref: c.number },
    });
  }

  for (const d of carried) {
    const amount = round2(Number(d.amount));
    if (amount <= 0) continue;
    lines.push({
      code: `CARRIED_${lines.length + 1}`,
      label: 'Deduction carried forward',
      kind: 'DEDUCTION',
      amount,
      explanation: `${d.reason || 'Carried from an earlier payroll'}. Held back by the 50% limit and not taken by a payroll since.`.slice(0, 500),
      source: { type: 'CARRY', id: d.id, ref: d.reference },
    });
  }
  return lines;
}

/**
 * The sources an edited set of lines may keep: only those the settlement
 * already carried. A line's source decides what paying it closes in People,
 * so it is never taken from the request.
 */
export function keepSources(next: SettlementLine[], before: SettlementLine[]) {
  const known = new Map(before.filter((l) => l.source).map((l) => [`${l.source!.type}:${l.source!.id}`, l.source!]));
  const byCode = new Map(before.filter((l) => l.source).map((l) => [l.code, l.source!]));
  return next.map((l) => {
    const claimed = (l as any).source as Source | undefined;
    const source = claimed && known.get(`${claimed.type}:${claimed.id}`) ? known.get(`${claimed.type}:${claimed.id}`) : byCode.get(l.code);
    const { source: _drop, ...rest } = l as any;
    return source ? { ...rest, source } : rest;
  });
}

/**
 * What changed under a settlement since it was worked out: a source already
 * closed, or now owing less than its line says. Paying on stale lines would
 * recover or pay twice, so marking paid is refused until it is worked out again.
 */
export async function staleSources(orgId: string, lines: SettlementLine[]) {
  const out: string[] = [];
  for (const l of lines) {
    if (!l.source || l.kind === 'INFO' || !(l.amount > 0)) continue;
    const { type, id } = l.source;
    if (type === 'LOAN') {
      const loan = await payrollPrisma.payrollLoan.findFirst({ where: { orgId, id }, select: { status: true, outstandingBalance: true, number: true } });
      if (!loan || loan.status !== 'ACTIVE' || Number(loan.outstandingBalance) + 0.005 < l.amount) out.push(`loan ${loan?.number || ''}`.trim());
    } else if (type === 'ADVANCE') {
      const a = await peoplePrisma.employeeAdvance.findFirst({ where: { orgId, id } });
      if (!a || a.status !== 'PAID') out.push(`advance ${a?.number || ''}`.trim());
    } else if (type === 'CLAIM') {
      const c = await peoplePrisma.expenseClaim.findFirst({ where: { orgId, id }, select: { status: true, number: true } });
      if (!c || c.status !== 'APPROVED') out.push(`claim ${c?.number || ''}`.trim());
    } else if (type === 'CARRY') {
      const d = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId, id }, select: { status: true } });
      if (!d || d.status !== 'APPROVED') out.push('a carried deduction');
    }
  }
  return out;
}

/**
 * Payroll's own sources, closed in the same transaction that marks the
 * settlement paid: a loan's pending instalments, in order, as far as the line
 * covers them (SETTLED; the loan completes when none is left), and a carried
 * deduction (cancelled, as the settlement took it).
 */
export async function closePayrollSources(tx: any, orgId: string, settlementId: string, lines: SettlementLine[]) {
  const done: string[] = [];
  for (const l of lines) {
    if (!l.source || l.kind !== 'DEDUCTION' || !(l.amount > 0)) continue;
    if (l.source.type === 'LOAN') {
      const pending = await tx.payrollLoanInstallment.findMany({ where: { orgId, loanId: l.source.id, status: 'PENDING' }, orderBy: { sequence: 'asc' } });
      let left = round2(l.amount);
      const settle: string[] = [];
      for (const i of pending) {
        const due = round2(Number(i.dueAmount));
        if (due > left + 0.005) break;
        settle.push(i.id);
        left = round2(left - due);
      }
      if (settle.length) await tx.payrollLoanInstallment.updateMany({ where: { orgId, id: { in: settle }, status: 'PENDING' }, data: { status: 'SETTLED', recoveredAt: new Date() } });
      /* A line edited to part of an instalment: that much comes off the next one, so the balance stays what is really owed. */
      const part = pending[settle.length];
      if (part && left > 0.005) {
        const due = round2(Number(part.dueAmount) - left);
        const principal = round2(Math.max(0, Number(part.principalAmount) - left));
        await tx.payrollLoanInstallment.updateMany({ where: { orgId, id: part.id, status: 'PENDING' }, data: { dueAmount: due, principalAmount: principal, interestAmount: round2(due - principal) } });
      }
      const rest = await tx.payrollLoanInstallment.findMany({ where: { orgId, loanId: l.source.id, status: 'PENDING' }, select: { dueAmount: true } });
      const outstanding = round2(rest.reduce((t: number, i: any) => t + Number(i.dueAmount), 0));
      await tx.payrollLoan.updateMany({
        where: { orgId, id: l.source.id },
        data: { outstandingBalance: outstanding, status: rest.length ? 'ACTIVE' : 'COMPLETED' },
      });
      done.push(`LOAN:${l.source.id}`);
    } else if (l.source.type === 'CARRY') {
      await tx.payrollAdjustment.updateMany({ where: { orgId, id: l.source.id, status: 'APPROVED' }, data: { status: 'CANCELLED', reason: `Recovered in full and final settlement ${settlementId}`.slice(0, 240) } });
      done.push(`CARRY:${l.source.id}`);
    }
  }
  return done;
}

const lock = (tx: any, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

/**
 * People's sources, closed after the settlement is marked paid, each once:
 *  - a claim approved and unpaid becomes paid, "with salary, full and final"
 *    (the claim's own words on the People screens);
 *  - an advance takes the line as recovered from salary, closing when nothing
 *    is left; a recovery People had sent as a Payroll draft is cancelled and
 *    folded in. The advance remembers the settlement (`settlement:<id>`), so a
 *    second call does nothing.
 * Safe to call again (the retry route): what is closed is skipped.
 */
export async function closePeopleSources(o: { orgId: string; userId: string; settlementId: string; lines: SettlementLine[]; today: string }) {
  const marker = `settlement:${o.settlementId}`;
  const closed: string[] = [];
  for (const l of o.lines) {
    if (!l.source || !(l.amount > 0)) continue;
    if (l.source.type === 'CLAIM' && l.kind === 'EARNING') {
      const n = await peoplePrisma.expenseClaim.updateMany({
        where: { orgId: o.orgId, id: l.source.id, status: 'APPROVED' },
        data: { status: 'PAID', payMode: 'SALARY', paidOn: o.today, paidByUserId: o.userId, payrollAdjustmentId: marker, payrollPeriodName: 'Full and final settlement' },
      });
      if (n.count) closed.push(`CLAIM:${l.source.id}`);
    } else if (l.source.type === 'ADVANCE' && l.kind === 'DEDUCTION') {
      const id = l.source.id;
      const did = await peoplePrisma.$transaction(async (tx) => {
        await lock(tx, `people-money-advance-row:${id}`);
        const a = await tx.employeeAdvance.findFirst({ where: { orgId: o.orgId, id } });
        if (!a || a.payrollAdjustmentId === marker || a.status !== 'PAID') return false;
        let recovering = Number(a.recoveringAmount);
        if (recovering > 0 && a.payrollAdjustmentId) {
          /* A draft recovery Payroll never approved is replaced by the settlement. */
          const n = await payrollPrisma.payrollAdjustment.updateMany({ where: { orgId: o.orgId, id: a.payrollAdjustmentId, status: 'DRAFT' }, data: { status: 'CANCELLED' } });
          const gone = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId: o.orgId, id: a.payrollAdjustmentId }, select: { status: true } });
          if (n.count || !gone || gone.status === 'CANCELLED') recovering = 0;
        }
        const recovered = round2(Number(a.recoveredAmount) + Math.min(l.amount, advanceOpen({ ...a, recoveringAmount: recovering })));
        const left = advanceOpen({ ...a, recoveredAmount: recovered, recoveringAmount: recovering });
        await tx.employeeAdvance.update({
          where: { id: a.id },
          data: { recoveredAmount: recovered, recoveringAmount: recovering, payrollAdjustmentId: marker, ...(left <= 0 && recovering <= 0 ? { status: 'CLOSED', closedAt: new Date() } : {}) },
        });
        return true;
      });
      if (did) closed.push(`ADVANCE:${id}`);
    }
  }
  return closed;
}
