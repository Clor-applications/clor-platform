import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { registerJob } from '../jobRegistry.js';
import { sendNotice } from '../notifications.js';
import { isFeatureEnabled } from '../features.js';
import { isWeeklyOff, istTime, shiftWindow } from './compute.js';
import { periodContext, today } from './days.js';
import { rulesOf } from './timeRules.js';
import { eachDay } from '../../utils/istDate.js';

/**
 * The missing-punch nudge (WORKFLOW-GAP-RESEARCH-2026-10-30 B5, 4.5).
 *
 * Every hour: for each working day that ended more than [2] hours after its shift ended (the
 * company's setting) where someone came in and never punched out, or never punched at all with no
 * leave and no holiday, the person is told once that day: "No punch-out on Tue 29 Oct: fix it". The
 * notice opens the missed-punch request already filled in: the date, "forgot to punch" and the
 * shift's end as the suggested time. Each missing day is named once; a person hears at most once a
 * day (AttendanceNudge's unique key, so two instances or a retry send once).
 *
 * Who is checked: people who punch. Someone with no punch in the last 30 days is not nagged daily
 * about a habit they do not have (a company that keeps days by hand, or People without check-in).
 * Not told: a day on leave, a holiday (theirs, by branch, area and picked), a weekly off (their own
 * shift's), a day with a correction or leave already asked for, a field punch waiting for approval.
 *
 * In the morning (IST 8 to 11) each manager gets one list of the team's unfixed days.
 *
 * Staff with a CLOR sign-in get a bell notice; staff with the employee app alone read the same
 * rows in its What's new (`fixesFor`), as they do every other notice.
 */

const LOOKBACK_DAYS = 3;
const ACTIVE_WITHIN_DAYS = 30;
const DAY_MS = 86_400_000;
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export type FixItem = { date: string; what: 'NO_OUT' | 'NO_PUNCH'; checkIn: string | null; suggestedIn: string; suggestedOut: string };

/**
 * The days each person should fix, as of `now`, over the last few days: the same rules as the
 * employee app's "needs attention", limited to days whose shift ended long enough ago.
 */
export async function unfixedDays(accountId: string, orgId: string, now: Date, opts: { lookback?: number; employeeIds?: string[] } = {}) {
  const rules = rulesOf(await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } })).nudge;
  const t = today();
  const from = plusDays(t, -(opts.lookback ?? LOOKBACK_DAYS));
  const ctx = await periodContext(accountId, orgId, from, t);
  const keep = opts.employeeIds ? new Set(opts.employeeIds) : null;
  const people = ctx.people.filter((p) => (!keep || keep.has(p.id)) && (p.status === 'ACTIVE' || p.status === 'ON_NOTICE'));
  if (!people.length) return new Map<string, FixItem[]>();
  const ids = people.map((p) => p.id);
  const [punchers, asked, leaveAsked, fieldWaiting] = await Promise.all([
    peoplePrisma.attendanceRecord.groupBy({ by: ['employeeId'], where: { orgId, employeeId: { in: ids }, checkIn: { not: null }, date: { gte: plusDays(t, -ACTIVE_WITHIN_DAYS) } } }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: 'PENDING', date: { gte: from, lte: t } }, select: { employeeId: true, date: true, toDate: true } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: t }, toDate: { gte: from } }, select: { employeeId: true, fromDate: true, toDate: true } }),
    peoplePrisma.devicePunch.findMany({ where: { orgId, employeeId: { in: ids }, outsideSite: true, reviewStatus: 'PENDING', shiftDate: { gte: from, lte: t } }, select: { employeeId: true, shiftDate: true } }),
  ]);
  const punches = new Set(punchers.map((p) => p.employeeId));
  const covered = (employeeId: string, d: string) =>
    asked.some((r) => r.employeeId === employeeId && r.date <= d && (r.toDate || r.date) >= d) ||
    leaveAsked.some((l) => l.employeeId === employeeId && l.fromDate <= d && l.toDate >= d) ||
    fieldWaiting.some((f) => f.employeeId === employeeId && f.shiftDate === d);
  const out = new Map<string, FixItem[]>();
  for (const p of people) {
    if (!punches.has(p.id)) continue;
    const span = new Set(ctx.spanOf(p));
    const holidays = ctx.holidaysFor(p);
    const recs = ctx.recordsOf.get(p.id) || new Map();
    const items: FixItem[] = [];
    for (const d of eachDay(from, t)) {
      if (!span.has(d) || holidays.has(d)) continue;
      const shift = ctx.shiftOn(p.id, d);
      if (isWeeklyOff(shift.rule, d)) continue;
      const { start, end } = shiftWindow(shift.rule, d);
      if (end.getTime() + rules.afterHours * 3_600_000 > now.getTime()) continue;
      if (covered(p.id, d)) continue;
      const r = recs.get(d);
      const suggestedIn = istTime(start);
      const suggestedOut = istTime(end);
      if (!r) items.push({ date: d, what: 'NO_PUNCH', checkIn: null, suggestedIn, suggestedOut });
      else if (r.status === 'PRESENT' && r.checkIn && !r.checkOut) items.push({ date: d, what: 'NO_OUT', checkIn: istTime(r.checkIn), suggestedIn, suggestedOut });
    }
    if (items.length) out.set(p.id, items);
  }
  return out;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (d: string) => `${DAY_NAMES[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** "No punch-out on Tue 29 Oct: fix it", "2 days to fix: no punch-out on Tue 29 Oct, no punch on Wed 30 Oct". */
export function fixWords(items: FixItem[]) {
  const one = (i: FixItem) => `${i.what === 'NO_OUT' ? 'no punch-out' : 'no punch'} on ${shortDay(i.date)}`;
  if (items.length === 1) return `${one(items[0]).replace(/^n/, 'N')}: fix it`;
  return `${items.length} days to fix: ${items.map(one).join(', ')}`;
}

/** Who already heard about which days in the last week, so each missing day is named once. */
async function alreadyNamed(orgId: string, since: string) {
  const rows = await peoplePrisma.attendanceNudge.findMany({ where: { orgId, kind: 'FIX', sentOn: { gte: since } }, select: { employeeId: true, days: true } });
  const named = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = named.get(r.employeeId) || new Set<string>();
    for (const d of (Array.isArray(r.days) ? r.days : []) as FixItem[]) set.add(d.date);
    named.set(r.employeeId, set);
  }
  return named;
}

/** Claim today's notice for one person and kind: true once, false for every later try the same day. */
async function claim(accountId: string, orgId: string, employeeId: string, sentOn: string, kind: 'FIX' | 'TEAM', days: unknown[]) {
  try {
    await peoplePrisma.attendanceNudge.create({ data: { accountId, orgId, employeeId, sentOn, kind, days: days as any } });
    return true;
  } catch (e: any) {
    if (String(e?.code) === 'P2002') return false;
    throw e;
  }
}

/** One company's run: nudges to people, and in the morning the managers' lists. Returns what was sent. */
export async function nudgeCompany(accountId: string, orgId: string, now = new Date()) {
  const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
  const rules = rulesOf(settings).nudge;
  if (!rules.on) return { people: 0, managers: 0 };
  const t = today();
  const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
  const due = await unfixedDays(accountId, orgId, now);
  const named = await alreadyNamed(orgId, plusDays(t, -7));
  const people = due.size ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...due.keys()] } }, select: { id: true, name: true, userId: true, reportingManagerId: true } }) : [];
  let sentPeople = 0;
  for (const p of people) {
    const fresh = due.get(p.id)!.filter((i) => !named.get(p.id)?.has(i.date));
    if (!fresh.length) continue;
    if (!(await claim(accountId, orgId, p.id, t, 'FIX', fresh))) continue;
    sentPeople += 1;
    if (p.userId) {
      const first = fresh[0];
      await sendNotice(accountId, orgId, [p.userId], {
        kind: 'attendance.punch_fix',
        title: fixWords(fresh),
        body: 'Tap to ask for the correction, already filled in.',
        link: { app, screen: 'myDays', params: { fix: first.date, ...(first.checkIn ? { in: first.checkIn } : { in: first.suggestedIn }), out: first.suggestedOut } },
      }, { dedupeKey: `punch-fix:${t}` }).catch((e) => console.error('[punch nudge] notice', e instanceof Error ? e.message : e));
    }
  }
  /* The morning list for managers: every unfixed day of their team, before today. */
  let sentManagers = 0;
  const hour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  if (rules.managerDigest && hour >= 8 && hour < 11 && due.size) {
    const byManager = new Map<string, Array<{ employeeId: string; name: string; date: string; what: string }>>();
    for (const p of people) {
      if (!p.reportingManagerId) continue;
      const past = due.get(p.id)!.filter((i) => i.date < t);
      for (const i of past) byManager.set(p.reportingManagerId, [...(byManager.get(p.reportingManagerId) || []), { employeeId: p.id, name: p.name, date: i.date, what: i.what }]);
    }
    const managers = byManager.size ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...byManager.keys()] }, status: { in: ['ACTIVE', 'ON_NOTICE'] } }, select: { id: true, userId: true } }) : [];
    for (const m of managers) {
      const list = byManager.get(m.id)!;
      if (!(await claim(accountId, orgId, m.id, t, 'TEAM', list))) continue;
      sentManagers += 1;
      if (m.userId) {
        const names = [...new Set(list.map((x) => x.name))];
        await sendNotice(accountId, orgId, [m.userId], {
          kind: 'attendance.punch_team',
          title: `${list.length} ${list.length === 1 ? 'day' : 'days'} of your team still to fix`,
          body: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}: punches missing. They have been asked to fix them.`,
          link: { app, screen: 'attendance' },
        }, { dedupeKey: `punch-team:${t}` }).catch((e) => console.error('[punch nudge] team notice', e instanceof Error ? e.message : e));
      }
    }
  }
  return { people: sentPeople, managers: sentManagers };
}

/** Every company with People or Attendance on and the nudge on; one company's failure does not stop the rest. */
export async function runPunchNudges(now = new Date()) {
  const orgs = await outsideTenant('job: punch nudges', () => peoplePrisma.employee.groupBy({ by: ['accountId', 'orgId'], where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } } }));
  let people = 0;
  let managers = 0;
  for (const o of orgs) {
    try {
      if (!(await isFeatureEnabled(o.accountId, o.orgId, 'attendance')) && !(await isFeatureEnabled(o.accountId, o.orgId, 'people'))) continue;
      const r = await runInTenant(o.orgId, () => nudgeCompany(o.accountId, o.orgId, now));
      people += r.people;
      managers += r.managers;
    } catch (e) {
      console.error(`[punch nudge] ${o.orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return { people, managers };
}

/**
 * What the employee app shows for one person: the fix notices of the last week whose days are still
 * unfixed today, each with what to fill in; and, for a manager, today's list of the team's days.
 */
export async function fixesFor(e: { id: string; accountId: string; orgId: string }) {
  const t = today();
  const since = plusDays(t, -7);
  const [mine, team] = await Promise.all([
    peoplePrisma.attendanceNudge.findMany({ where: { orgId: e.orgId, employeeId: e.id, kind: 'FIX', sentOn: { gte: since } }, orderBy: { sentOn: 'desc' } }),
    peoplePrisma.attendanceNudge.findFirst({ where: { orgId: e.orgId, employeeId: e.id, kind: 'TEAM', sentOn: t } }),
  ]);
  const named = [...new Map(mine.flatMap((n) => ((Array.isArray(n.days) ? n.days : []) as FixItem[]).map((d) => [d.date, { ...d, sentOn: n.sentOn, at: n.createdAt }]))).values()];
  if (!named.length && !team) return { fixes: [], team: null };
  /* Still unfixed: worked out now, over the days named (a fix asked for, or a punch since, clears it). */
  const still = named.length ? (await unfixedDays(e.accountId, e.orgId, new Date(), { lookback: Math.max(1, Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${named.map((n) => n.date).sort()[0]}T00:00:00Z`)) / DAY_MS)), employeeIds: [e.id] })).get(e.id) || [] : [];
  const open = new Set(still.map((s) => s.date));
  return {
    fixes: named.filter((n) => open.has(n.date)).sort((a, b) => b.date.localeCompare(a.date)).map((n) => ({ date: n.date, what: n.what, checkIn: n.checkIn, suggestedIn: n.suggestedIn, suggestedOut: n.suggestedOut, text: fixWords([n]), at: n.at.toISOString() })),
    team: team ? { count: (Array.isArray(team.days) ? team.days : []).length, days: team.days as unknown[], at: team.createdAt.toISOString() } : null,
  };
}

export function startPunchNudges({ intervalMs = 3_600_000, startupDelayMs = 200_000 } = {}) {
  const tick = () =>
    exclusive('attendance.punch-nudge', leaseFor(intervalMs), async () => {
      await runPunchNudges();
    }).catch((e) => {
      console.error('[punch nudge] failed:', e instanceof Error ? e.message : e);
      throw e;
    });
  registerJob('startPunchNudges', tick, intervalMs);
  const timed = () => tick().catch(() => {});
  const t = setTimeout(() => {
    timed();
    const i = setInterval(timed, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
