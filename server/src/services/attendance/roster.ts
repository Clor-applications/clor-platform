import { randomUUID } from 'node:crypto';

import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { addDays, eachDay } from '../../utils/istDate.js';
import { isFeatureEnabled } from '../features.js';
import { sendNotice } from '../notifications.js';
import { assertNightConsent } from '../people/nightConsent.js';
import { isWeeklyOff } from './compute.js';
import { loadHolidays, loadSchedule, resolveShift, type ResolvedShift, type RosterMark, type ScheduleData } from './schedule.js';
import { scheduleGuard } from './scheduleGuard.js';

/**
 * The roster planner: who works which shift on which day, set by hand over a
 * week or a month (platform audit, 11 Nov 2026).
 *
 * A change is a draft first. A draft is a row nobody reads but this file, so
 * it cannot move a day's attendance; publishing turns it into the published
 * roster day the one resolver reads (schedule.ts, step 2) and tells each
 * person whose days changed, once. Every write is one transaction, checked
 * here: the shift is the company's and switched on, the person is employed on
 * the day, the day is not in a closed Attendance month (scheduleGuard, as
 * every other schedule write), and a temporary schedule on the day is left
 * alone because it would win anyway.
 */

export class RosterError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Who = { accountId: string; orgId: string; userId: string };
export type DraftKind = 'SHIFT' | 'OFF' | 'CLEAR';
type Mark = { kind: DraftKind; shiftId: string | null };
type Cell = Mark & { employeeId: string; date: string };
export type Skipped = { employeeId: string; date: string; reason: 'NOT_EMPLOYED' | 'TEMPORARY' | 'NO_SHIFT' };

/** The longest stretch one view or one write covers: six weeks shows any month whole. */
export const MAX_DAYS = 42;
/** The most cells one write may name: 1,000 people over a month. */
export const MAX_CELLS = 31_000;

const key = (employeeId: string, date: string) => `${employeeId}|${date}`;
const employedOn = (p: { dateOfJoining: string | null; dateOfLeaving: string | null }, d: string) => !(p.dateOfJoining && d < p.dateOfJoining) && !(p.dateOfLeaving && d > p.dateOfLeaving);

/** The schedule as it would be with one roster mark on one day (null: with no roster day there). */
function withMark(data: ScheduleData, employeeId: string, date: string, mark: Mark | null): ScheduleData {
  const own = new Map(data.roster?.get(employeeId) || []);
  if (!mark || mark.kind === 'CLEAR') own.delete(date);
  else own.set(date, mark as RosterMark);
  return { ...data, roster: new Map(data.roster || []).set(employeeId, own) };
}

/** A day as the roster sees it: the shift, and whether it is worked. */
const stateOf = (r: ResolvedShift, date: string) => ({ shiftId: r.shiftId, off: isWeeklyOff(r.rule, date) });
const sameState = (a: { shiftId: string | null; off: boolean }, b: { shiftId: string | null; off: boolean }) => a.off === b.off && (a.off || a.shiftId === b.shiftId);

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export type RosterQuery = { from: string; to: string; departmentId?: string; branchId?: string; areaId?: string; shiftId?: string; q?: string; page?: number; pageSize?: number };

/**
 * The roster for some days: each person's day as planned (the published
 * schedule with the draft laid over it), the head-count on each shift each
 * day, and where a shift is short of its minimum. People are paged; the
 * head-count is of everyone the filters match, and a shortfall is judged on
 * the whole company, since a shift's minimum is the company's.
 */
export async function rosterView(who: { accountId: string; orgId: string }, query: RosterQuery) {
  const { accountId, orgId } = who;
  const days = eachDay(query.from, query.to);
  if (!days.length || days.length > MAX_DAYS) throw new RosterError(`Choose up to ${MAX_DAYS} days.`);
  const first = days[0];
  const last = days[days.length - 1];
  const [people, schedule, holidays, leaveDays, drafts, shifts, guard, draftTotals] = await Promise.all([
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, attendanceRequired: true, AND: [{ OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: first } }] }, { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: last } }] }] },
      select: { id: true, name: true, code: true, department: true, departmentId: true, areaId: true, branchId: true, dateOfJoining: true, dateOfLeaving: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    loadSchedule(orgId),
    loadHolidays(orgId, first, last),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId, date: { gte: first, lte: last }, status: 'ON_LEAVE' }, select: { employeeId: true, date: true } }),
    peoplePrisma.rosterDay.findMany({ where: { orgId, state: 'DRAFT', date: { gte: first, lte: last } }, select: { employeeId: true, date: true, kind: true, shiftId: true } }),
    peoplePrisma.shift.findMany({ where: { accountId, orgId, isActive: true }, select: { id: true, name: true, code: true, startTime: true, endTime: true, minStaff: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    scheduleGuard(orgId),
    draftSummary(orgId),
  ]);
  const onLeave = new Set(leaveDays.map((l) => key(l.employeeId, l.date)));
  const draftOf = new Map(drafts.map((d) => [key(d.employeeId, d.date), { kind: d.kind as DraftKind, shiftId: d.shiftId }]));

  const q = String(query.q || '').trim().toLowerCase();
  const matches = (p: (typeof people)[number]) =>
    (!query.departmentId || p.departmentId === query.departmentId) &&
    (!query.branchId || p.branchId === query.branchId) &&
    (!query.areaId || p.areaId === query.areaId) &&
    (!q || `${p.name} ${p.code || ''}`.toLowerCase().includes(q));

  /* Everyone's days once: the listed people are drawn from them, and the company's head-count needs them all. */
  const company = days.map(() => new Map<string, number>());
  const listed = days.map(() => new Map<string, number>());
  const rows: Array<{ employeeId: string; name: string; code: string | null; department: string | null; cells: any[] }> = [];
  for (const p of people) {
    const mine = holidays.forArea(p.areaId, p.branchId);
    const cells = days.map((d) => {
      if (!employedOn(p, d)) return { date: d, kind: 'OUT' };
      const now = resolveShift(schedule, p.id, d);
      const draft = now.source === 'TEMPORARY' ? undefined : draftOf.get(key(p.id, d));
      const r = draft ? resolveShift(withMark(schedule, p.id, d, draft), p.id, d) : now;
      const kind = onLeave.has(key(p.id, d)) ? 'LEAVE' : mine.has(d) ? 'HOLIDAY' : isWeeklyOff(r.rule, d) ? 'OFF' : 'WORK';
      return { date: d, kind, shiftId: r.shiftId, code: r.code, name: r.name, source: draft ? 'ROSTER' : r.source, ...(draft ? { draft: draft.kind } : {}) };
    });
    const show = matches(p) && (!query.shiftId || cells.some((c: any) => c.kind === 'WORK' && c.shiftId === query.shiftId));
    cells.forEach((c: any, i) => {
      if (c.kind !== 'WORK') return;
      const k = c.shiftId || '';
      company[i].set(k, (company[i].get(k) || 0) + 1);
      if (show) listed[i].set(k, (listed[i].get(k) || 0) + 1);
    });
    if (show) rows.push({ employeeId: p.id, name: p.name, code: p.code, department: p.department, cells });
  }

  const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize)) || 50, 1), 200);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(Math.trunc(Number(query.page)) || 1, 1), pages);
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  return {
    from: first,
    to: last,
    days,
    total: rows.length,
    page,
    pageSize,
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    /* Everyone the filters match, every page: what "copy this week" works on. */
    employeeIds: rows.map((r) => r.employeeId),
    shifts,
    /* Per day: people working each shift ('' = the standard day, no shift), among those listed and in the whole company; and how far each shift with a minimum falls short. */
    coverage: days.map((d, i) => ({
      date: d,
      counts: Object.fromEntries(listed[i]),
      company: Object.fromEntries(company[i]),
      short: Object.fromEntries(shifts.filter((s) => s.minStaff && (company[i].get(s.id) || 0) < s.minStaff).map((s) => [s.id, s.minStaff! - (company[i].get(s.id) || 0)])),
    })),
    holidays: holidays.rows.map((h) => ({ date: h.date, name: h.name })),
    /* Months in view whose days are final: their cells cannot be changed. */
    closedMonths: months.filter((m) => guard.closedIn([{ from: `${m}-01`, to: `${m}-01` }]).includes(m)),
    draft: draftTotals,
  };
}

/** How much is waiting to be published, in the whole company. */
export async function draftSummary(orgId: string) {
  const [count, people, span] = await Promise.all([
    peoplePrisma.rosterDay.count({ where: { orgId, state: 'DRAFT' } }),
    peoplePrisma.rosterDay.findMany({ where: { orgId, state: 'DRAFT' }, select: { employeeId: true }, distinct: ['employeeId'] }),
    peoplePrisma.rosterDay.aggregate({ where: { orgId, state: 'DRAFT' }, _min: { date: true }, _max: { date: true } }),
  ]);
  return { days: count, people: people.length, from: span._min.date || null, to: span._max.date || null };
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

const validDates = (dates: string[]) => {
  const out = [...new Set(dates)].sort();
  if (!out.length) throw new RosterError('Choose the days.');
  if (out.length > MAX_DAYS * 3) throw new RosterError('That is too many days for one change.');
  return out;
};

/**
 * Lay these marks on the draft, in the transaction the caller opened. A day
 * the person is not employed on, or that a temporary schedule covers, is
 * skipped and reported; a mark that says what the day already is takes its
 * draft away instead of adding one, so only real changes wait to be published.
 */
async function writeDraft(who: Who, cells: Cell[]) {
  const { accountId, orgId, userId } = who;
  if (cells.length > MAX_CELLS) throw new RosterError('That is too many days for one change. Choose fewer people or days.');
  const employeeIds = [...new Set(cells.map((c) => c.employeeId))];
  const dates = [...new Set(cells.map((c) => c.date))].sort();
  const shiftIds = [...new Set(cells.filter((c) => c.kind === 'SHIFT').map((c) => String(c.shiftId || '')))];

  const [people, shifts, guard] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { accountId, orgId, id: { in: employeeIds } }, select: { id: true, dateOfJoining: true, dateOfLeaving: true } }),
    shiftIds.length ? peoplePrisma.shift.findMany({ where: { accountId, orgId, id: { in: shiftIds } }, select: { id: true, name: true, isActive: true } }) : [],
    scheduleGuard(orgId),
  ]);
  if (people.length !== employeeIds.length) throw new RosterError('Someone chosen is not in this organisation.');
  for (const id of shiftIds) {
    const s = shifts.find((x) => x.id === id);
    if (!s) throw new RosterError('That shift is not in this organisation.');
    if (!s.isActive) throw new RosterError(`${s.name} is switched off. Switch it on in Shifts, or choose another shift.`);
  }
  /* A closed month's days are final (closure audit O-05): the whole change is refused, as any schedule change is. */
  guard.assertOpen(dates.map((d) => ({ from: d, to: d })));
  /* A woman on a shift into the night needs her consent on file (OSH Code s.43; people/nightConsent.ts). */
  const onShift = new Map<string, Set<string>>();
  for (const c of cells) if (c.kind === 'SHIFT') (onShift.get(c.employeeId) || onShift.set(c.employeeId, new Set()).get(c.employeeId)!).add(String(c.shiftId));
  if (onShift.size) await assertNightConsent(orgId, [...onShift].map(([employeeId, ids]) => ({ employeeId, shiftIds: [...ids] })));

  const schedule = await loadSchedule(orgId, employeeIds);
  const byId = new Map(people.map((p) => [p.id, p]));
  const skipped: Skipped[] = [];
  const add: Cell[] = [];
  let unchanged = 0;
  for (const c of cells) {
    if (!employedOn(byId.get(c.employeeId)!, c.date)) {
      skipped.push({ employeeId: c.employeeId, date: c.date, reason: 'NOT_EMPLOYED' });
      continue;
    }
    const now = resolveShift(schedule, c.employeeId, c.date);
    if (now.source === 'TEMPORARY') {
      skipped.push({ employeeId: c.employeeId, date: c.date, reason: 'TEMPORARY' });
      continue;
    }
    const then = resolveShift(withMark(schedule, c.employeeId, c.date, c), c.employeeId, c.date);
    if (sameState(stateOf(now, c.date), stateOf(then, c.date))) unchanged += 1;
    else add.push(c);
  }
  /* Every day named starts clean: its old draft goes, and a new one is written only where the day really changes. */
  await peoplePrisma.rosterDay.deleteMany({ where: { orgId, state: 'DRAFT', employeeId: { in: employeeIds }, date: { in: dates }, ...(cells.length === employeeIds.length * dates.length ? {} : { OR: byPerson(cells) }) } });
  if (add.length) {
    await peoplePrisma.rosterDay.createMany({
      data: add.map((c) => ({ accountId, orgId, employeeId: c.employeeId, date: c.date, state: 'DRAFT', kind: c.kind, shiftId: c.kind === 'SHIFT' ? c.shiftId : null, createdByUserId: userId })),
    });
  }
  return { changed: add.length, unchanged, skipped: skipped.slice(0, 200), skippedCount: skipped.length };
}

/** Cells as one condition a person: { employeeId, date in […] }. */
const byPerson = (cells: Array<{ employeeId: string; date: string }>) => {
  const m = new Map<string, string[]>();
  for (const c of cells) (m.get(c.employeeId) || m.set(c.employeeId, []).get(c.employeeId)!).push(c.date);
  return [...m].map(([employeeId, dates]) => ({ employeeId, date: { in: dates } }));
};

const SKIP_SAYS: Record<Skipped['reason'], string> = {
  NOT_EMPLOYED: 'Not employed on that day.',
  TEMPORARY: 'A temporary schedule covers that day. Remove it in Temporary schedules to roster the day.',
  NO_SHIFT: 'The week copied has no shift on that day.',
};

/** Nothing could be written: say why, rather than "0 days changed". */
const refuseIfAllSkipped = (r: { changed: number; unchanged: number; skipped: Skipped[]; skippedCount: number }) => {
  if (!r.changed && !r.unchanged && r.skippedCount) throw new RosterError(SKIP_SAYS[r.skipped[0].reason], 400, r.skipped[0].reason);
  return r;
};

/** Set every day of these people on these dates to one thing: a shift, a weekly off, or back to their schedule. */
export async function setDraft(who: Who, body: { employeeIds: string[]; dates: string[]; kind: DraftKind; shiftId?: string | null }) {
  const employeeIds = [...new Set(body.employeeIds)];
  const dates = validDates(body.dates);
  if (!employeeIds.length) throw new RosterError('Choose the people.');
  if (body.kind === 'SHIFT' && !body.shiftId) throw new RosterError('Choose a shift.');
  const mark: Mark = { kind: body.kind, shiftId: body.kind === 'SHIFT' ? String(body.shiftId) : null };
  const cells = employeeIds.flatMap((employeeId) => dates.map((date) => ({ employeeId, date, ...mark })));
  return peopleWrite(who.orgId, async () => ({ ...refuseIfAllSkipped(await writeDraft(who, cells)), draft: await draftSummary(who.orgId) }));
}

/**
 * Copy a week, as planned, onto the weeks that follow it: each person's seven
 * days from `weekStart` become the same weekdays of the next `weeks` weeks.
 * A day worked on the standard day, with no shift, has nothing to copy.
 */
export async function copyWeek(who: Who, body: { employeeIds: string[]; weekStart: string; weeks: number }) {
  const employeeIds = [...new Set(body.employeeIds)];
  if (!employeeIds.length) throw new RosterError('Choose the people.');
  const weeks = Math.trunc(Number(body.weeks));
  if (!(weeks >= 1 && weeks <= 12)) throw new RosterError('Copy onto 1 to 12 weeks.');
  const source = eachDay(body.weekStart, addDays(body.weekStart, 6));
  return peopleWrite(who.orgId, async () => {
    const [schedule, drafts, people] = await Promise.all([
      loadSchedule(who.orgId, employeeIds),
      peoplePrisma.rosterDay.findMany({ where: { orgId: who.orgId, state: 'DRAFT', employeeId: { in: employeeIds }, date: { in: source } }, select: { employeeId: true, date: true, kind: true, shiftId: true } }),
      peoplePrisma.employee.findMany({ where: { accountId: who.accountId, orgId: who.orgId, id: { in: employeeIds } }, select: { id: true, dateOfJoining: true, dateOfLeaving: true } }),
    ]);
    if (people.length !== employeeIds.length) throw new RosterError('Someone chosen is not in this organisation.');
    const draftOf = new Map(drafts.map((d) => [key(d.employeeId, d.date), { kind: d.kind as DraftKind, shiftId: d.shiftId }]));
    const cells: Cell[] = [];
    const noShift: Skipped[] = [];
    for (const p of people) {
      source.forEach((d, i) => {
        if (!employedOn(p, d)) return;
        const draft = draftOf.get(key(p.id, d));
        const planned = stateOf(resolveShift(draft ? withMark(schedule, p.id, d, draft) : schedule, p.id, d), d);
        for (let w = 1; w <= weeks; w += 1) {
          const date = addDays(body.weekStart, i + 7 * w);
          if (planned.off) cells.push({ employeeId: p.id, date, kind: 'OFF', shiftId: null });
          else if (planned.shiftId) cells.push({ employeeId: p.id, date, kind: 'SHIFT', shiftId: planned.shiftId });
          else noShift.push({ employeeId: p.id, date, reason: 'NO_SHIFT' });
        }
      });
    }
    const r = cells.length ? await writeDraft(who, cells) : { changed: 0, unchanged: 0, skipped: [] as Skipped[], skippedCount: 0 };
    const all = { ...r, skipped: [...r.skipped, ...noShift].slice(0, 200), skippedCount: r.skippedCount + noShift.length };
    return { ...refuseIfAllSkipped(all), draft: await draftSummary(who.orgId) };
  });
}

/** Throw the draft away: all of it, or the days from `from` to `to`. */
export async function discardDraft(who: Who, range: { from?: string | null; to?: string | null } = {}) {
  const r = await peoplePrisma.rosterDay.deleteMany({ where: { orgId: who.orgId, state: 'DRAFT', ...dateWhere(range) } });
  return { discarded: r.count, draft: await draftSummary(who.orgId) };
}

const dateWhere = (range: { from?: string | null; to?: string | null }) => (range.from || range.to ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (d: string) => `${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))} ${MONTH[Number(d.slice(5, 7)) - 1]}`;

/** What a person is told about one changed day. */
const dayLine = (date: string, r: ResolvedShift) => `${dayWords(date)}: ${isWeeklyOff(r.rule, date) ? 'weekly off' : `${r.name} ${r.rule.startTime}–${r.rule.endTime}`}`;

/** The notice for one person: how many days changed, then the days (the first twelve). */
export function rosterNotice(lines: Array<{ date: string; line: string }>) {
  const sorted = [...lines].sort((a, b) => (a.date < b.date ? -1 : 1));
  const n = sorted.length;
  const shown = sorted.slice(0, 12).map((l) => l.line);
  return {
    title: n === 1 ? `Your roster changed: ${sorted[0].line}` : `Your roster changed on ${n} days, from ${dayWords(sorted[0].date)}`,
    body: n === 1 ? null : `${shown.join(' · ')}${n > shown.length ? ` · and ${n - shown.length} more` : ''}`,
  };
}

/**
 * Publish the draft (all of it, or the days from `from` to `to`): each draft
 * day becomes the published roster day, in one transaction, and each person
 * whose day really changed is told once, with their days. A draft for someone
 * no longer employed on the day is dropped.
 */
export async function publishRoster(who: Who, range: { from?: string | null; to?: string | null } = {}) {
  const { accountId, orgId, userId } = who;
  const done = await peopleWrite(orgId, async () => {
    const drafts = await peoplePrisma.rosterDay.findMany({ where: { orgId, state: 'DRAFT', ...dateWhere(range) }, orderBy: [{ employeeId: 'asc' }, { date: 'asc' }] });
    if (!drafts.length) throw new RosterError('There is nothing to publish.', 400, 'NOTHING_TO_PUBLISH');
    const employeeIds = [...new Set(drafts.map((d) => d.employeeId))];
    const dates = [...new Set(drafts.map((d) => d.date))].sort();
    const shiftIds = [...new Set(drafts.filter((d) => d.kind === 'SHIFT').map((d) => String(d.shiftId)))];
    /* The month may have closed, a shift been switched off, or someone left since the draft was made. */
    (await scheduleGuard(orgId)).assertOpen(dates.map((d) => ({ from: d, to: d })));
    const [shifts, people] = await Promise.all([
      shiftIds.length ? peoplePrisma.shift.findMany({ where: { orgId, id: { in: shiftIds } }, select: { id: true, name: true, isActive: true } }) : [],
      peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, userId: true, dateOfJoining: true, dateOfLeaving: true } }),
    ]);
    for (const id of shiftIds) {
      const s = shifts.find((x) => x.id === id);
      if (!s?.isActive) throw new RosterError(`${s?.name || 'A shift'} in the draft is ${s ? 'switched off' : 'no longer there'}. Change those days, or discard the draft.`, 409, 'SHIFT_OFF');
    }
    const byId = new Map(people.map((p) => [p.id, p]));
    const live = drafts.filter((d) => byId.has(d.employeeId) && employedOn(byId.get(d.employeeId)!, d.date));
    const dropped = drafts.filter((d) => !live.includes(d));
    const onShift = new Map<string, Set<string>>();
    for (const d of live) if (d.kind === 'SHIFT') (onShift.get(d.employeeId) || onShift.set(d.employeeId, new Set()).get(d.employeeId)!).add(String(d.shiftId));
    if (onShift.size) await assertNightConsent(orgId, [...onShift].map(([employeeId, ids]) => ({ employeeId, shiftIds: [...ids] })));

    const before = await loadSchedule(orgId, employeeIds);
    /* The published day each draft replaces goes; the draft becomes it, or (CLEAR) nothing does. */
    const old = live.length ? await peoplePrisma.rosterDay.findMany({ where: { orgId, state: 'PUBLISHED', OR: byPerson(live) }, select: { id: true } }) : [];
    if (old.length) await peoplePrisma.rosterDay.deleteMany({ where: { orgId, id: { in: old.map((o) => o.id) } } });
    const clear = [...dropped, ...live.filter((d) => d.kind === 'CLEAR')].map((d) => d.id);
    if (clear.length) await peoplePrisma.rosterDay.deleteMany({ where: { orgId, id: { in: clear } } });
    const keep = live.filter((d) => d.kind !== 'CLEAR').map((d) => d.id);
    if (keep.length) await peoplePrisma.rosterDay.updateMany({ where: { orgId, id: { in: keep } }, data: { state: 'PUBLISHED', publishedByUserId: userId, publishedAt: new Date() } });
    const after = await loadSchedule(orgId, employeeIds);

    /* Only days that came out different are told: a draft a temporary schedule now covers changes nothing. */
    const changed = new Map<string, Array<{ date: string; line: string }>>();
    for (const d of live) {
      const was = resolveShift(before, d.employeeId, d.date);
      const is = resolveShift(after, d.employeeId, d.date);
      if (sameState(stateOf(was, d.date), stateOf(is, d.date))) continue;
      (changed.get(d.employeeId) || changed.set(d.employeeId, []).get(d.employeeId)!).push({ date: d.date, line: dayLine(d.date, is) });
    }
    return { published: live.length, dropped: dropped.length, from: dates[0], to: dates[dates.length - 1], changed, users: new Map(people.map((p) => [p.id, p.userId])) };
  });

  /* After the commit, one notice a person: the key holds this publish and the person, so a retry cannot send a second. */
  const publishId = randomUUID();
  const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
  let notified = 0;
  for (const [employeeId, lines] of done.changed) {
    const to = done.users.get(employeeId);
    if (!to) continue;
    try {
      notified += await sendNotice(accountId, orgId, [to], { kind: 'attendance.roster_published', ...rosterNotice(lines), link: { app, screen: app === 'people' ? 'myDays' : 'me' } }, { dedupeKey: `roster:${publishId}:${employeeId}` });
    } catch (e) {
      console.error('[roster] notice', e instanceof Error ? e.message : e);
    }
  }
  return {
    published: done.published,
    dropped: done.dropped,
    from: done.from,
    to: done.to,
    people: done.changed.size,
    days: [...done.changed.values()].reduce((n, l) => n + l.length, 0),
    notified,
    draft: await draftSummary(orgId),
  };
}
