import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { addDays, addMonths, todayIst } from '../../utils/istDate.js';
import { scopeWhere, type TeamScope } from './scope.js';
import { docWhere, type DocAccess } from './documentAccess.js';

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
};
export type Cell = string | number | null;
export type ReportColumn = { key: string; label: string; align?: 'right'; kind?: 'date' | 'pct' };
export type ReportChart = { kind: 'stacked' | 'grouped'; categories: string[]; series: Array<{ label: string; values: number[]; other?: boolean }> } | null;
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
] as const;
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
    from = `${monthOf(from || addMonths(`${monthOf(to)}-01`, -11))}-01`;
    if (from > to) throw new ReportError('The period starts after it ends.');
    if (monthsBetween(from, to).length > MAX_MONTHS) throw new ReportError(`A report covers at most ${MAX_MONTHS} months.`);
  } else if (spec.dates === 'day') {
    to ||= today;
    from = to;
  } else {
    /* Looking ahead: what is due in the next 90 days, and what was missed in the last year. */
    to ||= addDays(today, 90);
    from ||= id === 'contracts' ? today : addDays(today, -365);
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
      default: return documentsReport(ctx, f, d, today);
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
