import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { runInTenant } from '../../../utils/tenantScope.js';
import { startChecklist, type Item } from '../checklists.js';
import { onPeopleEvent } from '../outbox.js';

/**
 * What else a change affects (docs/people/02-PRD.md LIFE-04, COMP-04). Before
 * a transfer is sent, the form shows what will differ at the new place of
 * work: the state's holiday list, Professional Tax and Labour Welfare Fund,
 * the Shops & Establishments rules, the leave policy to review, and which
 * apps are told. The system names the differences; it does not decide the
 * legal effect. When the transfer lands, each difference becomes a review
 * task for HR on the person's record, through the same plan tasks joining
 * and leaving use.
 */

export type Impact = { key: string; title: string; detail: string; target: 'TASK' | 'TOLD' | 'INFO' };

export async function changeImpact(orgId: string, employee: { id: string; establishmentId?: string | null; departmentId?: string | null; reportingManagerId?: string | null }, fields: Record<string, string | null | undefined>): Promise<Impact[]> {
  const out: Impact[] = [];
  if (fields.establishmentId !== undefined && fields.establishmentId !== (employee.establishmentId ?? null)) {
    const [from, to] = await Promise.all([
      employee.establishmentId ? peoplePrisma.establishment.findFirst({ where: { id: employee.establishmentId, orgId }, select: { name: true, state: true } }) : null,
      fields.establishmentId ? peoplePrisma.establishment.findFirst({ where: { id: fields.establishmentId, orgId }, select: { name: true, state: true } }) : null,
    ]);
    const fromState = from?.state || null;
    const toState = to?.state || null;
    if (toState && fromState !== toState) {
      out.push({ key: 'holidays', title: `Different holiday list (${toState})`, detail: `Check ${to!.name}'s holiday list applies from the effective date.`, target: 'TASK' });
      out.push({ key: 'pt', title: `Professional Tax state changes${fromState ? ` (${fromState} → ${toState})` : ` (${toState})`}`, detail: 'Payroll applies the new state\'s Professional Tax and Labour Welfare Fund from the next run.', target: 'TOLD' });
      out.push({ key: 'se', title: `Shops & Establishments rules differ (${toState})`, detail: 'Working hours, leave and registers follow the new state; review what differs.', target: 'TASK' });
      out.push({ key: 'leave', title: `Leave policy for ${toState} may apply`, detail: 'Review which leave policy applies at the new establishment.', target: 'TASK' });
    } else if (to) {
      out.push({ key: 'site', title: `Moves to ${to.name}`, detail: 'Same state: the same rules apply.', target: 'INFO' });
    }
    out.push({ key: 'attendance', title: 'Attendance told', detail: 'Shift and site follow the new establishment; Attendance receives the transfer event.', target: 'TOLD' });
    out.push({ key: 'payroll', title: 'Payroll told', detail: 'Payroll receives the transfer event and reviews statutory settings.', target: 'TOLD' });
  }
  if (fields.departmentId !== undefined && fields.departmentId !== (employee.departmentId ?? null)) {
    out.push({ key: 'cost', title: 'Salary cost moves with the department', detail: 'Payroll books salary cost to the new department from the effective date.', target: 'TOLD' });
  }
  if (fields.reportingManagerId !== undefined && fields.reportingManagerId !== (employee.reportingManagerId ?? null)) {
    out.push({ key: 'approvals', title: 'Approvals move to the new manager', detail: 'Leave, corrections and requests go to the new manager from the effective date.', target: 'INFO' });
  }
  return out;
}

/** When a transfer lands, each state difference becomes a review task for HR (COMP-04). */
export function registerChangeReviewTasks() {
  return onPeopleEvent('people.employee.transferred.v1', async (ev) => {
    const data = ev.data as { fromEstablishmentId?: string | null; toEstablishmentId?: string | null; fields?: string[]; employee?: { id: string } };
    const employeeId = ev.employeeId || data.employee?.id;
    if (!employeeId) return;
    await runInTenant(ev.orgId, async () => {
      const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: ev.orgId }, select: { id: true, establishmentId: true, departmentId: true, reportingManagerId: true } });
      if (!employee) return;
      /* The event carries the new establishment; the review compares it with the one before, which the history keeps. */
      const before = await peoplePrisma.employmentEvent.findFirst({ where: { orgId: ev.orgId, employeeId, field: 'establishmentId' }, orderBy: { createdAt: 'desc' }, select: { fromId: true, toId: true } });
      const impact = await changeImpact(ev.orgId, { ...employee, establishmentId: before?.fromId ?? null }, { establishmentId: before?.toId ?? employee.establishmentId });
      const items: Item[] = impact.filter((i) => i.target === 'TASK').map((i) => ({ title: i.title, owner: 'HR', dueDays: 7, note: i.detail }));
      if (!items.length) return;
      const already = await peoplePrisma.checklistTask.count({ where: { orgId: ev.orgId, employeeId, kind: 'CHANGE', doneAt: null, title: { in: items.map((i) => i.title) } } });
      if (already) return;
      await startChecklist({ accountId: ev.accountId, orgId: ev.orgId, userId: null }, { id: employeeId }, 'CHANGE', new Date().toISOString().slice(0, 10), { items });
    });
  });
}
