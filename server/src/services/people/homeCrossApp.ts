import type { Request } from 'express';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction } from '../../constants/enums.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../attendance/guards.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './guards.js';
import { scanDays, scanQueues } from '../attendance/readiness.js';
import { payableMonth } from '../attendance/payableDays.js';
import { addDays, todayIst } from '../../utils/istDate.js';

/**
 * People Home's links into the other apps (owner's suite spec, 5–6 Nov 2026): Attendance's shift exceptions,
 * Payroll's loss of pay for the month before its run is locked, and reimbursements still to pay or to enter
 * in the books. Each says how many, from the same calculation the other app's screen uses, and where it opens.
 * A link the reader may not open, or for an app the company does not use, is left out.
 */

export type HomeLink = {
  key: 'shiftExceptions' | 'lossOfPay' | 'reimbursements';
  title: string;
  count: number;
  detail: string;
  /** An amount in rupees, when the link is about money. */
  amount?: number | null;
  /** Another app's screen, or a People screen when `app` is absent. */
  app?: 'attendance' | 'payroll';
  screen: string;
  params?: Record<string, string>;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const LOCKED = ['LOCKED', 'PAID', 'POSTED'];

export async function crossAppLinks(req: Request, ctx: { attendanceOn: boolean; payrollOn: boolean; scopeIds: string[] | null }): Promise<HomeLink[]> {
  const { accountId, orgId } = req.tenant!;
  const may = async (module: string, resource: string) => !(await authorize(req, module, PermissionAction.VIEW as any, resource));
  const [records, expenses] = await Promise.all([may(ATTENDANCE_MODULE, ATTENDANCE_RESOURCE.records), may(PEOPLE_MODULE, PEOPLE_RESOURCE.expenses)]);
  const inScope = (id: string | null | undefined) => !ctx.scopeIds || (id ? ctx.scopeIds.includes(id) : false);
  const today = todayIst();
  const out: HomeLink[] = [];

  /* Shift exceptions: the open ones of Attendance's Exceptions queue that are about a person's days, its last fortnight. */
  if (ctx.attendanceOn && records) {
    const from = addDays(today, -14);
    const to = addDays(today, -1);
    const [{ people }, queues, states] = await Promise.all([scanDays(accountId, orgId, from, to), scanQueues(orgId, from, to), peoplePrisma.attendanceExceptionState.findMany({ where: { orgId }, select: { key: true, status: true } })]);
    const closed = new Set(states.filter((s) => s.status !== 'OPEN' && s.status !== 'IN_PROGRESS').map((s) => s.key));
    let missingOut = 0;
    let noRecord = 0;
    let overtime = 0;
    for (const p of people.filter((x) => inScope(x.employeeId))) {
      missingOut += p.missingOut.filter((m) => !closed.has(`MISSING_OUT:${m.id}`)).length;
      noRecord += p.noRecord.filter((d) => !closed.has(`NO_RECORD:${p.employeeId}:${d}`)).length;
      overtime += p.unapprovedOvertime.filter((o) => !closed.has(`OVERTIME:${o.id}`)).length;
    }
    const clashes = queues.clashes.filter((c) => inScope(c.employeeId) && !closed.has(`SHIFT_CLASH:${c.a.id}:${c.b.id}`)).length;
    const count = missingOut + noRecord + overtime + clashes;
    const parts = [missingOut && `${missingOut} no check-out`, noRecord && `${noRecord} not marked`, overtime && `${overtime} overtime to approve`, clashes && plural(clashes, 'shift clash', 'shift clashes')].filter(Boolean);
    out.push({ key: 'shiftExceptions', title: 'Shift exceptions', count, detail: count ? `${parts.join(' · ')}, last 14 days` : 'None in the last 14 days', app: 'attendance', screen: 'exceptions' });
  }

  /* Loss of pay this month, as Payroll will take it, while no run for the month is locked. */
  if (ctx.payrollOn && records) {
    const month = today.slice(0, 7);
    const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, startDate: { lte: `${month}-31` }, endDate: { gte: `${month}-01` } }, select: { id: true } });
    const run = periods.length ? await payrollPrisma.payrollRun.findFirst({ where: { orgId, periodId: { in: periods.map((p) => p.id) }, status: { not: 'CANCELLED' } }, orderBy: { updatedAt: 'desc' }, select: { status: true } }) : null;
    if (!run || !LOCKED.includes(run.status)) {
      const { rows } = await payableMonth(accountId, orgId, month, ctx.scopeIds);
      const lop = rows.filter((r) => r.lossOfPayDays > 0);
      const days = Math.round(lop.reduce((n, r) => n + r.lossOfPayDays, 0) * 10) / 10;
      out.push({
        key: 'lossOfPay',
        title: 'Loss of pay before lock',
        count: lop.length,
        detail: lop.length ? `${plural(lop.length, 'person', 'people')}, ${days} day${days === 1 ? '' : 's'} so far this month${run ? '' : '; no pay run yet'}` : `Nobody so far this month${run ? '' : '; no pay run yet'}`,
        app: 'payroll',
        screen: 'runs',
      });
    }
  }

  /* Reimbursements: approved and not yet paid, and paid out of pocket but not yet entered in the books. */
  if (expenses) {
    const claims = await peoplePrisma.expenseClaim.findMany({
      where: { orgId, OR: [{ status: 'APPROVED' }, { status: { in: ['APPROVED', 'PAYING', 'WITH_SALARY', 'PAID', 'SETTLED'] }, booksStatus: 'TO_RECORD' }] },
      select: { employeeId: true, status: true, approvedTotal: true, advanceSettled: true, booksStatus: true },
    });
    const mine = claims.filter((c) => inScope(c.employeeId));
    const toPay = mine.filter((c) => c.status === 'APPROVED');
    const books = mine.filter((c) => c.booksStatus === 'TO_RECORD' && c.status !== 'APPROVED');
    const amount = toPay.reduce((n, c) => n + Number(c.approvedTotal || 0) - Number(c.advanceSettled || 0), 0);
    out.push({
      key: 'reimbursements',
      title: 'Reimbursements',
      count: toPay.length + books.length,
      amount: Math.round(amount * 100) / 100,
      detail: toPay.length || books.length ? [toPay.length && `${plural(toPay.length, 'claim')} to pay`, books.length && `${books.length} to enter in the books`].filter(Boolean).join(' · ') : 'Nothing to pay or enter',
      screen: 'expenses',
      params: { tab: toPay.length || !books.length ? 'pay' : 'books' },
    });
  }
  return out;
}
