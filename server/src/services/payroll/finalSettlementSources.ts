import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { advanceOpen } from '../people/money/expenses.js';
import { ensureRecoveryBase, foldRecovery, liveLink, recoveryChain } from './recoveryChain.js';
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
 *  - **expense claims** approved and not yet paid, or waiting in Payroll as a
 *    draft: paid as a reimbursement (the draft is cancelled when it is paid);
 *  - **what Payroll approved and no payslip has taken yet**: a recovery People
 *    sent (`advance-recover:`), a deduction a pay run carried because the
 *    share of wages could not take it (deductionCap.ts), a reimbursement
 *    (`expense-claim:`). Each is its own line, taken by the settlement, and a
 *    line edited down leaves the rest carried.
 *
 * Loans, salary advances included, are Payroll's own and come with their
 * outstanding balance (finalSettlement.ts). Every line names its source, and
 * marking the settlement paid closes each source once (closeSources).
 */

export type Source = NonNullable<SettlementLine['source']>;

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

/** What an advance owes now, as a full and final line would say: what is open, plus a recovery still a draft in Payroll (which settling cancels). */
export async function advanceOwed(orgId: string, a: any): Promise<{ owed: number; draft: { id: string; amount: number } | null }> {
  const link = liveLink(a.payrollAdjustmentId);
  if (!link) return { owed: advanceOpen(a), draft: null };
  const chain = await recoveryChain(orgId, link);
  /* An older chain counts only while something is being taken; one with its starting figure always reads true. */
  if (!(Number(a.recoveringAmount) > 0) && chain?.base == null) return { owed: advanceOpen(a), draft: null };
  if (chain?.root.status === 'DRAFT') {
    /* Waiting for approval in Payroll (just sent, or edited): folded into the advance's line, at the amount waiting now, and cancelled with the payment. */
    const w = foldRecovery(a, chain);
    return { owed: round2(advanceOpen({ ...a, recoveredAmount: w.recovered, recoveringAmount: w.recovering }) + w.recovering), draft: { id: link, amount: round2(w.recovering) } };
  }
  /* What Payroll took is recovered; what it still holds open is its own line (below). */
  const f = foldRecovery(a, chain);
  return { owed: advanceOpen({ ...a, recoveredAmount: f.recovered, recoveringAmount: f.recovering }), draft: null };
}

/** What a claim still owes the person, and the draft adjustment it waits on in Payroll (if any). Null when Payroll pays it on a payslip. */
async function claimOwed(orgId: string, c: any): Promise<{ owed: number; draftId: string | null } | null> {
  const owed = round2(Number(c.approvedTotal ?? 0) - Number(c.advanceSettled ?? 0));
  if (c.status === 'APPROVED') return { owed, draftId: null };
  if (c.status !== 'WITH_SALARY') return null;
  if (!c.payrollAdjustmentId) return { owed, draftId: null };
  const adj = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId, id: c.payrollAdjustmentId }, select: { status: true } });
  if (!adj || adj.status === 'CANCELLED') return { owed, draftId: null };
  if (adj.status === 'DRAFT') return { owed, draftId: c.payrollAdjustmentId };
  /* Approved there (its own line, below) or already on a payslip. */
  return null;
}

/** Rows Payroll approved that no payslip has taken: recoveries, carried deductions, reimbursements. */
const waitingInPayroll = (orgId: string, employeeId: string) =>
  payrollPrisma.payrollAdjustment.findMany({
    where: {
      orgId,
      employeeId,
      OR: [
        { status: 'APPROVED', type: 'DEDUCTION', carriedByRunId: { not: null } },
        { status: 'APPROVED', type: 'DEDUCTION', id: { startsWith: 'advance-recover:' } },
        { status: 'APPROVED', type: 'EARNING', id: { startsWith: 'expense-claim:' } },
        /*
         * A carried row corrected and back for approval: still owed, and no
         * payroll will run for a leaver to take it, so the settlement takes it
         * (re-review of #82; left out, it was orphaned when the F&F was paid).
         */
        { status: 'DRAFT', type: 'DEDUCTION', carriedByRunId: { not: null } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

/** The People advance a recovery row belongs to: `advance-recover:<advance>:<period>` on the row or the chain's reference. */
const advanceIdOf = (row: { id: string; reference?: string | null }) => {
  const key = [row.id, row.reference || ''].find((k) => k.startsWith('advance-recover:'));
  return key ? key.split(':')[1] || null : null;
};

/** The lines People's money adds to a leaver's settlement, each traceable to its record. */
export async function peopleMoneyLines(orgId: string, employeeId: string): Promise<SettlementLine[]> {
  const lines: SettlementLine[] = [];
  const [advances, claims, waiting] = await Promise.all([
    peoplePrisma.employeeAdvance.findMany({ where: { orgId, employeeId, status: 'PAID' }, orderBy: { createdAt: 'asc' } }),
    peoplePrisma.expenseClaim.findMany({ where: { orgId, employeeId, status: { in: ['APPROVED', 'WITH_SALARY'] } }, orderBy: { createdAt: 'asc' } }),
    waitingInPayroll(orgId, employeeId),
  ]);
  const advanceNumber = new Map(advances.map((a) => [a.id, a.number]));

  for (const a of advances) {
    const { owed, draft } = await advanceOwed(orgId, a);
    if (owed <= 0) continue;
    const waitingWords = draft ? ` Includes ${inr(draft.amount)} sent to Payroll as a draft deduction; paying this cancels that draft.` : '';
    lines.push({
      code: `ADVANCE_${a.number}`.replace(/[^A-Z0-9_-]+/gi, '_').slice(0, 40),
      label: `Advance ${a.number} not settled`,
      kind: 'DEDUCTION',
      amount: owed,
      explanation: `${a.purpose}: ${inr(Number(a.amount))} paid${a.paidOn ? ` on ${a.paidOn.split('-').reverse().join('/')}` : ''}, ${inr(owed)} not spent, given back or taken from salary.${waitingWords}`.slice(0, 500),
      source: { type: 'ADVANCE', id: a.id, ref: a.number, owed, ...(draft ? { draftId: draft.id } : {}) },
    });
  }

  for (const c of claims) {
    const due = await claimOwed(orgId, c);
    if (!due || due.owed <= 0) continue;
    lines.push({
      code: `CLAIM_${c.number}`.replace(/[^A-Z0-9_-]+/gi, '_').slice(0, 40),
      label: `Expense claim ${c.number}`,
      kind: 'EARNING',
      amount: due.owed,
      explanation: `${c.title}: approved ${inr(Number(c.approvedTotal ?? 0))}${Number(c.advanceSettled ?? 0) > 0 ? `, ${inr(Number(c.advanceSettled))} set against an advance` : ''}, not paid yet.${due.draftId ? ' Waiting in Payroll as a draft; paying this cancels that draft.' : ''} A reimbursement, not wages.`.slice(0, 500),
      source: { type: 'CLAIM', id: c.id, ref: c.number, owed: due.owed, ...(due.draftId ? { draftId: due.draftId } : {}) },
    });
  }

  for (const d of waiting) {
    const amount = round2(Number(d.amount));
    if (amount <= 0) continue;
    const advanceId = d.type === 'DEDUCTION' ? advanceIdOf(d) : null;
    const number = advanceId ? advanceNumber.get(advanceId) || (await peoplePrisma.employeeAdvance.findFirst({ where: { orgId, id: advanceId }, select: { number: true } }))?.number : null;
    const n = lines.length + 1;
    if (d.type === 'EARNING') {
      lines.push({
        code: `REIMBURSE_${n}`,
        label: 'Reimbursement approved in Payroll',
        kind: 'EARNING',
        amount,
        explanation: `${d.reason || 'An expense claim paid with salary'}. Approved in Payroll and not on a payslip yet.`.slice(0, 500),
        source: { type: 'CARRY', id: d.id, ref: d.reference, owed: amount },
      });
    } else {
      lines.push({
        code: d.carriedByRunId ? `CARRIED_${n}` : `RECOVERY_${n}`,
        label: number ? `Advance ${number}: recovery waiting in Payroll` : 'Deduction carried forward',
        kind: 'DEDUCTION',
        amount,
        explanation: (d.carriedByRunId
          ? `${d.reason || 'Carried from an earlier payroll'}. Held back by the share of wages and not taken by a payroll since.${d.status === 'DRAFT' ? ' Back for approval in Payroll; paying this settlement takes it.' : ''}`
          : `${inr(amount)} approved in Payroll to come off salary and not taken by a payroll yet.`).slice(0, 500),
        source: { type: 'CARRY', id: d.id, ref: number || d.reference, owed: amount, ...(advanceId ? { advanceId } : {}) },
      });
    }
  }
  return lines;
}

/**
 * The sources an edited set of lines may keep: only those the settlement
 * already carried, each on one line only. A line's source decides what paying
 * it closes, so it is never taken from the request.
 */
export function keepSources(next: SettlementLine[], before: SettlementLine[]) {
  const known = new Map(before.filter((l) => l.source).map((l) => [`${l.source!.type}:${l.source!.id}`, l.source!]));
  const byCode = new Map(before.filter((l) => l.source).map((l) => [l.code, l.source!]));
  const used = new Set<string>();
  return next.map((l) => {
    const claimed = (l as any).source as Source | undefined;
    const candidate = claimed && known.get(`${claimed.type}:${claimed.id}`) ? known.get(`${claimed.type}:${claimed.id}`) : byCode.get(l.code);
    const key = candidate ? `${candidate.type}:${candidate.id}` : '';
    const source = candidate && !used.has(key) ? candidate : undefined;
    if (source) used.add(key);
    const { source: _drop, ...rest } = l as any;
    return source ? { ...rest, source } : rest;
  });
}

/**
 * What changed under a settlement since it was worked out: a source closed,
 * owing less than its line says, owing more than when it was worked out, or a
 * draft it folds in no longer a draft. Paying on stale lines would recover or
 * pay twice, or leave something owed nobody is told about, so marking paid is
 * refused until it is worked out again.
 */
export async function staleSources(orgId: string, lines: SettlementLine[]) {
  const out: string[] = [];
  const grew = (src: Source, now: number) => src.owed != null && now > src.owed + 0.005;
  for (const l of lines) {
    if (!l.source || l.kind === 'INFO' || !(l.amount > 0)) continue;
    const src = l.source;
    const { type, id } = src;
    if (type === 'LOAN') {
      const loan = await payrollPrisma.payrollLoan.findFirst({ where: { orgId, id }, select: { status: true, outstandingBalance: true, number: true } });
      const now = Number(loan?.outstandingBalance ?? 0);
      if (!loan || loan.status !== 'ACTIVE' || now + 0.005 < l.amount || grew(src, now)) out.push(`loan ${loan?.number || ''}`.trim());
    } else if (type === 'ADVANCE') {
      const a = await peoplePrisma.employeeAdvance.findFirst({ where: { orgId, id } });
      const now = a && a.status === 'PAID' ? await advanceOwed(orgId, a) : null;
      if (!a || !now || now.owed + 0.005 < l.amount || grew(src, now.owed) || (src.draftId || null) !== (now.draft?.id || null)) out.push(`advance ${a?.number || ''}`.trim());
    } else if (type === 'CLAIM') {
      const c = await peoplePrisma.expenseClaim.findFirst({ where: { orgId, id } });
      const now = c ? await claimOwed(orgId, c) : null;
      if (!c || !now || now.owed + 0.005 < l.amount || grew(src, now.owed) || (src.draftId || null) !== now.draftId) out.push(`claim ${c?.number || ''}`.trim());
    } else if (type === 'CARRY') {
      const d = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId, id }, select: { status: true, amount: true } });
      /* Approved, or a carried row back for approval (taken all the same): anything else has moved. */
      if (!d || !['APPROVED', 'DRAFT'].includes(d.status) || Number(d.amount) + 0.005 < l.amount || grew(src, Number(d.amount))) out.push(src.advanceId ? `the recovery of advance ${src.ref || ''}`.trim() : 'a deduction waiting in Payroll');
    }
  }
  return out;
}

/**
 * Before paying: each advance line names the recovery live in Payroll it
 * joins (`source.chainRoot`), whose starting figure is recorded first if it
 * is an older one. Read from People, outside the payment's transaction.
 */
export async function withChainRoots(orgId: string, lines: SettlementLine[]): Promise<SettlementLine[]> {
  const out: SettlementLine[] = [];
  for (const l of lines) {
    /* A line that folds in a draft recovery replaces it (the draft is cancelled with the payment): it joins nothing. */
    if (l.source?.type === 'ADVANCE' && l.kind === 'DEDUCTION' && !l.source.draftId) {
      const a = await peoplePrisma.employeeAdvance.findFirst({ where: { orgId, id: l.source.id }, select: { payrollAdjustmentId: true } });
      const link = liveLink(a?.payrollAdjustmentId);
      if (link) {
        await ensureRecoveryBase(orgId, link);
        const root = await payrollPrisma.payrollAdjustment.findFirst({ where: { orgId, id: link }, select: { recoveryBase: true, status: true } });
        if (root?.recoveryBase != null && root.status !== 'DRAFT') { out.push({ ...l, source: { ...l.source, chainRoot: link } } as SettlementLine); continue; }
      }
    }
    /*
     * A recovery waiting in Payroll that the share of final wages holds back
     * in part: the part held back leaves the chain and is open again on the
     * advance (closePayrollSources), which needs the chain's starting figure.
     */
    if (l.source?.type === 'CARRY' && l.source.advanceId && (l.recover?.capped || 0) > 0.005) await ensureRecoveryBase(orgId, l.source.id);
    out.push(l);
  }
  return out;
}

export class SourcesChangedError extends Error {
  status = 409;
  code = 'SOURCES_CHANGED';
}

/**
 * Payroll's own sources, closed in the same transaction that marks the
 * settlement paid, so paying and closing happen once, together:
 *  - a loan's pending instalments, in order, as far as the line covers them
 *    (SETTLED; the loan completes when none is left);
 *  - a row waiting in Payroll is taken by the settlement (CONSUMED, by
 *    `settlement:<id>`, which no pay run takes again); a line edited down
 *    takes that much and the rest stays carried, as a pay run's would;
 *  - a draft the line folds in is cancelled.
 * Anything that moved since the stale check refuses the whole payment.
 */
export async function closePayrollSources(tx: any, orgId: string, settlementId: string, lines: SettlementLine[]) {
  const done: string[] = [];
  const by = `settlement:${settlementId}`;
  for (const l of lines) {
    if (!l.source || l.kind === 'INFO' || !(l.amount > 0)) continue;
    if (l.source.draftId) {
      const n = await tx.payrollAdjustment.updateMany({ where: { orgId, id: l.source.draftId, status: 'DRAFT' }, data: { status: 'CANCELLED', reason: `Replaced by full and final settlement ${settlementId}`.slice(0, 240) } });
      if (!n.count) throw new SourcesChangedError('A draft in Payroll this settlement replaces has changed since. Cancel the settlement and work it out again.');
      done.push(`DRAFT:${l.source.draftId}`);
    }
    /*
     * An advance whose recovery is live in Payroll with its starting figure:
     * the settlement's line is recovered from final pay, so it joins that
     * figure here, in the transaction that marks the settlement paid, once.
     * People then reads the chain (closePeopleSources) and adds nothing twice.
     */
    if (l.source.type === 'ADVANCE' && l.kind === 'DEDUCTION' && l.source.chainRoot) {
      await tx.payrollAdjustment.updateMany({ where: { orgId, id: l.source.chainRoot, recoveryBase: { not: null } }, data: { recoveryBase: { increment: round2(l.amount) } } });
      done.push(`ADVANCE_BASE:${l.source.chainRoot}`);
    }
    if (l.source.type === 'LOAN' && l.kind === 'DEDUCTION') {
      const pending = await tx.payrollLoanInstallment.findMany({ where: { orgId, loanId: l.source.id, status: 'PENDING' }, orderBy: { sequence: 'asc' } });
      let left = round2(l.amount);
      const settle: string[] = [];
      for (const i of pending) {
        const due = round2(Number(i.dueAmount));
        if (due > left + 0.005) break;
        settle.push(i.id);
        left = round2(left - due);
      }
      /* Each still pending as it is settled: one a payslip took a moment ago refuses the whole payment, rather than recovering it twice. */
      if (settle.length) {
        const n = await tx.payrollLoanInstallment.updateMany({ where: { orgId, id: { in: settle }, status: 'PENDING' }, data: { status: 'SETTLED', recoveredAt: new Date() } });
        if (n.count !== settle.length) throw new SourcesChangedError('A loan this settlement recovers was taken by a payroll meanwhile. Cancel the settlement and work it out again.');
      }
      /* A line edited to part of an instalment: that much comes off the next one, so the balance stays what is really owed. */
      const part = pending[settle.length];
      /* More on the line than the loan still has pending: a payslip took some since the check. */
      if (!part && left > 0.005) throw new SourcesChangedError('A loan this settlement recovers was taken by a payroll meanwhile. Cancel the settlement and work it out again.');
      if (part && left > 0.005) {
        const due = round2(Number(part.dueAmount) - left);
        const principal = round2(Math.max(0, Number(part.principalAmount) - left));
        const n = await tx.payrollLoanInstallment.updateMany({ where: { orgId, id: part.id, status: 'PENDING' }, data: { dueAmount: due, principalAmount: principal, interestAmount: round2(due - principal) } });
        if (!n.count) throw new SourcesChangedError('A loan this settlement recovers was taken by a payroll meanwhile. Cancel the settlement and work it out again.');
      }
      const rest = await tx.payrollLoanInstallment.findMany({ where: { orgId, loanId: l.source.id, status: 'PENDING' }, select: { dueAmount: true } });
      const outstanding = round2(rest.reduce((t: number, i: any) => t + Number(i.dueAmount), 0));
      await tx.payrollLoan.updateMany({
        where: { orgId, id: l.source.id },
        data: { outstandingBalance: outstanding, status: rest.length ? 'ACTIVE' : 'COMPLETED' },
      });
      done.push(`LOAN:${l.source.id}`);
    } else if (l.source.type === 'CARRY') {
      const row = await tx.payrollAdjustment.findFirst({ where: { orgId, id: l.source.id } });
      const take = round2(l.amount);
      const rest = row ? round2(Number(row.amount) - take) : 0;
      /*
       * The part the share of final wages held back (fnfRecoveryCap.ts) stays
       * owed by the person, outside payroll: for an advance's recovery it
       * leaves the chain and is open on the advance in People again; any
       * other deduction stays waiting in Payroll, as a part HR left does.
       */
      const heldBack = l.source.advanceId ? round2(Math.min(Math.max(0, rest), l.recover?.capped || 0)) : 0;
      const carried = round2(rest - heldBack);
      const n = row && rest > -0.005
        ? await tx.payrollAdjustment.updateMany({ where: { orgId, id: row.id, status: { in: ['APPROVED', 'DRAFT'] }, amount: row.amount }, data: { status: 'CONSUMED', consumedByRunId: by, amount: take } })
        : { count: 0 };
      if (!n.count) throw new SourcesChangedError('Something waiting in Payroll this settlement takes has changed since. Cancel the settlement and work it out again.');
      if (heldBack > 0.005) done.push(`OWED:${l.source.id}:${heldBack}`);
      if (carried > 0.005) {
        await tx.payrollAdjustment.create({
          data: {
            accountId: row.accountId,
            orgId,
            branchId: row.branchId,
            employeeId: row.employeeId,
            componentId: row.componentId,
            periodId: row.periodId,
            type: row.type,
            amount: carried,
            reason: `Left after full and final settlement: ${String(row.reason || '').replace(/^Left after full and final settlement: /, '')}`.slice(0, 240),
            reference: row.reference || row.id,
            status: 'APPROVED',
            approvedAt: row.approvedAt || new Date(),
            approvedByUserId: row.approvedByUserId,
            carriedFromId: row.id,
            carriedByRunId: by,
            createdByUserId: row.createdByUserId,
          },
        });
      }
      done.push(`CARRY:${l.source.id}`);
    }
  }
  return done;
}

const lock = (tx: any, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

/**
 * People's sources, closed after the settlement is marked paid, each once:
 *  - a claim approved and unpaid (or waiting as a Payroll draft, cancelled
 *    with the payment) becomes paid, "with salary, full and final";
 *  - an advance counts what Payroll took through its recovery (a payslip, or
 *    this settlement's own recovery line), then the settlement's line as
 *    recovered from salary, closing when nothing is left. It remembers the
 *    settlement (`settlement:<id>`, keeping a recovery still live in Payroll
 *    after a `|`), so a second call adds nothing.
 * Safe to call again (the retry route): what is closed is skipped.
 */
export async function closePeopleSources(o: { orgId: string; userId: string; settlementId: string; lines: SettlementLine[]; today: string }) {
  const marker = `settlement:${o.settlementId}`;
  const isMine = (link: string | null) => link === marker || Boolean(link?.startsWith(`${marker}|`));
  const closed: string[] = [];
  const advanceLines = new Map<string, number>();
  const advanceIds = new Set<string>();
  /* Advance lines that folded in a draft: their line was not added to the chain's starting figure (withChainRoots). */
  const foldedDraft = new Set<string>();
  for (const l of o.lines) {
    if (!l.source || !(l.amount > 0)) continue;
    if (l.source.type === 'CLAIM' && l.kind === 'EARNING') {
      const n = await peoplePrisma.expenseClaim.updateMany({
        where: { orgId: o.orgId, id: l.source.id, status: { in: ['APPROVED', 'WITH_SALARY'] } },
        data: { status: 'PAID', payMode: 'SALARY', paidOn: o.today, paidByUserId: o.userId, payrollAdjustmentId: marker, payrollPeriodName: 'Full and final settlement' },
      });
      if (n.count) closed.push(`CLAIM:${l.source.id}`);
    } else if (l.source.type === 'ADVANCE' && l.kind === 'DEDUCTION') {
      advanceLines.set(l.source.id, round2((advanceLines.get(l.source.id) || 0) + l.amount));
      advanceIds.add(l.source.id);
      if (l.source.draftId) foldedDraft.add(l.source.id);
    } else if (l.source.type === 'CARRY' && l.source.advanceId) {
      advanceIds.add(l.source.advanceId);
    }
  }
  for (const id of advanceIds) {
    const line = advanceLines.get(id);
    const did = await peoplePrisma.$transaction(async (tx) => {
      await lock(tx, `people-money-advance-row:${id}`);
      const a = await tx.employeeAdvance.findFirst({ where: { orgId: o.orgId, id } });
      if (!a || a.status !== 'PAID') return false;
      let recovered = round2(Number(a.recoveredAmount));
      let recovering = round2(Number(a.recoveringAmount));
      const link = liveLink(a.payrollAdjustmentId);
      /* With the chain's starting figure, the settlement's line is already in it (closePayrollSources): People's figures are the chain's. */
      let based = false;
      if (link) {
        let chain = await recoveryChain(o.orgId, link);
        if (!(recovering > 0) && chain?.base == null) chain = null;
        /* A draft an older settlement's line folded in without naming it: replaced by the settlement, as before. */
        if (chain?.root.status === 'DRAFT' && line) {
          await payrollPrisma.payrollAdjustment.updateMany({ where: { orgId: o.orgId, id: link, status: 'DRAFT' }, data: { status: 'CANCELLED' } });
          chain = await recoveryChain(o.orgId, link);
        }
        if (chain) ({ recovered, recovering } = foldRecovery(a, chain));
        based = chain?.base != null && !foldedDraft.has(id) && chain.root.status !== 'DRAFT';
        /* A folded draft was cancelled with the payment: what the chain took is counted, the line is added below as before. */
        if (chain?.base != null && foldedDraft.has(id)) ({ recovered, recovering } = { recovered: round2(chain.base + chain.taken), recovering: round2(chain.open + chain.draft) });
      }
      const apply = Boolean(line) && !isMine(a.payrollAdjustmentId);
      if (apply && !based) recovered = round2(recovered + Math.min(line!, Math.max(0, advanceOpen({ ...a, recoveredAmount: recovered, recoveringAmount: recovering }))));
      /* Never overwrite a recovery still live in Payroll: it is kept after the marker. */
      const nextLink = apply ? (recovering > 0 && link ? `${marker}|${link}` : marker) : a.payrollAdjustmentId;
      const left = advanceOpen({ ...a, recoveredAmount: recovered, recoveringAmount: recovering });
      const close = left <= 0 && recovering <= 0;
      if (!apply && recovered === round2(Number(a.recoveredAmount)) && recovering === round2(Number(a.recoveringAmount)) && !close) return false;
      await tx.employeeAdvance.update({
        where: { id: a.id },
        data: { recoveredAmount: recovered, recoveringAmount: recovering, payrollAdjustmentId: nextLink, ...(close ? { status: 'CLOSED', closedAt: new Date() } : {}) },
      });
      return apply;
    });
    if (did) closed.push(`ADVANCE:${id}`);
  }
  return closed;
}
