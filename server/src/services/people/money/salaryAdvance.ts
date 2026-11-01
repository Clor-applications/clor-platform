import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { inr, round2 } from '../../../utils/money.js';
import { notifyUsers } from '../../notifications.js';
import { MoneyError, pendingLink, sendForApproval, type Me, type Staff } from './expenses.js';
import { PERQUISITE_LIMIT, loanState, makeSalaryAdvanceLoan, payCap, payrollOn } from './payrollBridge.js';

/**
 * Salary advance asked from the employee app (WORKFLOW-GAP-RESEARCH 4.2).
 *
 * The person says how much, why and over how many months (1 to 24) they will
 * repay it. Before they send it they see the most that can come off a month's
 * pay: by the wage law, all deductions together stay within half the month's
 * wages, so the monthly repayment fits in what is left of that half. The
 * request goes through the SALARY_ADVANCE approval rule (by default HR, which
 * in a small business is the owner). Approved, it becomes a Payroll loan of
 * type SALARY_ADVANCE, interest free, recovered from the open month on.
 *
 * Interest-free loans above ₹2,00,000 in total can be a taxable perquisite
 * (Income-tax Rules, rule 3(7)(i); medical loans are exempt). CLOR says so
 * and does not work it out: the rule number may have moved under the 2025
 * Act's rules, and HR or the accountant confirms.
 */

const MAX_MONTHS = 24;
const OPEN = ['WAITING'];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const PENDING = 'pending:';

const WORDS: Record<string, string> = { WAITING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Not approved', WITHDRAWN: 'Withdrawn' };

export const emiOf = (amount: number, months: number) => (months > 0 ? Math.ceil((amount / months) * 100) / 100 : amount);

/** The cap in words the person reads, and whether an ask fits in it. */
export async function capFor(orgId: string, employeeId: string, ask?: { amount: number; months: number }) {
  const cap = await payCap(orgId, employeeId);
  const emi = ask ? emiOf(ask.amount, ask.months) : null;
  const owedNow = cap?.interestFreeOwed ?? 0;
  return {
    known: Boolean(cap),
    monthlyRoom: cap?.room ?? null,
    wages: cap?.wages ?? null,
    basis: cap?.basis ?? null,
    mostOver: (months: number) => (cap ? round2(cap.room * months) : null),
    emi,
    fits: !cap || emi == null ? true : emi <= cap.room,
    perquisite: ask ? owedNow + ask.amount > PERQUISITE_LIMIT : false,
    interestFreeOwed: owedNow,
    explain: cap
      ? `${cap.percent === 50 ? 'By law, everything taken off your pay in a month stays within half your wages' : `Your company keeps everything taken off your pay in a month within ${cap.percent}% of your wages`} (${inr(cap.limit)} of ${inr(cap.wages)}, from your ${cap.basis}). After PF, tax and what you already repay this month, up to ${inr(cap.room)} a month can go to this.`
      : 'HR checks the amount against your pay before deciding.',
  };
}

function shape(a: { id: string; amount: unknown; months: number; reason: string; status: string; loanId: string | null; payrollNote: string | null; createdAt: Date; approvalRequestId: string | null }, loan?: Awaited<ReturnType<typeof loanState>> | null, words?: { status: string; comment: string | null; canReply: boolean }) {
  return {
    id: a.id, amount: num(a.amount), months: a.months, emi: emiOf(num(a.amount), a.months), reason: a.reason, status: a.status,
    statusLabel: words?.status === 'MORE_INFO' ? 'More information asked for' : WORDS[a.status] || a.status,
    loan: loan ? { number: loan.number, status: loan.status, outstanding: loan.outstanding, instalment: loan.instalment } : null,
    payrollNote: a.payrollNote, comment: words?.comment ?? null, canReply: Boolean(words?.canReply), canWithdraw: a.status === 'WAITING', createdAt: a.createdAt,
    approvalRequestId: a.approvalRequestId && !a.approvalRequestId.startsWith(PENDING) ? a.approvalRequestId : null,
  };
}

/** For the employee app: my asks, what I still owe on salary advances and loans, and the cap. */
export async function mySalaryAdvance(me: Me) {
  const { catchUpAsks } = await import('./effects.js');
  await catchUpAsks(me.orgId, me.employeeId);
  const [asks, available] = await Promise.all([
    peoplePrisma.salaryAdvanceAsk.findMany({ where: { orgId: me.orgId, employeeId: me.employeeId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    payrollOn(me.accountId, me.orgId),
  ]);
  if (!available) return { available: false, asks: [], loans: [], cap: null };
  const reqIds = asks.map((a) => a.approvalRequestId).filter((id): id is string => Boolean(id) && !id!.startsWith(PENDING));
  const steps = reqIds.length ? await peoplePrisma.approvalRequest.findMany({ where: { orgId: me.orgId, id: { in: reqIds } }, select: { id: true, status: true, steps: { where: { comment: { not: null }, decidedAt: { not: null } }, orderBy: { decidedAt: 'desc' }, take: 1, select: { comment: true, status: true } } } }) : [];
  const words = new Map(steps.map((r) => [r.id, { status: r.status, comment: r.steps[0]?.status !== 'SKIPPED' ? r.steps[0]?.comment ?? null : null, canReply: r.status === 'MORE_INFO' }]));
  const loans = await payrollPrisma.payrollLoan.findMany({ where: { orgId: me.orgId, employeeId: me.employeeId, status: { in: ['ACTIVE', 'DRAFT'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, type: true, status: true, principal: true, installmentAmount: true, outstandingBalance: true } });
  const loanById = new Map(await Promise.all(asks.filter((a) => a.loanId).map(async (a) => [a.loanId!, await loanState(me.orgId, a.loanId!)] as const)));
  const cap = await capFor(me.orgId, me.employeeId);
  return {
    available: true,
    asks: asks.map((a) => shape(a, a.loanId ? loanById.get(a.loanId) : null, words.get(a.approvalRequestId || ''))),
    loans: loans.map((l) => ({ number: l.number, kind: l.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan', status: l.status, principal: num(l.principal), instalment: num(l.installmentAmount), outstanding: num(l.outstandingBalance) })),
    cap: { known: cap.known, monthlyRoom: cap.monthlyRoom, explain: cap.explain, interestFreeOwed: cap.interestFreeOwed },
    maxMonths: MAX_MONTHS, perquisiteLimit: PERQUISITE_LIMIT,
  };
}

function clean(input: { amount?: unknown; months?: unknown; reason?: unknown }) {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new MoneyError('How much do you need?');
  if (amount > 1_000_000) throw new MoneyError('That is more than ₹10,00,000. Talk to HR.');
  const months = Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) throw new MoneyError(`Repay over 1 to ${MAX_MONTHS} months.`);
  const reason = String(input.reason ?? '').trim().slice(0, 300);
  return { amount, months, reason };
}

export async function previewAsk(me: Me, input: { amount?: unknown; months?: unknown }) {
  const { amount, months } = clean({ ...input, reason: 'x' });
  const cap = await capFor(me.orgId, me.employeeId, { amount, months });
  return { amount, months, emi: cap.emi, fits: cap.fits, monthlyRoom: cap.monthlyRoom, mostYouCanAsk: cap.mostOver(months), perquisite: cap.perquisite, explain: cap.explain };
}

export async function askSalaryAdvance(me: Me, input: { amount?: unknown; months?: unknown; reason?: unknown }) {
  const { amount, months, reason } = clean(input);
  if (reason.length < 3) throw new MoneyError('Say what it is for. Only HR and the people who approve it read this.');
  const e = await peoplePrisma.employee.findFirst({ where: { id: me.employeeId, orgId: me.orgId }, select: { id: true, name: true, userId: true, status: true } });
  if (!e) throw new MoneyError('No such person.', 404);
  if (e.status === 'LEFT' || e.status === 'ON_NOTICE') throw new MoneyError('A salary advance cannot be asked while leaving. Talk to HR.', 409);
  if (!(await payrollOn(me.accountId, me.orgId))) throw new MoneyError('Your company does not run payroll here. Ask HR directly.', 409);
  const cap = await capFor(me.orgId, me.employeeId, { amount, months });
  if (!cap.fits) throw new MoneyError(`${inr(cap.emi!)} a month is more than can come off your pay (${inr(cap.monthlyRoom!)} a month). Ask for less, or repay over more months: up to ${inr(cap.mostOver(months)!)} over ${months} month${months === 1 ? '' : 's'}.`, 400, 'OVER_CAP');
  const key = pendingLink();
  const made = await peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-money-salary-advance:${me.employeeId}`}))`;
    const open = await tx.salaryAdvanceAsk.findFirst({ where: { orgId: me.orgId, employeeId: me.employeeId, status: { in: OPEN } } });
    if (open) {
      /* A double tap returns the one just made; a second, different ask waits for the first. */
      if (num(open.amount) === amount && open.months === months && Date.now() - open.createdAt.getTime() < 2 * 60_000) return { row: open, fresh: false };
      throw new MoneyError('You already have a salary advance waiting for a decision. Wait for it, or withdraw it first.', 409, 'ASK_WAITING');
    }
    return { row: await tx.salaryAdvanceAsk.create({ data: { accountId: me.accountId, orgId: me.orgId, employeeId: me.employeeId, amount, months, reason, status: 'WAITING', approvalRequestId: `${PENDING}${key}` } }), fresh: true };
  });
  if (!made.fresh) return shape(made.row);
  try {
    const r = await sendForApproval(e, me, 'SALARY_ADVANCE', `${e.name}: salary advance ${inr(amount)} over ${months} month${months === 1 ? '' : 's'}`, { amount, months, emi: cap.emi, monthlyRoom: cap.monthlyRoom, perquisite: cap.perquisite, askId: made.row.id }, `salary-advance:${key}`);
    await peoplePrisma.salaryAdvanceAsk.updateMany({ where: { id: made.row.id, orgId: me.orgId, approvalRequestId: `${PENDING}${key}` }, data: { approvalRequestId: r.request.id } });
  } catch (err) {
    await peoplePrisma.salaryAdvanceAsk.deleteMany({ where: { id: made.row.id, orgId: me.orgId, approvalRequestId: `${PENDING}${key}` } });
    throw err;
  }
  return shape(await peoplePrisma.salaryAdvanceAsk.findFirstOrThrow({ where: { id: made.row.id, orgId: me.orgId } }));
}

/**
 * Approved: the ask becomes a Payroll loan. A lock per ask and a fresh look
 * under it mean a retry or a second "send to Payroll" never makes two loans.
 * When Payroll cannot take it yet, the ask is approved with the reason kept,
 * and HR sends it again from People › Expenses once that is fixed.
 */
export async function toPayroll(ask: { id: string; orgId: string; accountId: string }, userId: string) {
  return peoplePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-money-ask:${ask.id}`}))`;
    const a = await tx.salaryAdvanceAsk.findFirst({ where: { id: ask.id, orgId: ask.orgId } });
    if (!a) throw new MoneyError('No such salary advance.', 404);
    if (a.status !== 'APPROVED') throw new MoneyError('Only an approved salary advance goes to Payroll.', 409);
    if (a.loanId) return { loanId: a.loanId, already: true };
    const e = await peoplePrisma.employee.findFirst({ where: { id: a.employeeId, orgId: a.orgId }, select: { name: true } });
    let made: Awaited<ReturnType<typeof makeSalaryAdvanceLoan>>;
    try {
      made = await makeSalaryAdvanceLoan({ accountId: a.accountId, orgId: a.orgId, userId, employeeId: a.employeeId, askId: a.id, amount: num(a.amount), months: a.months, notes: `Salary advance asked by ${e?.name || 'the employee'} in the employee app: ${a.reason}` });
    } catch (err) {
      /* Approved stays approved: what did not reach Payroll is sent again from People › Expenses. */
      console.error('[people-money] salary advance not sent to payroll:', err instanceof Error ? err.message : err); // eslint-disable-line no-console
      made = { made: false, why: 'It could not reach Payroll just now. Send it again.' };
    }
    if (!made.made) {
      await tx.salaryAdvanceAsk.update({ where: { id: a.id }, data: { payrollNote: made.why } });
      return { loanId: null, why: made.why };
    }
    await tx.salaryAdvanceAsk.update({ where: { id: a.id }, data: { loanId: made.loanId, payrollNote: null } });
    return { loanId: made.loanId, number: made.number, loanStatus: made.status };
  }, { timeout: 60_000 });
}

export async function approveAsk(request: { id: string; orgId: string; accountId: string; idempotencyKey: string | null }, userId: string) {
  const key = request.idempotencyKey?.startsWith('salary-advance:') ? `${PENDING}${request.idempotencyKey.slice('salary-advance:'.length)}` : null;
  const a = await peoplePrisma.salaryAdvanceAsk.findFirst({ where: { orgId: request.orgId, status: 'WAITING', OR: [{ approvalRequestId: request.id }, ...(key ? [{ approvalRequestId: key }] : [])] } });
  if (!a) return { skipped: 'No salary advance waits on this request.' };
  const r = await peoplePrisma.salaryAdvanceAsk.updateMany({ where: { id: a.id, status: 'WAITING' }, data: { status: 'APPROVED', approvalRequestId: request.id } });
  if (!r.count) return { skipped: 'Already decided.' };
  const out = await toPayroll(a, userId);
  const e = await peoplePrisma.employee.findFirst({ where: { id: a.employeeId, orgId: a.orgId }, select: { userId: true } });
  if (e?.userId) await notifyUsers(a.accountId, a.orgId, [e.userId], { kind: 'people.expense', title: `Salary advance approved: ${inr(num(a.amount))}` }).catch(() => undefined);
  return { askId: a.id, ...out };
}

/** HR sends an approved ask to Payroll again once Payroll is ready. */
export async function sendAgain(staff: Staff, askId: string) {
  const a = await peoplePrisma.salaryAdvanceAsk.findFirst({ where: { id: askId, orgId: staff.orgId } });
  if (!a) throw new MoneyError('No such salary advance.', 404);
  const out = await toPayroll(a, staff.userId);
  if (!out.loanId) throw new MoneyError(out.why || 'Payroll could not take it.', 409, 'PAYROLL_NOT_READY');
  return out;
}

export async function listAsks(orgId: string) {
  const { catchUpAsks } = await import('./effects.js');
  await catchUpAsks(orgId);
  const rows = await peoplePrisma.salaryAdvanceAsk.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 300 });
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true } })).map((p) => [p.id, p]));
  const loans = new Map(await Promise.all(rows.filter((r) => r.loanId).map(async (r) => [r.loanId!, await loanState(orgId, r.loanId!)] as const)));
  return rows.map((r) => ({ ...shape(r, r.loanId ? loans.get(r.loanId) : null), employeeId: r.employeeId, employeeName: people.get(r.employeeId)?.name || '', employeeCode: people.get(r.employeeId)?.code || null }));
}

/** For the approval drawer: the ask, the cap and the perquisite warning. */
export async function askDetail(orgId: string, request: { id: string; idempotencyKey: string | null }, employee: { name: string; code: string | null } | null) {
  const key = request.idempotencyKey?.startsWith('salary-advance:') ? `${PENDING}${request.idempotencyKey.slice('salary-advance:'.length)}` : null;
  const a = await peoplePrisma.salaryAdvanceAsk.findFirst({ where: { orgId, OR: [{ approvalRequestId: request.id }, ...(key ? [{ approvalRequestId: key }] : [])] } });
  if (!a) return { record: null };
  const cap = await capFor(orgId, a.employeeId, { amount: num(a.amount), months: a.months });
  const loan = a.loanId ? await loanState(orgId, a.loanId) : null;
  return {
    record: { ...shape(a, loan), employeeName: employee?.name ?? null, employeeCode: employee?.code ?? null },
    /* Approvers see whether it fits and the room; never the person's wages or how they were worked out. */
    cap: { known: cap.known, monthlyRoom: cap.monthlyRoom, fits: cap.fits },
    perquisite: cap.perquisite ? `Interest-free loans to this person would come to ${inr(cap.interestFreeOwed + num(a.amount))}. Above ₹2,00,000 in total, the interest saved can be a taxable perquisite (medical loans are exempt). Check with your accountant before approving; CLOR does not work it out.` : null,
  };
}
