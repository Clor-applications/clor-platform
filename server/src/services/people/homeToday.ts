import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { inScope, type TeamScope } from './scope.js';

/**
 * People → Home's "today" (owner, 22 Nov 2026: dashboards you can read and
 * act on, after a UI reel): who has come in, when they came in, and the day's
 * events in order. Only people in the reader's scope; only when Attendance is
 * on for the company and the reader may see attendance records.
 */

export type ArrivalBucket = { at: string; count: number; late: number; names: string[] };
export type TodayEvent = { at: string; kind: 'late' | 'leaveApplied' | 'joined' | 'leaving'; employeeId: string; name: string; text: string; minutes?: number; from?: string; to?: string };
export type HomeToday = {
  date: string;
  expected: number;
  inCount: number;
  late: number;
  /** The most common shift start among today's records ("09:30"), or null with no shifts. */
  shiftStart: string | null;
  /** Arrivals in 15-minute steps from the first to the last check-in, IST. */
  arrivals: ArrivalBucket[];
  /** Newest first, at most 12. */
  feed: TodayEvent[];
  /** Expected today and on approved leave, not checked in. */
  onLeave: number;
  /** Each team's day, biggest team first; people with no department are "No department". */
  byTeam: TeamToday[];
};
export type TeamToday = { name: string; onTime: number; late: number; notYet: number; onLeave: number; total: number };

const NO_TEAM = 'No department';

/**
 * Each team's day: on time, late, not in yet, on leave. Someone on leave who
 * still checked in counts as in. Biggest team first, then by name.
 */
export function teamsToday(
  staff: Array<{ id: string; department: string | null }>,
  came: Map<string, { late: boolean }>,
  away: Set<string>,
): TeamToday[] {
  const by = new Map<string, TeamToday>();
  for (const p of staff) {
    const name = p.department?.trim() || NO_TEAM;
    const t = by.get(name) || { name, onTime: 0, late: 0, notYet: 0, onLeave: 0, total: 0 };
    t.total += 1;
    const r = came.get(p.id);
    if (r?.late) t.late += 1;
    else if (r) t.onTime += 1;
    else if (away.has(p.id)) t.onLeave += 1;
    else t.notYet += 1;
    by.set(name, t);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

const IST_MS = 330 * 60_000;
const BUCKET = 15;
const MAX_NAMES = 3;
const MAX_FEED = 12;

/** "HH:MM" in IST for a moment. */
export const istClock = (at: Date): string => new Date(at.getTime() + IST_MS).toISOString().slice(11, 16);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Check-ins into 15-minute steps, every step from the first arrival's to the
 * last's (an empty step stays, so the chart keeps its time axis). Each step
 * names up to three people, in the order they came in.
 */
export function bucketArrivals(rows: Array<{ clock: string; name: string; late: boolean }>): ArrivalBucket[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.clock.localeCompare(b.clock) || a.name.localeCompare(b.name));
  const start = Math.floor(minutesOf(sorted[0].clock) / BUCKET) * BUCKET;
  const end = Math.floor(minutesOf(sorted[sorted.length - 1].clock) / BUCKET) * BUCKET;
  const out: ArrivalBucket[] = [];
  for (let m = start; m <= end; m += BUCKET) out.push({ at: clockOf(m), count: 0, late: 0, names: [] });
  for (const r of sorted) {
    const b = out[(Math.floor(minutesOf(r.clock) / BUCKET) * BUCKET - start) / BUCKET];
    b.count += 1;
    if (r.late) b.late += 1;
    if (b.names.length < MAX_NAMES) b.names.push(r.name);
  }
  return out;
}

/** The value seen most often; ties go to the earliest. */
const mostCommon = (values: string[]): string | null => {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
};

export async function homeToday(accountId: string, orgId: string, scope: TeamScope, today: string, opts: { seesLeavings: boolean }): Promise<HomeToday> {
  const dayStart = new Date(new Date(`${today}T00:00:00Z`).getTime() - IST_MS);
  const [staff, records, applied, away] = await Promise.all([
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, status: { not: 'LEFT' }, OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: today } }] },
      select: { id: true, name: true, department: true, dateOfJoining: true, dateOfLeaving: true },
    }),
    peoplePrisma.attendanceRecord.findMany({
      where: { accountId, orgId, date: today, checkIn: { not: null } },
      select: { employeeId: true, checkIn: true, lateMinutes: true, shiftId: true },
    }),
    peoplePrisma.leaveRequest.findMany({
      where: { accountId, orgId, createdAt: { gte: dayStart } },
      select: { employeeId: true, createdAt: true, fromDate: true, toDate: true },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    peoplePrisma.leaveRequest.findMany({
      where: { accountId, orgId, status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today } },
      select: { employeeId: true },
    }),
  ]);
  const mine = staff.filter((p) => inScope(scope, p.id));
  const nameOf = new Map(mine.map((p) => [p.id, p.name]));
  const seen = records.filter((r) => nameOf.has(r.employeeId));
  const shiftIds = [...new Set(seen.map((r) => r.shiftId).filter((s): s is string => Boolean(s)))];
  const shifts = shiftIds.length ? await peoplePrisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, startTime: true } }) : [];
  const startOf = new Map(shifts.map((s) => [s.id, s.startTime]));

  const arrivals = bucketArrivals(seen.map((r) => ({ clock: istClock(r.checkIn!), name: nameOf.get(r.employeeId)!, late: r.lateMinutes > 0 })));
  const feed: TodayEvent[] = [];
  for (const r of seen) {
    if (r.lateMinutes > 0) feed.push({ at: istClock(r.checkIn!), kind: 'late', employeeId: r.employeeId, name: nameOf.get(r.employeeId)!, text: `came in ${r.lateMinutes} min after the shift start`, minutes: r.lateMinutes });
  }
  for (const l of applied) {
    const name = nameOf.get(l.employeeId);
    if (!name) continue;
    feed.push({ at: istClock(l.createdAt), kind: 'leaveApplied', employeeId: l.employeeId, name, text: 'applied for leave', from: l.fromDate, to: l.toDate });
  }
  for (const p of mine) {
    if (p.dateOfJoining === today) feed.push({ at: '00:00', kind: 'joined', employeeId: p.id, name: p.name, text: 'joins today' });
    if (opts.seesLeavings && p.dateOfLeaving === today) feed.push({ at: '00:00', kind: 'leaving', employeeId: p.id, name: p.name, text: 'has their last day today' });
  }
  feed.sort((a, b) => b.at.localeCompare(a.at) || a.name.localeCompare(b.name));
  const came = new Map(seen.map((r) => [r.employeeId, { late: r.lateMinutes > 0 }]));
  const byTeam = teamsToday(mine, came, new Set(away.map((l) => l.employeeId)));

  return {
    onLeave: byTeam.reduce((n, t) => n + t.onLeave, 0),
    byTeam,
    date: today,
    expected: mine.length,
    inCount: seen.length,
    late: seen.filter((r) => r.lateMinutes > 0).length,
    shiftStart: mostCommon(seen.map((r) => (r.shiftId ? startOf.get(r.shiftId) : undefined)).filter((s): s is string => Boolean(s))),
    arrivals,
    feed: feed.slice(0, MAX_FEED),
  };
}
