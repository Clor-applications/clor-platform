import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { addDays, istDate, todayIst } from '../../utils/istDate.js';
import { canonicalState, stateLabel, ptDueFor, lwfDueFor, PT_FILINGS, LWF_FILINGS, NO_PT_STATES } from '../../constants/stateLevies.js';

/**
 * Compliance calendar (HR research, Phase 2: "compliance calendar,
 * responsible owners, due dates, evidence vault"). CLOR works out which
 * statutory deadlines apply to the company — from who is in payroll with PF,
 * ESI and PT switched on, and how many people work there — and lists each
 * period's due date. People record who owns it, mark it done with the
 * challan or acknowledgement number, and keep the evidence. A company adds
 * its own deadlines (licence renewals, inspections) beside them.
 *
 * Central due dates are the published ones. Professional Tax and Labour
 * Welfare Fund dates differ by state, and come from the shared state table
 * (constants/stateLevies.ts) that Payroll's returns read too: PT for each
 * state with people on PT, LWF for each state with people in payroll once
 * LWF is switched on. A state CLOR has no date for shows the last day of the
 * following month and says to confirm it with the state.
 */

type Who = { accountId: string; orgId: string; userId: string | null };
export type Link = { app: 'payroll' | 'attendance'; screen: string } | null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const ym = (y: number, m: number) => `${y}-${pad(m)}`;
const nextMonth = (y: number, m: number) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const date = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
const monthName = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;


export const LINKS: Record<string, Link> = {
  PF_ECR: { app: 'payroll', screen: 'reports' },
  ESIC: { app: 'payroll', screen: 'reports' },
  TDS_DEPOSIT: { app: 'payroll', screen: 'reports' },
  TDS_24Q: { app: 'payroll', screen: 'reports' },
  FORM16: { app: 'payroll', screen: 'reports' },
  BONUS: { app: 'payroll', screen: 'runs' },
  PT: { app: 'payroll', screen: 'reports' },
  LWF: { app: 'payroll', screen: 'reports' },
  POSH_REPORT: null,
  CUSTOM: null,
};

type Due = { code: string; period: string; title: string; dueDate: string; note?: string };

/** What applies to this company, from its own data. */
export async function applicability(accountId: string, orgId: string) {
  const [payroll, people] = await Promise.all([
    isFeatureEnabled(accountId, orgId, 'payroll'),
    peoplePrisma.employee.count({ where: { accountId, orgId, status: { not: 'LEFT' } } }),
  ]);
  const [profiles, lwfOn] = payroll
    ? await Promise.all([
        payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, payrollStatus: 'IN_PAYROLL' }, select: { pfApplicable: true, esiApplicable: true, ptApplicable: true, professionalTaxState: true } }),
        payrollPrisma.statutoryScheme.count({ where: { orgId, code: 'LWF', isEnabled: true } }),
      ])
    : [[], 0];
  /* One name per state, so "KA" and "Karnataka" are one deadline. */
  const ptStates = [...new Set(profiles.filter((p) => p.ptApplicable && canonicalState(p.professionalTaxState)).map((p) => canonicalState(p.professionalTaxState)))].sort();
  /* LWF reaches everybody in payroll in a state that collects it, once the company switches it on. */
  const lwfStates = lwfOn ? [...new Set(profiles.map((p) => canonicalState(p.professionalTaxState)).filter((st) => st && LWF_FILINGS[st]))].sort() : [];
  return {
    payroll: payroll && profiles.length > 0,
    pf: profiles.some((p) => p.pfApplicable),
    esi: profiles.some((p) => p.esiApplicable),
    ptStates,
    lwfStates,
    /* An Internal Committee and its annual report: workplaces of ten or more (POSH Act s.4, s.21). */
    posh: people >= 10,
    people,
  };
}

/** Every due date that falls between `from` and `to`. */
export function dueDates(a: Awaited<ReturnType<typeof applicability>>, from: string, to: string): Due[] {
  const out: Due[] = [];
  const within = (d: string) => d >= from && d <= to;
  /* Monthly: the month whose payroll it is, due the month after. */
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 2);
  let [y, m] = [start.getUTCFullYear(), start.getUTCMonth() + 1];
  for (let i = 0; i < 9; i += 1) {
    const [ny, nm] = nextMonth(y, m);
    const period = ym(y, m);
    const label = monthName(y, m);
    if (a.payroll && a.pf) out.push({ code: 'PF_ECR', period, title: `PF: ECR filed and paid for ${label}`, dueDate: date(ny, nm, 15) });
    if (a.payroll && a.esi) out.push({ code: 'ESIC', period, title: `ESIC: contribution filed and paid for ${label}`, dueDate: date(ny, nm, 15) });
    if (a.payroll) out.push({ code: 'TDS_DEPOSIT', period, title: `TDS on salaries deposited for ${label}`, dueDate: m === 3 ? date(y, 4, 30) : date(ny, nm, 7) });
    for (const named of a.ptStates) {
      const state = canonicalState(named);
      if (NO_PT_STATES.includes(state)) continue;
      const code = `PT_${state.replace(/[^A-Z]+/g, '_')}`;
      const f = PT_FILINGS[state];
      const due = ptDueFor(state, y, m);
      if (f && !due) continue;
      /* A quarterly or half-yearly return is one deadline, however many months it covers. */
      if (due && out.some((d) => d.code === code && d.period === due.key)) continue;
      out.push({
        code,
        period: due?.key || period,
        title: `Professional Tax (${stateLabel(state)}) paid and returned for ${due?.label || label}${f ? `: ${f.form}` : ''}`,
        dueDate: due?.dueDate || date(ny, nm, lastDay(ny, nm)),
        note: f?.dueKnown ? `${f.how} The usual date: confirm it with the state's notification, and file on the state portal.` : "CLOR does not know this state's due date: set it, and confirm with the state.",
      });
    }
    for (const state of (a.lwfStates || []).map(canonicalState)) {
      const code = `LWF_${state.replace(/[^A-Z]+/g, '_')}`;
      const f = LWF_FILINGS[state];
      const due = lwfDueFor(state, y, m);
      if (!f || !due || out.some((d) => d.code === code && d.period === due.key)) continue;
      out.push({
        code,
        period: due.key,
        title: `Labour Welfare Fund (${stateLabel(state)}) paid for ${due.label}: ${f.form}`,
        dueDate: due.dueDate,
        note: `${f.how}${f.dueKnown ? '' : ' Confirm the date with the state.'} File it on the state portal.`,
      });
    }
    [y, m] = [ny, nm];
  }
  /* Quarterly and yearly, by the date they fall due. */
  const years = [Number(from.slice(0, 4)) - 1, Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  for (const yr of [...new Set(years)]) {
    if (a.payroll) {
      const fy = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
      const quarters: Array<[string, string, string]> = [
        [`${yr}-Q1`, date(yr, 7, 31), `24Q for Apr–Jun ${yr} (FY ${fy(yr)}, Q1)`],
        [`${yr}-Q2`, date(yr, 10, 31), `24Q for Jul–Sep ${yr} (FY ${fy(yr)}, Q2)`],
        [`${yr}-Q3`, date(yr + 1, 1, 31), `24Q for Oct–Dec ${yr} (FY ${fy(yr)}, Q3)`],
        [`${yr}-Q4`, date(yr + 1, 5, 31), `24Q for Jan–Mar ${yr + 1} (FY ${fy(yr)}, Q4)`],
      ];
      for (const [period, due, title] of quarters) out.push({ code: 'TDS_24Q', period, title: `TDS return: ${title}`, dueDate: due });
      out.push({ code: 'FORM16', period: String(yr), title: `Form 16 given to employees for FY ${fy(yr - 1)}`, dueDate: date(yr, 6, 15) });
      out.push({ code: 'BONUS', period: String(yr), title: `Statutory bonus paid for FY ${fy(yr - 1)}`, dueDate: date(yr, 11, 30), note: 'Payment of Bonus Act: within eight months of the year closing, for those it covers.' });
    }
    if (a.posh) out.push({ code: 'POSH_REPORT', period: String(yr), title: `POSH: Internal Committee annual report for ${yr - 1}`, dueDate: date(yr, 1, 31), note: "The usual date; some states set another. The report goes to the District Officer." });
  }
  return out.filter((d) => within(d.dueDate));
}

const linkFor = (code: string): Link => LINKS[code] ?? (code.startsWith('PT_') ? LINKS.PT : code.startsWith('LWF_') ? LINKS.LWF : null);

/** The calendar: what is due from two months ago to three months ahead, plus anything still open from before. */
export async function calendar(who: Who) {
  const today = todayIst();
  const from = addDays(today, -62);
  const to = addDays(today, 93);
  const a = await applicability(who.accountId, who.orgId);
  /* Nothing from before the company was on CLOR: a new company is not "late" for months it was not here. */
  const org = await platformPrisma.org.findUnique({ where: { id: who.orgId }, select: { createdAt: true } });
  const joined = org ? istDate(org.createdAt) : from;
  const due = dueDates(a, joined > from ? joined : from, to);
  if (due.length) {
    await peoplePrisma.complianceTask.createMany({
      data: due.map((d) => ({ accountId: who.accountId, orgId: who.orgId, code: d.code, period: d.period, title: d.title, dueDate: d.dueDate, note: d.note ?? null })),
      skipDuplicates: true,
    });
  }
  const rows = await peoplePrisma.complianceTask.findMany({
    where: { orgId: who.orgId, OR: [{ dueDate: { gte: from, lte: to } }, { status: 'OPEN', dueDate: { lt: from } }] },
    orderBy: [{ dueDate: 'asc' }, { title: 'asc' }],
    select: { id: true, code: true, period: true, title: true, dueDate: true, status: true, owner: true, reference: true, note: true, evidenceName: true, doneAt: true, doneByUserId: true },
  });
  const ids = [...new Set(rows.map((r) => r.doneByUserId).filter(Boolean))] as string[];
  const users = ids.length ? await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const tasks = rows.map((r) => ({
    ...r,
    doneBy: r.doneByUserId ? nameOf.get(r.doneByUserId) || '' : '',
    overdue: r.status === 'OPEN' && r.dueDate < today,
    dueSoon: r.status === 'OPEN' && r.dueDate >= today && r.dueDate <= addDays(today, 7),
    link: linkFor(r.code),
  }));
  return {
    today,
    applies: a,
    summary: {
      overdue: tasks.filter((t) => t.overdue).length,
      dueSoon: tasks.filter((t) => t.dueSoon).length,
      done: tasks.filter((t) => t.status === 'DONE').length,
      open: tasks.filter((t) => t.status === 'OPEN').length,
    },
    tasks,
  };
}

export async function evidenceOf(orgId: string, id: string) {
  const t = await peoplePrisma.complianceTask.findFirst({ where: { id, orgId }, select: { evidenceName: true, evidenceMime: true, evidenceData: true } });
  if (!t?.evidenceData) return null;
  return { name: t.evidenceName, mime: t.evidenceMime, dataUrl: `data:${t.evidenceMime};base64,${Buffer.from(t.evidenceData).toString('base64')}` };
}
