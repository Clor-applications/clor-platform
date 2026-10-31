import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * Who decides a leave or correction request — the company's choice in
 * Attendance rules (ClorTime's approval flows, reduced to the three shapes
 * companies actually use):
 *
 *   HR               HR decides; a manager may also decide from the portal.
 *   MANAGER          the person's "Reports to" decides; HR can still step in.
 *   MANAGER_THEN_HR  the manager first, then HR; HR is refused until the
 *                    manager has approved. Someone with no manager, or
 *                    whose manager has left or is suspended, goes
 *                    straight to HR.
 */
export type Chain = 'HR' | 'MANAGER' | 'MANAGER_THEN_HR' | 'HR_ONLY';
/** The three shapes the Attendance app and the per-kind and leave settings store. */
export const CHAINS: Chain[] = ['HR', 'MANAGER', 'MANAGER_THEN_HR'];
/**
 * HR_ONLY (People → Settings → Company choices, "HR only"; SPEC 3.2): HR alone decides, and a manager sees the
 * request but cannot decide it. Only the company's correction choice can be HR_ONLY; the old HR, as before,
 * also lets a manager or approver whose scope holds the person decide ("HR or the manager, whoever is first").
 */
export const hrChain = (c: Chain) => c === 'HR' || c === 'HR_ONLY';

/** People's company choice for attendance requests, in chain words; null when not chosen there (companyChoices.ts). */
const PEOPLE_CHOICE: Record<string, Chain> = { HR_OR_MANAGER: 'HR', HR: 'HR_ONLY', MANAGER: 'MANAGER', MANAGER_THEN_HR: 'MANAGER_THEN_HR' };

export async function chainFor(orgId: string, kind: 'leave' | 'correction'): Promise<Chain> {
  if (kind === 'correction') {
    const chosen = (await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { correctionApproval: true } }))?.correctionApproval;
    if (chosen && PEOPLE_CHOICE[chosen]) return PEOPLE_CHOICE[chosen];
  }
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { leaveApproval: true, correctionApproval: true } });
  const v = (kind === 'leave' ? s?.leaveApproval : s?.correctionApproval) as Chain | undefined;
  return v && CHAINS.includes(v) ? v : 'HR';
}

/**
 * The person's manager who can still decide: their "Reports to", unless that
 * person has left or is suspended, which counts as no manager at all.
 */
export async function activeManagerOf(orgId: string, employeeId: string) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { reportingManagerId: true } });
  if (!e?.reportingManagerId) return null;
  const m = await peoplePrisma.employee.findFirst({ where: { id: e.reportingManagerId, orgId }, select: { id: true, name: true, status: true } });
  return m && m.status !== 'LEFT' && m.status !== 'SUSPENDED' ? m : null;
}

/** HR's turn? Under MANAGER_THEN_HR a request with a manager must carry the manager's approval first. */
export async function hrMayDecide(orgId: string, kind: 'leave' | 'correction', r: { employeeId: string; managerApprovedAt: Date | null }, chain?: Chain) {
  if ((chain || (await chainFor(orgId, kind))) !== 'MANAGER_THEN_HR' || r.managerApprovedAt) return { ok: true as const };
  const m = await activeManagerOf(orgId, r.employeeId);
  if (!m) return { ok: true as const };
  return { ok: false as const, error: `${m.name || 'Their manager'} has not approved this yet; the company asks for the manager first.` };
}
