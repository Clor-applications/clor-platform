import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { addDays, addMonths, todayIst } from '../../utils/istDate.js';
import { scopeWhere, type TeamScope } from './scope.js';
import { docWhere, type DocAccess } from './documentAccess.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { loadSchedule, resolveShift } from '../attendance/schedule.js';
import { isWeeklyOff } from '../attendance/compute.js';
import { DEFAULT_REASONS, exitSettings } from './engagement/exitInterview.js';

/**
 * People's own reports (platform audit, 11 Nov 2026: "People reports with
 * filters and charts"). Each report is worked out here, from the employee
 * list and the stints of employment, so a month in the past reads as it was;
 * the screen and the CSV are the same rows.
 *
 * Every report is cut to the reader's team scope (scope.ts) and to the
 * filters on screen. A breakdown by gender or age never shows a small number
 * to a reader who is not whole-company HR: see `maskRow`.
 *
 * One shape for all of them: columns, rows, a totals row, one chart and the
 * notes that say how a figure was worked out.
 */

export type ReportCtx = {
  orgId: string;
  scope: TeamScope;
  /** Whole-company HR (keeps the records, not limited to a team): reads small numbers as they are. */
  hr: boolean;
  /** What the reader may open of people's documents (documentAccess.ts). */
  docs: DocAccess;
  /** Holds the Payroll right to salary slips: the branch table carries pay cost. */
  payCost?: boolean;
};
export type Cell = string | number | null;
export type ReportColumn = { key: string; label: string; align?: 'right'; kind?: 'date' | 'pct' | 'money' };
export type ReportChart = { kind: 'stacked' | 'grouped' | 'line'; unit?: '%'; categories: string[]; series: Array<{ label: string; values: number[]; other?: boolean }> } | null;
export type ReportResult = {
  id: string; title: string; from: string | null; to: string; by: string | null;
  columns: ReportColumn[]; rows: Array<Record<string, Cell>>; totals: Record<string, Cell> | null;
  chart: ReportChart; notes: string[]; masked: boolean;
};

export class ReportError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** What the reports home lists, and which filters each report takes. `dates`: a span of months, one day, or a span of days. */
export const HR_REPORTS = [
  { id: 'headcount', group: 'Workforce', name: 'Headcount over time', description: 'How many people worked here at the end of each month, by department, branch, employment type or grade.', dates: 'months', by: true },
  { id: 'tenure', group: 'Workforce', name: 'Length of service', description: 'How long people have been here, in bands, with the average.', dates: 'day', by: true },
  { id: 'age', group: 'Workforce', name: 'Age mix', description: 'People by age band. Small groups show “fewer than 5”.', dates: 'day', by: true },
  { id: 'gender', group: 'Workforce', name: 'Gender mix', description: 'Women, men and other answers. Small groups show “fewer than 5”.', dates: 'day', by: true },
  { id: 'movement', group: 'Joining and leaving', name: 'Joiners, leavers and attrition', description: 'Who joined and left each month, the attrition rate for the month and for the 12 months before it.', dates: 'months', by: true },
  { id: 'probation', group: 'Joining and leaving', name: 'Probation and confirmations', description: 'Probation ending or overdue, and people confirmed in the period.', dates: 'days', by: false },
  { id: 'contracts', group: 'Joining and leaving', name: 'Contracts ending', description: 'Fixed-term contracts that end in the period.', dates: 'days', by: false },
  { id: 'documents', group: 'Documents and compliance', name: 'Documents expiring', description: 'Visas, licences and other papers that have expired or are about to.', dates: 'days', by: false },
  /* Round 45 and round 40 picks (18 Nov 2026): time, leave, branches, probation outcomes and reasons for leaving. */
  { id: 'branches', group: 'Workforce', name: 'Branches side by side', description: 'Each branch’s headcount, leavers, attrition and absence, and its pay cost for whoever may read salary slips.', dates: 'months', by: false },
  { id: 'probationoutcomes', group: 'Joining and leaving', name: 'Probation outcomes', description: 'Month by month, how many people were confirmed, had probation extended or were let go.', dates: 'months', by: false },
  { id: 'exitreasons', group: 'Joining and leaving', name: 'Reasons for leaving', description: 'The main reason each leaver gave in the exit interview, read one by one and counted.', dates: 'months', by: false },
  { id: 'absence', group: 'Time and attendance', name: 'Absence rate', description: 'Working days lost to absence and leave each month, as a share of working days.', dates: 'months', by: false },
  { id: 'overtime', group: 'Time and attendance', name: 'Overtime hours', description: 'Hours worked past the shift each month, approved and not yet approved.', dates: 'months', by: false },
  { id: 'late', group: 'Time and attendance', name: 'Late comers', description: 'Who came in late, how often, and by how many minutes on average.', dates: 'days', by: false },
  { id: 'leavetypes', group: 'Leave', name: 'Leave taken by type', description: 'Approved leave days for each kind of leave, this year by default.', dates: 'months', by: false },
  { id: 'offsoon', group: 'Leave', name: 'Who is off soon', description: 'Approved leave in the coming weeks, names by week.', dates: 'days', by: false },
  { id: 'shifts', group: 'Time and attendance', name: 'Shifts: planned and present', description: 'For each shift on the day, how many were due in and how many are in.', dates: 'day', by: false },
  { id: 'sickspells', group: 'Leave', name: 'Sick days next to weekends', description: 'Sick leave that starts right after or ends right before a weekly off or a holiday.', dates: 'months', by: false },
] as const;
/** Reports about people leaving: kept from whoever the company keeps the Leaving list from (companyChoices.ts). */
export const LEAVING_REPORTS: readonly string[] = ['movement', 'probationoutcomes', 'exitreasons'];
/** Reports that name the reason someone gave for leaving: only for readers who see every leaver's reason. */
export const REASON_REPORTS: readonly string[] = ['exitreasons'];
export type ReportId = (typeof HR_REPORTS)[number]['id'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const GROUPINGS = ['department', 'branch', 'employmentType', 'grade'] as const;
type Grouping = (typeof GROUPINGS)[number];
const BY_WORD: Record<Grouping, string> = { department: 'Department', branch: 'Branch', employmentType: 'Employment type', grade: 'Grade' };
const BY_FIELD: Record<Grouping, 'departmentId' | 'branchId' | 'employeeTypeId' | 'gradeId'> = { department: 'departmentId', branch: 'branchId', employmentType: 'employeeTypeId', grade: 'gradeId' };
const NONE: Record<Grouping, string> = { department: 'No department', branch: 'No branch', employmentType: 'No employment type', grade: 'No grade' };
const MAX_MONTHS = 36;
const MAX_DAYS = 800;
/** A chart carries three colours; the rest is one grey "Other" (DESIGN.md, UI rules 8 Nov 2026). */
const CHART_COLOURS = 3;
/** Below this many people a gender or age figure could name someone. */
export const SMALL_GROUP = 5;
export const FEWER = 'Fewer than 5';
export const NOT_FEWER = '5 or more';

export type ReportQuery = { from?: unknown; to?: unknown; by?: unknown; departmentId?: unknown; branchId?: unknown; employeeTypeId?: unknown; gradeId?: unknown };
type Filters = { from: string; to: string; by: Grouping | 'month'; departmentId: string | null; branchId: string | null; employeeTypeId: string | null; gradeId: string | null };

const monthOf = (d: string) => d.slice(0, 7);
const lastDayOf = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthWord = (m: string) => `${MONTH_WORDS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = monthOf(addMonths(`${m}-01`, 1))) out.push(m);
  return out;
}

/** The filters as asked, with each report's own default period. */
function filtersOf(id: ReportId, q: ReportQuery, today: string): Filters {
  const spec = HR_REPORTS.find((r) => r.id === id)!;
  const day = (v: unknown) => (ISO.test(String(v || '')) ? String(v) : null);
  const pick = (v: unknown) => String(v || '').trim().slice(0, 60) || null;
  let to = day(q.to);
  let from = day(q.from);
  if (spec.dates === 'months') {
    to ||= today;
    /* Leave by type reads "this year" until a period is chosen. */
    if (!from && id === 'leavetypes') from = `${to.slice(0, 4)}-01-01`;
    from = `${monthOf(from || addMonths(`${monthOf(to)}-01`, -11))}-01`;
    if (from > to) throw new ReportError('The period starts after it ends.');
    if (monthsBetween(from, to).length > MAX_MONTHS) throw new ReportError(`A report covers at most ${MAX_MONTHS} months.`);
  } else if (spec.dates === 'day') {
    to ||= today;
    from = to;
  } else {
    /* Looking ahead: what is due in the next 90 days, and what was missed in the last year. */
    /* Late comers look back a month; who is off looks four weeks ahead. */
    to ||= id === 'late' ? today : id === 'offsoon' ? addDays(today, 27) : addDays(today, 90);
    from ||= id === 'contracts' || id === 'offsoon' ? today : id === 'late' ? addDays(today, -29) : addDays(today, -365);
    if (from > to) throw new ReportError('The period starts after it ends.');
    if (daysBetween(from, to) > MAX_DAYS) throw new ReportError(`A report covers at most ${MAX_DAYS} days.`);
  }
  const asked = String(q.by || '');
  const by = (GROUPINGS as readonly string[]).includes(asked) ? (asked as Grouping) : id === 'movement' ? 'month' : 'department';
  return { from: from!, to: to!, by, departmentId: pick(q.departmentId), branchId: pick(q.branchId), employeeTypeId: pick(q.employeeTypeId), gradeId: pick(q.gradeId) };
}

type Person = {
  id: string; code: string | null; name: string; status: string; gender: string | null; dateOfBirth: string | null;
  dateOfJoining: string | null; dateOfLeaving: string | null; createdAt: Date;
  departmentId: string | null; branchId: string | null; employeeTypeId: string | null; gradeId: string | null;
  probationEndDate: string | null; confirmedOn: string | null; contractEndDate: string | null;
};
type Stint = { employeeId: string; startDate: string; endDate: string | null };
type Loaded = { people: Person[]; stints: Stint[]; label: (by: Grouping, id: string | null) => string };

/** The people the reader may see who match the filters, their stints, and the names of what they are grouped by. */
async function load(ctx: ReportCtx, f: Filters): Promise<Loaded> {
  const { orgId } = ctx;
  const where = {
    orgId, ...scopeWhere(ctx.scope),
    ...(f.departmentId ? { departmentId: f.departmentId === 'none' ? null : f.departmentId } : {}),
    ...(f.branchId ? { branchId: f.branchId === 'none' ? null : f.branchId } : {}),
    ...(f.employeeTypeId ? { employeeTypeId: f.employeeTypeId === 'none' ? null : f.employeeTypeId } : {}),
    ...(f.gradeId ? { gradeId: f.gradeId === 'none' ? null : f.gradeId } : {}),
  };
  const [people, episodes, departments, types, grades, branches] = await Promise.all([
    peoplePrisma.employee.findMany({
      where,
      select: { id: true, code: true, name: true, status: true, gender: true, dateOfBirth: true, dateOfJoining: true, dateOfLeaving: true, createdAt: true, departmentId: true, branchId: true, employeeTypeId: true, gradeId: true, probationEndDate: true, confirmedOn: true, contractEndDate: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }) as Promise<Person[]>,
    peoplePrisma.employmentEpisode.findMany({ where: { orgId }, select: { employeeId: true, startDate: true, endDate: true } }),
    peoplePrisma.department.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.employeeType.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.grade.findMany({ where: { orgId }, select: { id: true, name: true } }),
    platformPrisma.branch.findMany({ where: { orgId }, select: { id: true, branchName: true } }),
  ]);
  const ids = new Set(people.map((p) => p.id));
  const stints: Stint[] = episodes.filter((e) => ids.has(e.employeeId));
  /* Someone with no stint on file yet still counts, from what their record says. */
  const withStint = new Set(stints.map((s) => s.employeeId));
  for (const p of people) {
    if (withStint.has(p.id)) continue;
    stints.push({ employeeId: p.id, startDate: p.dateOfJoining || p.createdAt.toISOString().slice(0, 10), endDate: p.status === 'LEFT' ? p.dateOfLeaving : null });
  }
  const names: Record<Grouping, Map<string, string>> = {
    department: new Map(departments.map((d) => [d.id, d.name])),
    employmentType: new Map(types.map((t) => [t.id, t.name])),
    grade: new Map(grades.map((g) => [g.id, g.name])),
    branch: new Map(branches.map((b) => [b.id, b.branchName])),
  };
  return { people, stints, label: (by, id) => (id ? names[by].get(id) || 'Unknown' : NONE[by]) };
}

const workingOn = (s: Stint, day: string) => s.startDate <= day && (!s.endDate || s.endDate >= day);

/** Three series and one grey "Other", biggest first: what a chart may carry. */
function topSeries(series: Array<{ label: string; values: number[] }>): NonNullable<ReportChart>['series'] {
  const size = (s: { values: number[] }) => s.values.reduce((n, v) => n + v, 0);
  const sorted = [...series].filter((s) => size(s) > 0).sort((a, b) => size(b) - size(a) || a.label.localeCompare(b.label));
  const head = sorted.slice(0, CHART_COLOURS);
  const rest = sorted.slice(CHART_COLOURS);
  if (!rest.length) return head;
  const other = rest[0].values.map((_, i) => rest.reduce((n, s) => n + s.values[i], 0));
  return [...head, { label: rest.length === 1 ? rest[0].label : 'Other', values: other, other: true }];
}

/**
 * Small numbers (the audit's privacy rule). For a reader who is not whole-company HR, a row with any count from
 * 1 to 4 shows no exact figure in its breakdown: each band reads "Fewer than 5" or "5 or more", so the small one
 * cannot be worked out from the others either. The row's total stays: the directory already shows it.
 */
export function maskRow(counts: number[], hr: boolean): { cells: Cell[]; masked: boolean } {
  if (hr || !counts.some((n) => n > 0 && n < SMALL_GROUP)) return { cells: counts, masked: false };
  return { cells: counts.map((n) => (n < SMALL_GROUP ? FEWER : NOT_FEWER)), masked: true };
}

const SMALL_NOTE = `Where a group has fewer than ${SMALL_GROUP} people in a band, the figures read “${FEWER.toLowerCase()}” or “${NOT_FEWER}”, so nobody can be picked out. HR for the whole company sees the numbers.`;
const NOW_NOTE = (by: Grouping) => `People are counted under the ${BY_WORD[by].toLowerCase()} they are in today.`;

/** Headcount at the end of each month, by the chosen grouping. */
function headcountReport(f: Filters, d: Loaded): Omit<ReportResult, 'id' | 'title'> {
  const by = f.by === 'month' ? 'department' : f.by;
  const groupOf = new Map(d.people.map((p) => [p.id, p[BY_FIELD[by]] || '']));
  const months = monthsBetween(f.from, f.to);
  const counts = months.map((m) => {
    const day = lastDayOf(m) > f.to ? f.to : lastDayOf(m);
    const row = new Map<string, number>();
    for (const s of d.stints) if (workingOn(s, day)) row.set(groupOf.get(s.employeeId) || '', (row.get(groupOf.get(s.employeeId) || '') || 0) + 1);
    return row;
  });
  const last = counts[counts.length - 1];
  const keys = [...new Set(counts.flatMap((c) => [...c.keys()]))].sort((a, b) => (last.get(b) || 0) - (last.get(a) || 0) || d.label(by, a || null).localeCompare(d.label(by, b || null)));
  const col = (k: string) => `g:${k || 'none'}`;
  const rows = months.map((m, i) => {
    const row: Record<string, Cell> = { month: monthWord(m) };
    let total = 0;
    for (const k of keys) { row[col(k)] = counts[i].get(k) || 0; total += counts[i].get(k) || 0; }
    row.total = total;
    return row;
  });
  return {
    from: f.from, to: f.to, by,
    columns: [{ key: 'month', label: 'Month' }, ...keys.map((k) => ({ key: col(k), label: d.label(by, k || null), align: 'right' as const })), { key: 'total', label: 'Total', align: 'right' }],
    rows, totals: null,
    chart: { kind: 'stacked', categories: months.map(monthWord), series: topSeries(keys.map((k) => ({ label: d.label(by, k || null), values: counts.map((c) => c.get(k) || 0) }))) },
    notes: ['Headcount is everyone working here on the last day of the month (today, for this month).', NOW_NOTE(by)],
    masked: false,
  };
}

/** One month's movement for a set of stints: who was here when it opened and closed, who joined and who left. */
function monthMovement(stints: Stint[], m: string, to: string) {
  const first = `${m}-01`;
  const end = lastDayOf(m) > to ? to : lastDayOf(m);
  let start = 0; let close = 0; let joiners = 0; let leavers = 0;
  for (const s of stints) {
    if (s.startDate < first && (!s.endDate || s.endDate >= first)) start += 1;
    if (workingOn(s, end)) close += 1;
    if (s.startDate >= first && s.startDate <= end) joiners += 1;
    if (s.endDate && s.endDate >= first && s.endDate <= end) leavers += 1;
  }
  return { start, close, joiners, leavers, average: (start + close) / 2 };
}
const rate = (leavers: number, average: number): number | null => (average ? round1((leavers / average) * 100) : null);

/** Joiners, leavers and attrition: month by month, or one line per department, branch, type or grade. */
function movementReport(f: Filters, d: Loaded): Omit<ReportResult, 'id' | 'title'> {
  const months = monthsBetween(f.from, f.to);
  const notes = ['Attrition is leavers over the average headcount (the start and the end of the month, halved). Over several months it is leavers over the average of the months.', 'Someone counts as a leaver in the month of their last working day.'];
  if (f.by === 'month') {
    /* Eleven months before the period too, so the first row has its trailing 12 months. */
    const lead = monthsBetween(addMonths(f.from, -11), f.from).slice(0, -1);
    const all = [...lead, ...months].map((m) => ({ m, ...monthMovement(d.stints, m, f.to) }));
    const rows = months.map((m, i) => {
      const x = all[lead.length + i];
      const window = all.slice(i, lead.length + i + 1);
      return {
        month: monthWord(m), start: x.start, joiners: x.joiners, leavers: x.leavers, end: x.close,
        attrition: rate(x.leavers, x.average),
        trailing: rate(window.reduce((n, w) => n + w.leavers, 0), window.reduce((n, w) => n + w.average, 0) / window.length),
      } as Record<string, Cell>;
    });
    const period = all.slice(lead.length);
    const leavers = period.reduce((n, x) => n + x.leavers, 0);
    return {
      from: f.from, to: f.to, by: 'month',
      columns: [{ key: 'month', label: 'Month' }, { key: 'start', label: 'At start', align: 'right' }, { key: 'joiners', label: 'Joiners', align: 'right' }, { key: 'leavers', label: 'Leavers', align: 'right' }, { key: 'end', label: 'At end', align: 'right' }, { key: 'attrition', label: 'Attrition', align: 'right', kind: 'pct' }, { key: 'trailing', label: 'Last 12 months', align: 'right', kind: 'pct' }],
      rows,
      totals: { month: 'Whole period', start: period[0].start, joiners: period.reduce((n, x) => n + x.joiners, 0), leavers, end: period[period.length - 1].close, attrition: rate(leavers, period.reduce((n, x) => n + x.average, 0) / period.length), trailing: null },
      chart: { kind: 'grouped', categories: months.map(monthWord), series: [{ label: 'Joiners', values: period.map((x) => x.joiners) }, { label: 'Leavers', values: period.map((x) => x.leavers) }] },
      notes: [...notes, 'Last 12 months: leavers in the 12 months ending with that month, over the average headcount of those months.'],
      masked: false,
    };
  }
  const by = f.by;
  const groupOf = new Map(d.people.map((p) => [p.id, p[BY_FIELD[by]] || '']));
  const byGroup = new Map<string, Stint[]>();
  for (const s of d.stints) {
    const k = groupOf.get(s.employeeId) || '';
    byGroup.set(k, [...(byGroup.get(k) || []), s]);
  }
  const line = (label: string, stints: Stint[]) => {
    const per = months.map((m) => monthMovement(stints, m, f.to));
    const leavers = per.reduce((n, x) => n + x.leavers, 0);
    const average = per.reduce((n, x) => n + x.average, 0) / per.length;
    return { group: label, start: per[0].start, joiners: per.reduce((n, x) => n + x.joiners, 0), leavers, end: per[per.length - 1].close, average: round1(average), attrition: rate(leavers, average) } as Record<string, Cell>;
  };
  const rows = [...byGroup.entries()].map(([k, stints]) => line(d.label(by, k || null), stints))
    .filter((r) => r.start || r.joiners || r.leavers || r.end)
    .sort((a, b) => Number(b.end) - Number(a.end) || String(a.group).localeCompare(String(b.group)));
  const shown = rows.slice(0, 12);
  return {
    from: f.from, to: f.to, by,
    columns: [{ key: 'group', label: BY_WORD[by] }, { key: 'start', label: 'At start', align: 'right' }, { key: 'joiners', label: 'Joiners', align: 'right' }, { key: 'leavers', label: 'Leavers', align: 'right' }, { key: 'end', label: 'At end', align: 'right' }, { key: 'average', label: 'Average headcount', align: 'right' }, { key: 'attrition', label: 'Attrition', align: 'right', kind: 'pct' }],
    rows,
    totals: rows.length ? { ...line('Everyone', d.stints), group: 'Everyone' } : null,
    chart: { kind: 'grouped', categories: shown.map((r) => String(r.group)), series: [{ label: 'Joiners', values: shown.map((r) => Number(r.joiners)) }, { label: 'Leavers', values: shown.map((r) => Number(r.leavers)) }] },
    notes: [...notes, NOW_NOTE(by)],
    masked: false,
  };
}

type Band = { key: string; label: string; holds: (n: number | null) => boolean };
const TENURE_BANDS: Band[] = [
  { key: 'm6', label: 'Under 6 months', holds: (n) => n !== null && n < 0.5 },
  { key: 'y1', label: '6 to 12 months', holds: (n) => n !== null && n >= 0.5 && n < 1 },
  { key: 'y2', label: '1 to 2 years', holds: (n) => n !== null && n >= 1 && n < 2 },
  { key: 'y5', label: '2 to 5 years', holds: (n) => n !== null && n >= 2 && n < 5 },
  { key: 'y10', label: '5 to 10 years', holds: (n) => n !== null && n >= 5 && n < 10 },
  { key: 'more', label: '10 years or more', holds: (n) => n !== null && n >= 10 },
];
const AGE_BANDS: Band[] = [
  { key: 'u25', label: 'Under 25', holds: (n) => n !== null && n < 25 },
  { key: 'a25', label: '25 to 34', holds: (n) => n !== null && n >= 25 && n < 35 },
  { key: 'a35', label: '35 to 44', holds: (n) => n !== null && n >= 35 && n < 45 },
  { key: 'a45', label: '45 to 54', holds: (n) => n !== null && n >= 45 && n < 55 },
  { key: 'a55', label: '55 or over', holds: (n) => n !== null && n >= 55 },
  { key: 'unknown', label: 'Not recorded', holds: (n) => n === null },
];
const GENDERS = [{ key: 'FEMALE', label: 'Women' }, { key: 'MALE', label: 'Men' }, { key: 'OTHER', label: 'Another identity' }, { key: 'unknown', label: 'Not said' }];
/* The profile's answers (routes/people.ts GENDER_OPTIONS) in the report's four columns; no answer and "prefer not to say" read the same. */
const GENDER_BAND: Record<string, string> = { FEMALE: 'FEMALE', MALE: 'MALE', NON_BINARY: 'OTHER', OTHER: 'OTHER' };

/** Whole years and the part of a year between two days, on the calendar (a birthday or a joining date). */
function yearsBetween(from: string, to: string) {
  if (!ISO.test(from) || from > to) return null;
  let whole = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (to.slice(5) < from.slice(5)) whole -= 1;
  const since = addMonths(from, whole * 12);
  return whole + daysBetween(since, to) / 365;
}

/**
 * People working on a day, counted into bands, one line per group. `measure` gives each person's number (years of
 * service, age) or the band key itself; `sensitive` bands follow the small-numbers rule.
 */
function bandReport(f: Filters, d: Loaded, ctx: ReportCtx, opts: { bands: Array<{ key: string; label: string }>; bandOf: (p: Person, stint: Stint) => string; measure?: (p: Person, stint: Stint) => number | null; averageLabel?: string; sensitive: boolean; notes: string[] }): Omit<ReportResult, 'id' | 'title'> {
  const by = f.by === 'month' ? 'department' : f.by;
  const day = f.to;
  const personOf = new Map(d.people.map((p) => [p.id, p]));
  type Tally = { counts: Map<string, number>; total: number; sum: number; measured: number };
  const blank = (): Tally => ({ counts: new Map(), total: 0, sum: 0, measured: 0 });
  const groups = new Map<string, Tally>();
  const everyone = blank();
  const seen = new Set<string>();
  for (const s of d.stints) {
    if (!workingOn(s, day) || seen.has(s.employeeId)) continue;
    seen.add(s.employeeId);
    const p = personOf.get(s.employeeId)!;
    const k = p[BY_FIELD[by]] || '';
    const band = opts.bandOf(p, s);
    const n = opts.measure ? opts.measure(p, s) : null;
    for (const t of [groups.get(k) || groups.set(k, blank()).get(k)!, everyone]) {
      t.counts.set(band, (t.counts.get(band) || 0) + 1);
      t.total += 1;
      if (n !== null) { t.sum += n; t.measured += 1; }
    }
  }
  const hr = ctx.hr || !opts.sensitive;
  let masked = false;
  const line = (label: string, t: Tally) => {
    const m = maskRow(opts.bands.map((b) => t.counts.get(b.key) || 0), hr);
    masked ||= m.masked;
    const row: Record<string, Cell> = { group: label };
    opts.bands.forEach((b, i) => { row[b.key] = m.cells[i]; });
    row.total = t.total;
    /* An average over a handful of people is as telling as their count. */
    if (opts.averageLabel) row.average = m.masked || !t.measured || (!hr && t.measured < SMALL_GROUP) ? null : round1(t.sum / t.measured);
    return { row, masked: m.masked };
  };
  const rows = [...groups.entries()].sort((a, b) => b[1].total - a[1].total || d.label(by, a[0] || null).localeCompare(d.label(by, b[0] || null))).map(([k, t]) => line(d.label(by, k || null), t).row);
  const all = line('Everyone', everyone);
  return {
    from: null, to: day, by,
    columns: [{ key: 'group', label: BY_WORD[by] }, ...opts.bands.map((b) => ({ key: b.key, label: b.label, align: 'right' as const })), { key: 'total', label: 'Total', align: 'right' }, ...(opts.averageLabel ? [{ key: 'average', label: opts.averageLabel, align: 'right' as const }] : [])],
    rows, totals: rows.length ? all.row : null,
    /* The picture is the whole selection's; where even that is masked there is none to draw. */
    chart: !rows.length || all.masked ? null : { kind: 'grouped', categories: opts.bands.map((b) => b.label), series: [{ label: 'People', values: opts.bands.map((b) => everyone.counts.get(b.key) || 0) }] },
    notes: [...opts.notes, NOW_NOTE(by), ...(masked ? [SMALL_NOTE] : [])],
    masked,
  };
}

const bandFor = (bands: Band[], n: number | null) => bands.find((b) => b.holds(n))?.key || bands[bands.length - 1].key;

const STATUS_WORD: Record<string, string> = { ACTIVE: 'Active', ON_NOTICE: 'On notice', SUSPENDED: 'Suspended', LEFT: 'Left' };
const monthChart = (from: string, to: string, series: Array<{ label: string; days: string[] }>): ReportChart => {
  const months = monthsBetween(from, to);
  return { kind: 'grouped', categories: months.map(monthWord), series: series.map((s) => ({ label: s.label, values: months.map((m) => s.days.filter((d) => monthOf(d) === m).length) })) };
};
const who = (p: Person, d: Loaded) => ({ name: p.name, code: p.code || '', department: p.departmentId ? d.label('department', p.departmentId) : '' });
const PERSON_COLUMNS: ReportColumn[] = [{ key: 'name', label: 'Employee' }, { key: 'code', label: 'Employee ID' }, { key: 'department', label: 'Department' }];

/** Probation ending in the period and not yet confirmed (overdue once the day has passed), and confirmations made in it. */
function probationReport(f: Filters, d: Loaded, today: string): Omit<ReportResult, 'id' | 'title'> {
  const rows: Array<Record<string, Cell>> = [];
  const due: string[] = [];
  const confirmed: string[] = [];
  for (const p of d.people) {
    if (p.confirmedOn && p.confirmedOn >= f.from && p.confirmedOn <= f.to) {
      confirmed.push(p.confirmedOn);
      rows.push({ ...who(p, d), joined: p.dateOfJoining, ends: p.probationEndDate, confirmed: p.confirmedOn, status: 'Confirmed', days: null, sort: p.confirmedOn });
    } else if (!p.confirmedOn && p.status !== 'LEFT' && p.probationEndDate && p.probationEndDate >= f.from && p.probationEndDate <= f.to) {
      due.push(p.probationEndDate);
      const days = daysBetween(today, p.probationEndDate);
      rows.push({ ...who(p, d), joined: p.dateOfJoining, ends: p.probationEndDate, confirmed: null, status: days < 0 ? 'Overdue' : 'Due', days, sort: p.probationEndDate });
    }
  }
  rows.sort((a, b) => String(a.sort).localeCompare(String(b.sort)) || String(a.name).localeCompare(String(b.name)));
  for (const r of rows) delete r.sort;
  const overdue = rows.filter((r) => r.status === 'Overdue').length;
  return {
    from: f.from, to: f.to, by: null,
    columns: [...PERSON_COLUMNS, { key: 'joined', label: 'Joined', kind: 'date' }, { key: 'ends', label: 'Probation ends', kind: 'date' }, { key: 'confirmed', label: 'Confirmed on', kind: 'date' }, { key: 'status', label: 'Status' }, { key: 'days', label: 'Days left', align: 'right' }],
    rows,
    totals: rows.length ? { name: `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`, status: `${overdue} overdue, ${due.length - overdue} due, ${confirmed.length} confirmed` } : null,
    chart: rows.length ? monthChart(f.from, f.to, [{ label: 'Probation ends', days: due }, { label: 'Confirmed', days: confirmed }]) : null,
    notes: ['Overdue: the probation end date has passed and nobody has confirmed the person. Days left is counted from today.'],
    masked: false,
  };
}

/** Contracts that end in the period, for people still working here. */
function contractsReport(f: Filters, d: Loaded, today: string): Omit<ReportResult, 'id' | 'title'> {
  const ending = d.people.filter((p) => p.status !== 'LEFT' && p.contractEndDate && p.contractEndDate >= f.from && p.contractEndDate <= f.to)
    .sort((a, b) => a.contractEndDate!.localeCompare(b.contractEndDate!) || a.name.localeCompare(b.name));
  const rows = ending.map((p) => ({ ...who(p, d), type: p.employeeTypeId ? d.label('employmentType', p.employeeTypeId) : '', joined: p.dateOfJoining, ends: p.contractEndDate, status: STATUS_WORD[p.status] || p.status, days: daysBetween(today, p.contractEndDate!) } as Record<string, Cell>));
  return {
    from: f.from, to: f.to, by: null,
    columns: [...PERSON_COLUMNS, { key: 'type', label: 'Employment type' }, { key: 'joined', label: 'Joined', kind: 'date' }, { key: 'ends', label: 'Contract ends', kind: 'date' }, { key: 'status', label: 'Status' }, { key: 'days', label: 'Days left', align: 'right' }],
    rows,
    totals: rows.length ? { name: `${rows.length} ${rows.length === 1 ? 'contract' : 'contracts'}` } : null,
    chart: rows.length ? monthChart(f.from, f.to, [{ label: 'Contracts ending', days: ending.map((p) => p.contractEndDate!) }]) : null,
    notes: ['Days left is counted from today; a minus figure is a contract already past its end date.'],
    masked: false,
  };
}

const DOC_KIND: Record<string, string> = { ID_PROOF: 'ID proof', ADDRESS_PROOF: 'Address proof', EDUCATION: 'Education', CONTRACT: 'Contract', PAYSLIP: 'Payslip', WORK_PERMIT: 'Work permit', CERTIFICATE: 'Certificate', OTHER: 'Other' };

/** Documents with a valid-until date in the period: the newest version of each, and only what the reader may open. */
async function documentsReport(ctx: ReportCtx, f: Filters, d: Loaded, today: string): Promise<Omit<ReportResult, 'id' | 'title'>> {
  const personOf = new Map(d.people.filter((p) => p.status !== 'LEFT').map((p) => [p.id, p]));
  const docs = await peoplePrisma.employeeDocument.findMany({
    where: { orgId: ctx.orgId, expiresOn: { not: null, gte: f.from, lte: f.to }, supersededById: null, ...docWhere(ctx.docs) },
    select: { id: true, title: true, kind: true, expiresOn: true, employeeId: true },
    orderBy: [{ expiresOn: 'asc' }, { id: 'asc' }],
  });
  const kept = docs.filter((x) => personOf.has(x.employeeId));
  const rows = kept.map((x) => {
    const days = daysBetween(today, x.expiresOn!);
    return { ...who(personOf.get(x.employeeId)!, d), document: x.title, kind: DOC_KIND[x.kind] || x.kind, expires: x.expiresOn, status: days < 0 ? 'Expired' : 'Expiring', days } as Record<string, Cell>;
  });
  const expired = rows.filter((r) => r.status === 'Expired').length;
  return {
    from: f.from, to: f.to, by: null,
    columns: [...PERSON_COLUMNS, { key: 'document', label: 'Document' }, { key: 'kind', label: 'Kind' }, { key: 'expires', label: 'Valid until', kind: 'date' }, { key: 'status', label: 'Status' }, { key: 'days', label: 'Days left', align: 'right' }],
    rows,
    totals: rows.length ? { name: `${rows.length} ${rows.length === 1 ? 'document' : 'documents'}`, status: `${expired} expired, ${rows.length - expired} expiring` } : null,
    chart: rows.length ? monthChart(f.from, f.to, [{ label: 'Expired', days: kept.filter((x) => x.expiresOn! < today).map((x) => x.expiresOn!) }, { label: 'Expiring', days: kept.filter((x) => x.expiresOn! >= today).map((x) => x.expiresOn!) }]) : null,
    notes: ['Only documents you may open are listed, and only the newest version of each. People who have left are not listed.'],
    masked: false,
  };
}

/* ---------------------------------------------------------------- Time, leave, branches and leaving (rounds 40 and 45) */

type Body = Omit<ReportResult, 'id' | 'title'>;
const idsOf = (d: Loaded) => d.people.map((p) => p.id);
/** Days on which someone was due to work: a weekly off or a holiday is not one. */
const WORK_DAYS = ['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE'];
const hours = (minutes: number) => round1(minutes / 60);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** The day a moment falls on in India. */
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** The Monday of the week a day is in. */
const weekOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));
const SHORT_DAY = (day: string) => `${Number(day.slice(8, 10))} ${MONTH_WORDS[Number(day.slice(5, 7)) - 1]}`;

/** Working days lost to absence and leave, month by month, as a share of the days people were due to work. */
async function absenceReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const months = monthsBetween(f.from, f.to);
  const records = await peoplePrisma.attendanceRecord.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, date: { gte: f.from, lte: f.to }, status: { in: WORK_DAYS } }, select: { date: true, status: true } });
  const per = new Map(months.map((m) => [m, { working: 0, absent: 0, half: 0, leave: 0 }]));
  for (const r of records) {
    const t = per.get(monthOf(r.date));
    if (!t) continue;
    t.working += 1;
    if (r.status === 'ABSENT') t.absent += 1;
    else if (r.status === 'HALF_DAY') t.half += 1;
    else if (r.status === 'ON_LEAVE') t.leave += 1;
  }
  const line = (label: string, t: { working: number; absent: number; half: number; leave: number }) => {
    const lost = t.absent + t.leave + t.half / 2;
    return { month: label, working: t.working, absent: t.absent, half: t.half, leave: t.leave, lost: round1(lost), rate: t.working ? round1((lost / t.working) * 100) : null } as Record<string, Cell>;
  };
  const rows = months.map((m) => line(monthWord(m), per.get(m)!));
  const all = [...per.values()].reduce((a, t) => ({ working: a.working + t.working, absent: a.absent + t.absent, half: a.half + t.half, leave: a.leave + t.leave }), { working: 0, absent: 0, half: 0, leave: 0 });
  return {
    from: f.from, to: f.to, by: null,
    columns: [{ key: 'month', label: 'Month' }, { key: 'working', label: 'Working days', align: 'right' }, { key: 'absent', label: 'Absent', align: 'right' }, { key: 'half', label: 'Half days', align: 'right' }, { key: 'leave', label: 'On leave', align: 'right' }, { key: 'lost', label: 'Days lost', align: 'right' }, { key: 'rate', label: 'Absence rate', align: 'right', kind: 'pct' }],
    rows: all.working ? rows : [],
    totals: all.working ? line('Whole period', all) : null,
    chart: all.working ? { kind: 'line', unit: '%', categories: months.map(monthWord), series: [{ label: 'Absence rate', values: rows.map((r) => Number(r.rate) || 0) }] } : null,
    notes: ['Working days are the days people were due to work, from attendance records: weekly offs and holidays are left out.', 'Days lost: absent days and leave days, and half of each half day. The rate is days lost over working days.'],
    masked: false,
  };
}

/** Overtime hours (not money) each month, approved and not yet approved. */
async function overtimeReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const months = monthsBetween(f.from, f.to);
  const records = await peoplePrisma.attendanceRecord.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, date: { gte: f.from, lte: f.to }, overtimeMinutes: { gt: 0 } }, select: { date: true, employeeId: true, overtimeMinutes: true, overtimeApproved: true } });
  const per = new Map(months.map((m) => [m, { approved: 0, waiting: 0, people: new Set<string>() }]));
  for (const r of records) {
    const t = per.get(monthOf(r.date));
    if (!t) continue;
    if (r.overtimeApproved) t.approved += r.overtimeMinutes; else t.waiting += r.overtimeMinutes;
    t.people.add(r.employeeId);
  }
  const rows = months.map((m) => {
    const t = per.get(m)!;
    return { month: monthWord(m), approved: hours(t.approved), waiting: hours(t.waiting), total: hours(t.approved + t.waiting), people: t.people.size } as Record<string, Cell>;
  });
  const approved = [...per.values()].reduce((n, t) => n + t.approved, 0);
  const waiting = [...per.values()].reduce((n, t) => n + t.waiting, 0);
  return {
    from: f.from, to: f.to, by: null,
    columns: [{ key: 'month', label: 'Month' }, { key: 'approved', label: 'Approved hours', align: 'right' }, { key: 'waiting', label: 'Not yet approved', align: 'right' }, { key: 'total', label: 'All hours', align: 'right' }, { key: 'people', label: 'People', align: 'right' }],
    rows: records.length ? rows : [],
    totals: records.length ? { month: 'Whole period', approved: hours(approved), waiting: hours(waiting), total: hours(approved + waiting), people: new Set(records.map((r) => r.employeeId)).size } : null,
    chart: records.length ? { kind: 'stacked', categories: months.map(monthWord), series: [{ label: 'Approved', values: rows.map((r) => Number(r.approved)) }, { label: 'Not yet approved', values: rows.map((r) => Number(r.waiting)) }] } : null,
    notes: ['Overtime is the time worked past the shift, as attendance works it out each day, in hours. Pay for it is in Payroll.'],
    masked: false,
  };
}

/** People who came in late in the period: how many days, the average and the longest. */
async function lateReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const records = await peoplePrisma.attendanceRecord.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, date: { gte: f.from, lte: f.to }, lateMinutes: { gt: 0 } }, select: { employeeId: true, lateMinutes: true } });
  const per = new Map<string, { days: number; minutes: number; longest: number }>();
  for (const r of records) {
    const t = per.get(r.employeeId) || per.set(r.employeeId, { days: 0, minutes: 0, longest: 0 }).get(r.employeeId)!;
    t.days += 1; t.minutes += r.lateMinutes; t.longest = Math.max(t.longest, r.lateMinutes);
  }
  const personOf = new Map(d.people.map((p) => [p.id, p]));
  const rows = [...per.entries()].map(([id, t]) => ({ ...who(personOf.get(id)!, d), days: t.days, average: Math.round(t.minutes / t.days), longest: t.longest } as Record<string, Cell>))
    .sort((a, b) => Number(b.days) - Number(a.days) || Number(b.average) - Number(a.average) || String(a.name).localeCompare(String(b.name)));
  const minutes = records.reduce((n, r) => n + r.lateMinutes, 0);
  return {
    from: f.from, to: f.to, by: null,
    columns: [...PERSON_COLUMNS, { key: 'days', label: 'Days late', align: 'right' }, { key: 'average', label: 'Average minutes late', align: 'right' }, { key: 'longest', label: 'Most minutes late', align: 'right' }],
    rows,
    totals: rows.length ? { name: plural(rows.length, 'person', 'people'), days: records.length, average: Math.round(minutes / records.length), longest: Math.max(...records.map((r) => r.lateMinutes)) } : null,
    chart: null,
    notes: ['Late is a check-in after the shift’s start and its grace time, as attendance works it out each day.', 'Most late first.'],
    masked: false,
  };
}

/** Approved leave days per kind of leave, counted in the period the leave starts in. */
async function leaveTypesReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const [requests, types] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, status: 'APPROVED', fromDate: { gte: f.from, lte: f.to } }, select: { employeeId: true, leaveTypeId: true, days: true } }),
    peoplePrisma.leaveType.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, isPrivate: true } }),
  ]);
  const typeOf = new Map(types.map((t) => [t.id, t]));
  /* A private kind of leave (types with isPrivate) is one line, "Private leave", for anyone but whole-company HR. */
  const nameOf = (id: string) => {
    const t = typeOf.get(id);
    if (!t) return 'Unknown';
    return t.isPrivate && !ctx.hr ? 'Private leave' : t.name;
  };
  const per = new Map<string, { requests: number; days: number; people: Set<string> }>();
  for (const r of requests) {
    const k = nameOf(r.leaveTypeId);
    const t = per.get(k) || per.set(k, { requests: 0, days: 0, people: new Set() }).get(k)!;
    t.requests += 1; t.days += r.days; t.people.add(r.employeeId);
  }
  const rows = [...per.entries()].map(([type, t]) => ({ type, days: round1(t.days), requests: t.requests, people: t.people.size, average: round1(t.days / t.people.size) } as Record<string, Cell>))
    .sort((a, b) => Number(b.days) - Number(a.days) || String(a.type).localeCompare(String(b.type)));
  const days = requests.reduce((n, r) => n + r.days, 0);
  const shown = rows.slice(0, 12);
  return {
    from: f.from, to: f.to, by: null,
    columns: [{ key: 'type', label: 'Leave type' }, { key: 'days', label: 'Days taken', align: 'right' }, { key: 'requests', label: 'Requests', align: 'right' }, { key: 'people', label: 'People', align: 'right' }, { key: 'average', label: 'Days per person', align: 'right' }],
    rows,
    totals: rows.length ? { type: 'All leave', days: round1(days), requests: requests.length, people: new Set(requests.map((r) => r.employeeId)).size, average: null } : null,
    chart: rows.length ? { kind: 'grouped', categories: shown.map((r) => String(r.type)), series: [{ label: 'Days taken', values: shown.map((r) => Number(r.days)) }] } : null,
    notes: ['Approved leave only, counted in the month it starts.', ...(ctx.hr ? [] : ['Kinds of leave the company keeps private read as one line, “Private leave”.'])],
    masked: false,
  };
}

/** Approved leave in the coming weeks, one line a person a spell, under the week it starts in. */
async function offSoonReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const [requests, types] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, status: 'APPROVED', fromDate: { lte: f.to }, toDate: { gte: f.from } }, select: { employeeId: true, leaveTypeId: true, fromDate: true, toDate: true, days: true }, orderBy: [{ fromDate: 'asc' }, { id: 'asc' }] }),
    peoplePrisma.leaveType.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, isPrivate: true } }),
  ]);
  const typeOf = new Map(types.map((t) => [t.id, t]));
  const personOf = new Map(d.people.filter((p) => p.status !== 'LEFT').map((p) => [p.id, p]));
  const kept = requests.filter((r) => personOf.has(r.employeeId));
  const weeks: string[] = [];
  for (let w = weekOf(f.from); w <= f.to; w = addDays(w, 7)) weeks.push(w);
  const weekWord = (w: string) => `Week of ${SHORT_DAY(w)}`;
  const rows = kept.map((r) => {
    const t = typeOf.get(r.leaveTypeId);
    const starts = r.fromDate < f.from ? f.from : r.fromDate;
    return { week: weekWord(weekOf(starts)), ...who(personOf.get(r.employeeId)!, d), from: r.fromDate, to: r.toDate, days: r.days, type: !t ? 'Leave' : t.isPrivate && !ctx.hr ? 'Away' : t.name } as Record<string, Cell>;
  });
  const people = (w: string) => new Set(kept.filter((r) => r.fromDate <= addDays(w, 6) && r.toDate >= w).map((r) => r.employeeId)).size;
  return {
    from: f.from, to: f.to, by: null,
    columns: [{ key: 'week', label: 'Week' }, ...PERSON_COLUMNS, { key: 'from', label: 'From', kind: 'date' }, { key: 'to', label: 'To', kind: 'date' }, { key: 'days', label: 'Days', align: 'right' }, { key: 'type', label: 'Leave type' }],
    rows,
    totals: rows.length ? { week: plural(new Set(kept.map((r) => r.employeeId)).size, 'person', 'people'), name: plural(rows.length, 'spell of leave', 'spells of leave') } : null,
    chart: rows.length ? { kind: 'grouped', categories: weeks.map((w) => SHORT_DAY(w)), series: [{ label: 'People off', values: weeks.map(people) }] } : null,
    notes: ['Approved leave only; requests still waiting are not shown. A spell is listed under the week it starts in; the chart counts everyone off at some point in each week.', ...(ctx.hr ? [] : ['Kinds of leave the company keeps private read “Away”.'])],
    masked: false,
  };
}

/** Planned against present for each shift on one day. */
async function shiftsReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const day = f.to;
  const working = d.people.filter((p) => d.stints.some((s) => s.employeeId === p.id && workingOn(s, day)));
  const ids = working.map((p) => p.id);
  const [schedule, holidays, leave, records] = await Promise.all([
    loadSchedule(ctx.orgId, ids, { from: day, to: day }),
    peoplePrisma.holiday.findMany({ where: { orgId: ctx.orgId, date: day, isOptional: false }, select: { branchId: true } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId: ctx.orgId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day }, halfDay: null, fromTime: null }, select: { employeeId: true } }),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: ctx.orgId, employeeId: { in: ids }, date: day }, select: { employeeId: true, checkIn: true, status: true } }),
  ]);
  const holidayFor = (p: Person) => holidays.some((h) => !h.branchId || h.branchId === p.branchId);
  const onLeave = new Set(leave.map((l) => l.employeeId));
  const inToday = new Set(records.filter((r) => r.checkIn || r.status === 'PRESENT' || r.status === 'HALF_DAY').map((r) => r.employeeId));
  const per = new Map<string, { planned: number; leave: number; present: number }>();
  for (const p of working) {
    if (holidayFor(p)) continue;
    const shift = resolveShift(schedule, p.id, day);
    if (isWeeklyOff(shift.rule, day)) continue;
    const t = per.get(shift.name) || per.set(shift.name, { planned: 0, leave: 0, present: 0 }).get(shift.name)!;
    if (onLeave.has(p.id)) { t.leave += 1; continue; }
    t.planned += 1;
    if (inToday.has(p.id)) t.present += 1;
  }
  const line = (shift: string, t: { planned: number; leave: number; present: number }) => ({ shift, planned: t.planned, leave: t.leave, present: t.present, missing: t.planned - t.present, share: t.planned ? round1((t.present / t.planned) * 100) : null } as Record<string, Cell>);
  const rows = [...per.entries()].map(([k, t]) => line(k, t)).sort((a, b) => Number(b.planned) - Number(a.planned) || String(a.shift).localeCompare(String(b.shift)));
  const all = [...per.values()].reduce((a, t) => ({ planned: a.planned + t.planned, leave: a.leave + t.leave, present: a.present + t.present }), { planned: 0, leave: 0, present: 0 });
  const shown = rows.slice(0, 12);
  return {
    from: null, to: day, by: null,
    columns: [{ key: 'shift', label: 'Shift' }, { key: 'planned', label: 'Due in', align: 'right' }, { key: 'present', label: 'Present', align: 'right' }, { key: 'missing', label: 'Not in', align: 'right' }, { key: 'leave', label: 'On leave', align: 'right' }, { key: 'share', label: 'Present share', align: 'right', kind: 'pct' }],
    rows,
    totals: rows.length ? line('Every shift', all) : null,
    chart: rows.length ? { kind: 'grouped', categories: shown.map((r) => String(r.shift)), series: [{ label: 'Due in', values: shown.map((r) => Number(r.planned)) }, { label: 'Present', values: shown.map((r) => Number(r.present)) }] } : null,
    notes: ['Due in: everyone whose shift works that day, less people on approved full-day leave. A weekly off or a holiday is not counted.', 'Present: checked in, or marked present or half day.'],
    masked: false,
  };
}

/** Sick leave that touches a weekly off or a holiday: per person, how many spells and how many sit next to one. */
async function sickSpellsReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const types = await peoplePrisma.leaveType.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, code: true, isPrivate: true } });
  /* Sick leave by its name or code; a kind the company keeps private stays out for anyone but whole-company HR. */
  const sick = types.filter((t) => (/sick/i.test(t.name) || /^(SL|SICK)$/i.test(t.code || '')) && (ctx.hr || !t.isPrivate)).map((t) => t.id);
  const months = monthsBetween(f.from, f.to);
  const empty: Body = { from: f.from, to: f.to, by: null, columns: [...PERSON_COLUMNS], rows: [], totals: null, chart: null, notes: ['No kind of leave is named “sick”, so there is nothing to show.'], masked: false };
  if (!sick.length) return empty;
  const requests = await peoplePrisma.leaveRequest.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, leaveTypeId: { in: sick }, status: 'APPROVED', fromDate: { gte: f.from, lte: f.to } }, select: { employeeId: true, fromDate: true, toDate: true, days: true } });
  const first = addDays(requests.reduce((m, r) => (r.fromDate < m ? r.fromDate : m), f.from), -1);
  const last = addDays(requests.reduce((m, r) => (r.toDate > m ? r.toDate : m), f.to), 1);
  const [schedule, holidays] = requests.length ? await Promise.all([
    loadSchedule(ctx.orgId, [...new Set(requests.map((r) => r.employeeId))], { from: first, to: last }),
    peoplePrisma.holiday.findMany({ where: { orgId: ctx.orgId, date: { gte: first, lte: last }, isOptional: false }, select: { date: true, branchId: true } }),
  ]) : [null, []];
  const personOf = new Map(d.people.map((p) => [p.id, p]));
  const restDay = (p: Person, day: string) => holidays.some((h) => h.date === day && (!h.branchId || h.branchId === p.branchId)) || isWeeklyOff(resolveShift(schedule!, p.id, day).rule, day);
  const per = new Map<string, { spells: number; days: number; next: number }>();
  const nextDays: string[] = [];
  const otherDays: string[] = [];
  for (const r of requests) {
    const p = personOf.get(r.employeeId)!;
    const next = restDay(p, addDays(r.fromDate, -1)) || restDay(p, addDays(r.toDate, 1));
    const t = per.get(p.id) || per.set(p.id, { spells: 0, days: 0, next: 0 }).get(p.id)!;
    t.spells += 1; t.days += r.days;
    if (next) { t.next += 1; nextDays.push(r.fromDate); } else otherDays.push(r.fromDate);
  }
  const rows = [...per.entries()].map(([id, t]) => ({ ...who(personOf.get(id)!, d), spells: t.spells, days: round1(t.days), next: t.next, share: round1((t.next / t.spells) * 100) } as Record<string, Cell>))
    .sort((a, b) => Number(b.next) - Number(a.next) || Number(b.spells) - Number(a.spells) || String(a.name).localeCompare(String(b.name)));
  return {
    from: f.from, to: f.to, by: null,
    columns: [...PERSON_COLUMNS, { key: 'spells', label: 'Sick spells', align: 'right' }, { key: 'days', label: 'Sick days', align: 'right' }, { key: 'next', label: 'Next to a weekend or holiday', align: 'right' }, { key: 'share', label: 'Share next to one', align: 'right', kind: 'pct' }],
    rows,
    totals: rows.length ? { name: plural(rows.length, 'person', 'people'), spells: requests.length, days: round1(requests.reduce((n, r) => n + r.days, 0)), next: nextDays.length, share: round1((nextDays.length / requests.length) * 100) } : null,
    chart: rows.length ? { kind: 'stacked', categories: months.map(monthWord), series: [{ label: 'Next to a weekend or holiday', values: months.map((m) => nextDays.filter((x) => monthOf(x) === m).length) }, { label: 'Other sick spells', values: months.map((m) => otherDays.filter((x) => monthOf(x) === m).length) }] } : null,
    notes: ['A spell is one approved sick leave request. It is next to a weekend or holiday when the day before it starts or the day after it ends is the person’s weekly off or a holiday.', 'A pattern to talk about, not proof of anything.'],
    masked: false,
  };
}

/** One line a branch: headcount, leavers, attrition and absence, and pay cost for a reader with the salary slip right. */
async function branchesReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const months = monthsBetween(f.from, f.to);
  const branchOf = new Map(d.people.map((p) => [p.id, p.branchId || '']));
  const [records, slips] = await Promise.all([
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, date: { gte: f.from, lte: f.to }, status: { in: WORK_DAYS } }, select: { employeeId: true, status: true } }),
    ctx.payCost ? payrollPrisma.salarySlip.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, payrollDate: { gte: f.from, lte: f.to }, status: { in: ['APPROVED', 'LOCKED', 'PAID'] } }, select: { employeeId: true, employerCost: true } }) : Promise.resolve([]),
  ]);
  type Tally = { stints: Stint[]; working: number; lost: number; pay: number };
  const per = new Map<string, Tally>();
  const tally = (k: string) => per.get(k) || per.set(k, { stints: [], working: 0, lost: 0, pay: 0 }).get(k)!;
  for (const s of d.stints) tally(branchOf.get(s.employeeId) || '').stints.push(s);
  for (const r of records) {
    const t = tally(branchOf.get(r.employeeId) || '');
    t.working += 1;
    t.lost += r.status === 'ABSENT' || r.status === 'ON_LEAVE' ? 1 : r.status === 'HALF_DAY' ? 0.5 : 0;
  }
  for (const s of slips) tally(branchOf.get(s.employeeId) || '').pay += Number(s.employerCost);
  const line = (branch: string, t: Tally) => {
    const movement = months.map((m) => monthMovement(t.stints, m, f.to));
    const leavers = movement.reduce((n, x) => n + x.leavers, 0);
    const average = movement.reduce((n, x) => n + x.average, 0) / movement.length;
    const row: Record<string, Cell> = { branch, headcount: movement[movement.length - 1].close, leavers, attrition: rate(leavers, average), absence: t.working ? round1((t.lost / t.working) * 100) : null };
    if (ctx.payCost) row.pay = Math.round(t.pay);
    return row;
  };
  const rows = [...per.entries()].map(([k, t]) => line(d.label('branch', k || null), t))
    .filter((r) => r.headcount || r.leavers)
    .sort((a, b) => Number(b.headcount) - Number(a.headcount) || String(a.branch).localeCompare(String(b.branch)));
  const everyone: Tally = { stints: d.stints, working: records.length, lost: [...per.values()].reduce((n, t) => n + t.lost, 0), pay: [...per.values()].reduce((n, t) => n + t.pay, 0) };
  const shown = rows.slice(0, 12);
  return {
    from: f.from, to: f.to, by: 'branch',
    columns: [{ key: 'branch', label: 'Branch' }, { key: 'headcount', label: 'Headcount', align: 'right' }, { key: 'leavers', label: 'Leavers', align: 'right' }, { key: 'attrition', label: 'Attrition', align: 'right', kind: 'pct' }, { key: 'absence', label: 'Absence rate', align: 'right', kind: 'pct' }, ...(ctx.payCost ? [{ key: 'pay', label: 'Pay cost', align: 'right' as const, kind: 'money' as const }] : [])],
    rows,
    totals: rows.length ? { ...line('Everyone', everyone), branch: 'Everyone' } : null,
    chart: rows.length ? { kind: 'grouped', categories: shown.map((r) => String(r.branch)), series: [{ label: 'Headcount', values: shown.map((r) => Number(r.headcount)) }] } : null,
    notes: [
      'Headcount on the last day of the period. Attrition is leavers over the average headcount of the months. Absence rate is days lost over working days, from attendance records.',
      ctx.payCost ? 'Pay cost: what the company paid out on approved and paid salary slips dated in the period, its own contributions included.' : 'Pay cost shows only for people who may read salary slips in Payroll.',
      NOW_NOTE('branch'),
    ],
    masked: false,
  };
}

/** Probation outcomes month by month: confirmed, extended, let go. */
async function probationOutcomesReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const months = monthsBetween(f.from, f.to);
  const ids = idsOf(d);
  const reviews = await peoplePrisma.probationReview.findMany({ where: { orgId: ctx.orgId, employeeId: { in: ids }, outcome: { in: ['EXTEND', 'END'] }, decidedAt: { not: null } }, select: { employeeId: true, outcome: true, decidedAt: true } });
  const inPeriod = (day: string | null) => Boolean(day) && day! >= f.from && day! <= f.to;
  const confirmed = d.people.filter((p) => inPeriod(p.confirmedOn)).map((p) => p.confirmedOn!);
  const extended = reviews.filter((r) => r.outcome === 'EXTEND' && inPeriod(istDay(r.decidedAt!))).map((r) => istDay(r.decidedAt!));
  /* Let go: a probation review that ended the employment, or a dismissal before anyone confirmed the person. */
  const letGo = new Map<string, string>();
  for (const r of reviews) if (r.outcome === 'END' && inPeriod(istDay(r.decidedAt!))) letGo.set(r.employeeId, istDay(r.decidedAt!));
  const leavers = await peoplePrisma.employee.findMany({ where: { orgId: ctx.orgId, id: { in: ids }, status: 'LEFT', leavingType: 'TERMINATED', confirmedOn: null, probationEndDate: { not: null }, dateOfLeaving: { gte: f.from, lte: f.to } }, select: { id: true, dateOfLeaving: true } });
  for (const l of leavers) if (!letGo.has(l.id)) letGo.set(l.id, String(l.dateOfLeaving).slice(0, 10));
  const count = (days: string[], m: string) => days.filter((x) => monthOf(x) === m).length;
  const gone = [...letGo.values()];
  const rows = months.map((m) => ({ month: monthWord(m), confirmed: count(confirmed, m), extended: count(extended, m), letGo: count(gone, m) } as Record<string, Cell>));
  const any = confirmed.length + extended.length + gone.length;
  return {
    from: f.from, to: f.to, by: null,
    columns: [{ key: 'month', label: 'Month' }, { key: 'confirmed', label: 'Confirmed', align: 'right' }, { key: 'extended', label: 'Extended', align: 'right' }, { key: 'letGo', label: 'Let go', align: 'right' }],
    rows: any ? rows : [],
    totals: any ? { month: 'Whole period', confirmed: confirmed.length, extended: extended.length, letGo: gone.length } : null,
    chart: any ? { kind: 'stacked', categories: months.map(monthWord), series: [{ label: 'Confirmed', values: rows.map((r) => Number(r.confirmed)) }, { label: 'Extended', values: rows.map((r) => Number(r.extended)) }, { label: 'Let go', values: rows.map((r) => Number(r.letGo)) }] } : null,
    notes: ['Confirmed: the confirmation date on file. Extended: a probation review decided as an extension. Let go: a review that ended the employment, or a dismissal of someone never confirmed.', 'An end date moved by hand on the profile, without a review, is not counted as an extension.'],
    masked: false,
  };
}

const COULD_KEEP_WORD: Record<string, string> = { YES: 'Yes', MAYBE: 'Maybe', NO: 'No' };

/** Each leaver's main reason from the exit interview, one line each, and the reasons counted in the chart. */
async function exitReasonsReport(ctx: ReportCtx, f: Filters, d: Loaded): Promise<Body> {
  const [rows0, settings] = await Promise.all([
    peoplePrisma.exitInterview.findMany({ where: { orgId: ctx.orgId, employeeId: { in: idsOf(d) }, leavingDate: { gte: f.from, lte: f.to }, status: 'SUBMITTED', reason: { not: null }, withdrawnAt: null }, select: { employeeId: true, leavingDate: true, reason: true, couldKeep: true, outcome: true }, orderBy: [{ leavingDate: 'asc' }, { id: 'asc' }] }),
    exitSettings(ctx.orgId),
  ]);
  const labels = new Map<string, string>(DEFAULT_REASONS.map((o) => [o.code, o.label]));
  for (const q of settings.questions) if (q.kind === 'REASON') for (const o of q.options || []) labels.set(o.code, o.label);
  /* Someone who stayed did not leave: their answer is no reason for leaving (exitInterview.ts leavingReasons). */
  const kept = rows0.filter((r) => r.outcome !== 'RETAINED');
  const personOf = new Map(d.people.map((p) => [p.id, p]));
  const rows = kept.map((r) => ({ ...who(personOf.get(r.employeeId)!, d), left: r.leavingDate, reason: labels.get(r.reason!) || r.reason, couldKeep: r.couldKeep ? COULD_KEEP_WORD[r.couldKeep] || r.couldKeep : null } as Record<string, Cell>));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(String(r.reason), (counts.get(String(r.reason)) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    from: f.from, to: f.to, by: null,
    columns: [...PERSON_COLUMNS, { key: 'left', label: 'Last day', kind: 'date' }, { key: 'reason', label: 'Main reason' }, { key: 'couldKeep', label: 'Could have been kept' }],
    rows,
    totals: rows.length ? { name: plural(rows.length, 'answer', 'answers'), reason: ranked.slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ') } : null,
    chart: rows.length ? { kind: 'grouped', categories: ranked.slice(0, 12).map(([k]) => k), series: [{ label: 'Leavers', values: ranked.slice(0, 12).map(([, n]) => n) }] } : null,
    notes: ['Submitted exit interviews of people whose last day falls in the period. A leaving withdrawn, or someone kept on, is left out.'],
    masked: false,
  };
}

/** One report, for this reader, with these filters. */
export async function runReport(ctx: ReportCtx, id: string, query: ReportQuery, today: string = todayIst()): Promise<ReportResult> {
  const spec = HR_REPORTS.find((r) => r.id === id);
  if (!spec) throw new ReportError('No such report.', 404);
  const f = filtersOf(spec.id, query, today);
  const d = await load(ctx, f);
  const body = await (async () => {
    switch (spec.id) {
      case 'headcount': return headcountReport(f, d);
      case 'movement': return movementReport(f, d);
      case 'tenure': return bandReport(f, d, ctx, {
        bands: TENURE_BANDS, sensitive: false, averageLabel: 'Average (years)',
        measure: (_p, s) => yearsBetween(s.startDate, f.to),
        bandOf: (_p, s) => bandFor(TENURE_BANDS, yearsBetween(s.startDate, f.to) ?? 0),
        notes: ['Service is counted from the start of the person’s current stint to the day chosen.'],
      });
      case 'age': return bandReport(f, d, ctx, {
        bands: AGE_BANDS, sensitive: true, averageLabel: 'Average age',
        measure: (p) => (p.dateOfBirth ? yearsBetween(p.dateOfBirth, f.to) : null),
        bandOf: (p) => bandFor(AGE_BANDS, p.dateOfBirth ? yearsBetween(p.dateOfBirth, f.to) : null),
        notes: ['Age on the day chosen, from the date of birth on file.'],
      });
      case 'gender': return bandReport(f, d, ctx, {
        bands: GENDERS, sensitive: true,
        bandOf: (p) => GENDER_BAND[p.gender || ''] || 'unknown',
        notes: ['As recorded on each person’s profile.'],
      });
      case 'probation': return probationReport(f, d, today);
      case 'contracts': return contractsReport(f, d, today);
      case 'documents': return documentsReport(ctx, f, d, today);
      case 'absence': return absenceReport(ctx, f, d);
      case 'overtime': return overtimeReport(ctx, f, d);
      case 'late': return lateReport(ctx, f, d);
      case 'leavetypes': return leaveTypesReport(ctx, f, d);
      case 'offsoon': return offSoonReport(ctx, f, d);
      case 'shifts': return shiftsReport(ctx, f, d);
      case 'sickspells': return sickSpellsReport(ctx, f, d);
      case 'branches': return branchesReport(ctx, f, d);
      case 'probationoutcomes': return probationOutcomesReport(ctx, f, d);
      default: return exitReasonsReport(ctx, f, d);
    }
  })();
  return { id: spec.id, title: spec.name, ...body };
}

/** A cell a spreadsheet would run as a formula is quoted; a plain number is left as it is. */
const PLAIN_NUMBER = /^[+-]?\d[\d\s().-]*$/;
const csvCell = (v: Cell) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The report as CSV: the same columns and rows as the screen, then its totals line. Opens in Excel (UTF-8 with a mark). */
export function reportCsv(r: ReportResult): string {
  const cell = (row: Record<string, Cell>, c: ReportColumn) => (c.kind === 'pct' && typeof row[c.key] === 'number' ? `${row[c.key]}%` : row[c.key] ?? '');
  const lines = [r.columns.map((c) => c.label), ...r.rows.map((row) => r.columns.map((c) => cell(row, c))), ...(r.totals ? [r.columns.map((c) => cell(r.totals!, c))] : [])];
  return `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`;
}

/** The lists the filters choose from: only what the reader's people are actually in. */
export async function reportFilters(ctx: ReportCtx) {
  const d = await load(ctx, { from: '', to: '', by: 'department', departmentId: null, branchId: null, employeeTypeId: null, gradeId: null });
  const options = (by: Grouping) => {
    const ids = [...new Set(d.people.map((p) => p[BY_FIELD[by]]).filter(Boolean))] as string[];
    return ids.map((id) => ({ id, name: d.label(by, id) })).sort((a, b) => a.name.localeCompare(b.name));
  };
  return { departments: options('department'), branches: options('branch'), employeeTypes: options('employmentType'), grades: options('grade') };
}
