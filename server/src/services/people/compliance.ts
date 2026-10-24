import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { verifiedMime } from '../fileType.js';

/**
 * Compliance calendar (HR research, Phase 2: "compliance calendar,
 * responsible owners, due dates, evidence vault"). CLOR works out which
 * statutory deadlines apply to the company — from who is in payroll with PF,
 * ESI and PT switched on, and how many people work there — and lists each
 * period's due date. People record who owns it, mark it done with the
 * challan or acknowledgement number, and keep the evidence. A company adds
 * its own deadlines (licence renewals, inspections) beside them.
 *
 * Central due dates are the published ones. Professional Tax dates differ by
 * state; the states CLOR knows show their usual date, the rest the last day
 * of the following month, and every PT item says to confirm with the state.
 */

type Who = { accountId: string; orgId: string; userId: string | null };
export type Link = { app: 'payroll' | 'attendance'; screen: string } | null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');
const ym = (y: number, m: number) => `${y}-${pad(m)}`;
const nextMonth = (y: number, m: number) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const date = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
const monthName = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Professional Tax: the usual monthly due day, the month after (states CLOR knows). */
export const PT_DUE_DAY: Record<string, number> = {
  karnataka: 20,
  'west bengal': 21,
  telangana: 10,
  'andhra pradesh': 10,
  gujarat: 15,
  'madhya pradesh': 10,
};

export const LINKS: Record<string, Link> = {
  PF_ECR: { app: 'payroll', screen: 'reports' },
  ESIC: { app: 'payroll', screen: 'reports' },
  TDS_DEPOSIT: { app: 'payroll', screen: 'reports' },
  TDS_24Q: { app: 'payroll', screen: 'reports' },
  FORM16: { app: 'payroll', screen: 'reports' },
  BONUS: { app: 'payroll', screen: 'runs' },
  PT: { app: 'payroll', screen: 'reports' },
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
  const profiles = payroll
    ? await payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, payrollStatus: 'IN_PAYROLL' }, select: { pfApplicable: true, esiApplicable: true, ptApplicable: true, professionalTaxState: true } })
    : [];
  const ptStates = [...new Set(profiles.filter((p) => p.ptApplicable && p.professionalTaxState).map((p) => String(p.professionalTaxState).trim()))].sort();
  return {
    payroll: payroll && profiles.length > 0,
    pf: profiles.some((p) => p.pfApplicable),
    esi: profiles.some((p) => p.esiApplicable),
    ptStates,
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
    for (const state of a.ptStates) {
      const day = PT_DUE_DAY[state.toLowerCase()];
      out.push({
        code: `PT_${state.toUpperCase().replace(/[^A-Z]+/g, '_')}`,
        period,
        title: `Professional Tax (${state}) paid and returned for ${label}`,
        dueDate: day ? date(ny, nm, day) : date(ny, nm, lastDay(ny, nm)),
        note: day ? "Usual due date; confirm with the state's notification." : "CLOR does not know this state's due date: set it, and confirm with the state.",
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

const linkFor = (code: string): Link => LINKS[code] ?? (code.startsWith('PT_') ? LINKS.PT : null);

/** The calendar: what is due from two months ago to three months ahead, plus anything still open from before. */
export async function calendar(who: Who) {
  const today = todayIst();
  const from = addDays(today, -62);
  const to = addDays(today, 93);
  const a = await applicability(who.accountId, who.orgId);
  /* Nothing from before the company was on CLOR: a new company is not "late" for months it was not here. */
  const org = await platformPrisma.org.findUnique({ where: { id: who.orgId }, select: { createdAt: true } });
  const joined = org ? new Date(org.createdAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) : from;
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

const MAX_EVIDENCE = 5 * 1024 * 1024;
const EVIDENCE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/** Owner, status, reference, note, due date (custom only) and evidence. */
export async function updateTask(who: Who, id: string, body: any) {
  const task = await peoplePrisma.complianceTask.findFirst({ where: { id, orgId: who.orgId } });
  if (!task) throw Object.assign(new Error('No such deadline.'), { status: 404 });
  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!['OPEN', 'DONE', 'NOT_APPLICABLE'].includes(body.status)) throw Object.assign(new Error('Status is OPEN, DONE or NOT_APPLICABLE.'), { status: 400 });
    data.status = body.status;
    data.doneAt = body.status === 'DONE' ? task.doneAt || new Date() : null;
    data.doneByUserId = body.status === 'DONE' ? task.doneByUserId || who.userId : null;
  }
  for (const k of ['owner', 'reference', 'note'] as const) if (body[k] !== undefined) data[k] = body[k] ? String(body[k]).trim().slice(0, k === 'note' ? 1000 : 200) : null;
  if (body.dueDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate))) throw Object.assign(new Error('Dates are YYYY-MM-DD.'), { status: 400 });
    data.dueDate = body.dueDate;
  }
  if (body.evidence) {
    const { name, mime, dataUrl } = body.evidence;
    if (!EVIDENCE_TYPES.includes(mime)) throw Object.assign(new Error('Evidence is a PDF, PNG or JPEG.'), { status: 400 });
    const bytes = Buffer.from(String(dataUrl || '').replace(/^data:[^,]+,/, ''), 'base64');
    if (!bytes.length || bytes.length > MAX_EVIDENCE) throw Object.assign(new Error('Evidence is up to 5 MB.'), { status: 400 });
    /* A-42: the file's own bytes have to agree with what it says it is. */
    if (!verifiedMime(bytes, mime, (t) => EVIDENCE_TYPES.includes(t))) throw Object.assign(new Error('That file is not what its name says. Upload the PDF or picture itself.'), { status: 400 });
    Object.assign(data, { evidenceName: String(name || 'evidence').slice(0, 200), evidenceMime: mime, evidenceData: bytes });
  }
  await peoplePrisma.complianceTask.update({ where: { id: task.id }, data: data as any });
}

/** A company's own deadline (licence renewal, inspection…). */
export async function addCustom(who: Who, body: any) {
  const title = String(body?.title || '').trim();
  const dueDate = String(body?.dueDate || '');
  if (!title) throw Object.assign(new Error('Name the deadline.'), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw Object.assign(new Error('Choose the due date.'), { status: 400 });
  const period = `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return peoplePrisma.complianceTask.create({
    data: { accountId: who.accountId, orgId: who.orgId, code: 'CUSTOM', period, title: title.slice(0, 200), dueDate, owner: body?.owner ? String(body.owner).slice(0, 200) : null, note: body?.note ? String(body.note).slice(0, 1000) : null },
  });
}

export async function evidenceOf(orgId: string, id: string) {
  const t = await peoplePrisma.complianceTask.findFirst({ where: { id, orgId }, select: { evidenceName: true, evidenceMime: true, evidenceData: true } });
  if (!t?.evidenceData) return null;
  return { name: t.evidenceName, mime: t.evidenceMime, dataUrl: `data:${t.evidenceMime};base64,${Buffer.from(t.evidenceData).toString('base64')}` };
}
