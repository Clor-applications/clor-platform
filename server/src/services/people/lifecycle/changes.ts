import { payrollPrisma } from '../../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { runInTenant } from '../../../utils/tenantScope.js';
import { startChecklist, type Item } from '../checklists.js';
import { onPeopleEvent } from '../outbox.js';

/**
 * What else a change affects (docs/people/02-PRD.md LIFE-04, COMP-04), said
 * truthfully. Each line is one of:
 *   AUTO   — happens by itself, because the other app reads the employee
 *            record when it works (Attendance's holidays follow the
 *            Location; a pay run takes the department as it is then);
 *   ACTION — will NOT follow unless someone acts (Payroll deducts
 *            Professional Tax for the state on the payroll profile, not the
 *            work site), with the fix that can be done in the same step;
 *   TASK   — a difference to review; it becomes a task on the record when
 *            the change lands;
 *   INFO   — nothing to do.
 * A line about an app the company does not use is left out, never shown as
 * "told". Nothing here decides the legal effect of a move.
 */

export type Impact = {
  key: string;
  title: string;
  detail: string;
  target: 'AUTO' | 'ACTION' | 'TASK' | 'INFO';
  /* What the form may do about an ACTION line in the same step. */
  fix?: { kind: 'ptState'; state: string };
};
export type ImpactApps = { payroll: boolean; attendance: boolean; seePayroll: boolean };
type Subject = { id: string; establishmentId?: string | null; departmentId?: string | null; reportingManagerId?: string | null; areaId?: string | null };

const nameOf = async (model: 'area' | 'department', orgId: string, id: string | null | undefined) =>
  id ? ((await (peoplePrisma as any)[model].findFirst({ where: { id, orgId }, select: { name: true } }))?.name as string | undefined) || null : null;

export async function changeImpact(orgId: string, employee: Subject, fields: Record<string, string | null | undefined>, apps: ImpactApps = { payroll: false, attendance: false, seePayroll: false }, opts: { managerVisible?: boolean } = {}): Promise<Impact[]> {
  const out: Impact[] = [];
  const changed = (k: keyof Subject) => fields[k] !== undefined && fields[k] !== (employee[k] ?? null);
  if (changed('establishmentId')) {
    const [from, to] = await Promise.all([
      employee.establishmentId ? peoplePrisma.establishment.findFirst({ where: { id: employee.establishmentId, orgId }, select: { name: true, state: true } }) : null,
      fields.establishmentId ? peoplePrisma.establishment.findFirst({ where: { id: fields.establishmentId, orgId }, select: { name: true, state: true } }) : null,
    ]);
    const fromState = from?.state || null;
    const toState = to?.state || null;
    if (toState && fromState !== toState) {
      out.push({ key: 'se', title: `Shops & Establishments rules differ (${toState})`, detail: 'Working hours, leave and registers follow the new state; review what differs.', target: 'TASK' });
      out.push({ key: 'leave', title: `Leave policy for ${toState} may apply`, detail: 'Review which leave policy applies at the new work site.', target: 'TASK' });
      if (apps.payroll) {
        const profile = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId, employeeId: employee.id }, select: { ptApplicable: true, professionalTaxState: true } });
        if (profile?.ptApplicable) {
          const now = profile.professionalTaxState || null;
          if (now === toState) out.push({ key: 'pt', title: `Professional Tax is already ${toState}`, detail: 'Nothing to change in Payroll.', target: 'INFO' });
          else out.push({
            key: 'pt',
            title: apps.seePayroll ? `Professional Tax stays ${now || 'unset'} in Payroll` : 'Professional Tax state does not follow the move',
            detail: `Payroll deducts Professional Tax for the state on the payroll profile, not the work site. Until it is changed, ${toState} PT is not deducted.`,
            target: 'ACTION',
            fix: { kind: 'ptState', state: toState },
          });
        }
      }
    } else if (to) {
      out.push({ key: 'site', title: `Moves to ${to.name}`, detail: 'Same state: the same rules apply.', target: 'INFO' });
    }
  }
  if (changed('areaId') && apps.attendance) {
    const area = await nameOf('area', orgId, fields.areaId);
    out.push({ key: 'holidays', title: area ? `Holidays follow ${area}` : 'No location: only company-wide holidays apply', detail: 'Attendance reads the location when it marks each day, from the day the change applies.', target: 'AUTO' });
  }
  if (changed('departmentId') && apps.payroll) {
    const dept = await nameOf('department', orgId, fields.departmentId);
    out.push({ key: 'cost', title: dept ? `Salary cost counts under ${dept}` : 'Salary cost has no department', detail: 'A pay run takes the department as it is on the day it runs.', target: 'AUTO' });
  }
  if (changed('reportingManagerId')) {
    const found = fields.reportingManagerId
      ? await peoplePrisma.employee.findFirst({ where: { id: fields.reportingManagerId, orgId }, select: { name: true, userId: true, portalPasswordHash: true } })
      : null;
    /* Someone outside the viewer's team is not named here, nor is whether they can sign in (Workforce audit S17). */
    const hidden = opts.managerVisible === false;
    const manager = found && hidden ? { name: 'the new manager', userId: 'hidden', portalPasswordHash: null } : found;
    /* Attendance asks the manager only when the company's approval setting says so, and looks the manager up when it decides. */
    if (apps.attendance) {
      const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { leaveApproval: true, correctionApproval: true } });
      const viaManager = [settings?.leaveApproval, settings?.correctionApproval].some((c) => c === 'MANAGER' || c === 'MANAGER_THEN_HR');
      if (viaManager) out.push({ key: 'approvals', title: manager ? `Leave and corrections go to ${manager.name}` : 'Leave and corrections go to HR', detail: 'Including requests already waiting: the manager is looked up when a request is decided.', target: 'AUTO' });
      else out.push({ key: 'approvals', title: 'Leave and corrections stay with HR', detail: 'The company has HR approve them, so the manager does not change who decides.', target: 'INFO' });
    }
    /* A manager who cannot sign in anywhere cannot approve anything: requests sent their way would wait. */
    if (manager && !manager.userId && !manager.portalPasswordHash) {
      out.push({ key: 'manager-no-login', title: `${manager.name} cannot sign in yet`, detail: 'Requests sent to them would wait. Link a CLOR login on their Organization tab, or give them the employee app.', target: 'ACTION' });
    }
  }
  return out;
}

/** When a transfer lands, each state difference becomes a review task for HR (COMP-04). */
export function registerChangeReviewTasks() {
  return onPeopleEvent('people.employee.transferred.v1', async (ev) => {
    const data = ev.data as { fromEstablishmentId?: string | null; toEstablishmentId?: string | null; fromState?: string | null; toState?: string | null; fields?: string[]; employee?: { id: string } };
    const employeeId = ev.employeeId || data.employee?.id;
    if (!employeeId) return;
    /*
     * This move's own work sites and states, as the event carries them: a
     * move of location or branch only leaves the work site alone, and must
     * not bring back the differences of some earlier move.
     */
    const from = data.fromEstablishmentId ?? null;
    const to = data.toEstablishmentId ?? null;
    if (!to || from === to) return;
    if (!data.toState || (data.fromState ?? null) === data.toState) return;
    await runInTenant(ev.orgId, async () => {
      const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: ev.orgId }, select: { id: true, establishmentId: true, departmentId: true, reportingManagerId: true } });
      if (!employee) return;
      const impact = await changeImpact(ev.orgId, { ...employee, establishmentId: from }, { establishmentId: to });
      const items: Item[] = impact.filter((i) => i.target === 'TASK').map((i) => ({ title: i.title, owner: 'HR', dueDays: 7, note: i.detail }));
      if (!items.length) return;
      const already = await peoplePrisma.checklistTask.count({ where: { orgId: ev.orgId, employeeId, kind: 'CHANGE', doneAt: null, title: { in: items.map((i) => i.title) } } });
      if (already) return;
      await startChecklist({ accountId: ev.accountId, orgId: ev.orgId, userId: null }, { id: employeeId }, 'CHANGE', new Date().toISOString().slice(0, 10), { items });
    });
  });
}
