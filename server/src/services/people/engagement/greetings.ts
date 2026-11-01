import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { sendNotice } from '../../notifications.js';
import { registerRecipe } from './automations.js';
import { addDays as plusDays } from '../../../utils/istDate.js';

/**
 * Birthdays, work anniversaries and the holiday heads-up (WORKFLOW-GAP-RESEARCH-2026-10-30 A14, A15, 4.8).
 *
 * Each morning the automations job (when the company switched the recipe on) writes the day's posts once
 * (a unique row per company, day and person or holiday) and tells the team on the bell: the whole company
 * when it has 20 people or fewer, otherwise the person's department and reporting line. The employee app
 * shows the posts to the same people; People Home shows them to HR. A manager may be reminded to wish.
 *
 * The date of birth is personal data (DPDP): only the day is used, the year is never shown or sent, and
 * anyone may opt out of being announced, in the employee app or by HR; an opted-out person is left out of
 * every post, nudge and Home list.
 *
 * The holiday heads-up goes the day before each holiday on the person's own list: the company's, plus
 * their branch's and area's (the same rule that marks the day off).
 */

const SMALL_COMPANY = 20;
type Person = { id: string; name: string; userId: string | null; departmentId: string | null; reportingManagerId: string | null; areaId: string | null; branchId: string | null; dateOfBirth: string | null; dateOfJoining: string | null };
const PERSON = { id: true, name: true, userId: true, departmentId: true, reportingManagerId: true, areaId: true, branchId: true, dateOfBirth: true, dateOfJoining: true } as const;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Month-day of a date this year; 29 Feb falls on 28 Feb in a year without one. */
export const dayThisYear = (iso: string, year: number) => {
  const md = iso.slice(5, 10);
  return md === '02-29' && !isLeap(year) ? `${year}-02-28` : `${year}-${md}`;
};
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

export async function optedOut(orgId: string) {
  return new Set((await peoplePrisma.celebrationOptOut.findMany({ where: { orgId }, select: { employeeId: true } })).map((o) => o.employeeId));
}

/** Opt out of being announced, or back in. Idempotent: a second tap changes nothing. */
export async function setOptOut(orgId: string, accountId: string, employeeId: string, out: boolean, byUserId: string) {
  if (out) await peoplePrisma.celebrationOptOut.createMany({ data: [{ accountId, orgId, employeeId, byUserId }], skipDuplicates: true });
  else await peoplePrisma.celebrationOptOut.deleteMany({ where: { orgId, employeeId } });
  return { optedOut: out };
}

async function active(orgId: string, today: string): Promise<Person[]> {
  return (await peoplePrisma.employee.findMany({ where: { orgId, status: { in: ['ACTIVE', 'ON_NOTICE'] }, OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: today } }] }, select: PERSON })) as Person[];
}

/** Whether `b` hears about `a`: everyone in a small company; otherwise same department, or the same reporting line. */
export function sameTeam(a: Pick<Person, 'id' | 'departmentId' | 'reportingManagerId'>, b: Pick<Person, 'id' | 'departmentId' | 'reportingManagerId'>, companySize: number) {
  if (a.id === b.id) return true;
  if (companySize <= SMALL_COMPANY) return true;
  if (a.departmentId && a.departmentId === b.departmentId) return true;
  if (a.reportingManagerId === b.id || b.reportingManagerId === a.id) return true;
  return Boolean(a.reportingManagerId && a.reportingManagerId === b.reportingManagerId);
}

/** Today's birthdays and work anniversaries (opted-out people left out), the year of birth never read past the day. */
export async function celebrationsOn(orgId: string, today: string, people?: Person[]) {
  const all = people || (await active(orgId, today));
  const out = await optedOut(orgId);
  const year = Number(today.slice(0, 4));
  const birthdays = all.filter((p) => !out.has(p.id) && p.dateOfBirth && /^\d{4}-\d{2}-\d{2}/.test(p.dateOfBirth) && dayThisYear(p.dateOfBirth, year) === today);
  const anniversaries = all
    .filter((p) => !out.has(p.id) && p.dateOfJoining && /^\d{4}-\d{2}-\d{2}/.test(p.dateOfJoining) && dayThisYear(p.dateOfJoining, year) === today)
    .map((p) => ({ ...p, years: year - Number(p.dateOfJoining!.slice(0, 4)) }))
    .filter((p) => p.years >= 1);
  return { all, birthdays, anniversaries };
}

async function post(accountId: string, orgId: string, onDate: string, rows: Array<{ kind: string; key: string; employeeId?: string | null; years?: number | null; holidayId?: string | null; holidayDate?: string | null; areaId?: string | null; branchId?: string | null; text: string }>) {
  if (!rows.length) return 0;
  return (await peoplePrisma.greetingPost.createMany({ data: rows.map((r) => ({ accountId, orgId, onDate, ...r })), skipDuplicates: true })).count;
}

/** Tells each CLOR user in the team of the people named, once per day (the notice key). */
async function tellTeams(accountId: string, orgId: string, today: string, all: Person[], subjects: Person[], kind: string, title: (names: string[]) => string) {
  const users = all.filter((p) => p.userId);
  const told: string[] = [];
  let count = 0;
  for (const u of users) {
    const about = subjects.filter((s) => s.id !== u.id && sameTeam(s, u, all.length));
    if (!about.length) continue;
    const n = await sendNotice(accountId, orgId, [u.userId!], { kind, title: title(about.map((s) => s.name)), link: { app: 'people', screen: 'overview' } }, { dedupeKey: `${kind}:${today}` });
    count += n;
    if (n) told.push(u.name);
  }
  return { count, told };
}
const list = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

registerRecipe('birthdays', async ({ accountId, orgId, today }) => {
  const { all, birthdays } = await celebrationsOn(orgId, today);
  if (!birthdays.length) return { count: 0, recipients: [] };
  await post(accountId, orgId, today, birthdays.map((p) => ({ kind: 'BIRTHDAY', key: `BIRTHDAY:${p.id}`, employeeId: p.id, text: `${p.name}’s birthday today` })));
  const { count, told } = await tellTeams(accountId, orgId, today, all, birthdays, 'people.birthday', (n) => `Today: ${list(n)}’s birthday`);
  return { count: count || birthdays.length, recipients: told.length ? told : birthdays.map((p) => p.name) };
});

registerRecipe('anniversaries', async ({ accountId, orgId, today }) => {
  const { all, anniversaries } = await celebrationsOn(orgId, today);
  if (!anniversaries.length) return { count: 0, recipients: [] };
  await post(accountId, orgId, today, anniversaries.map((p) => ({ kind: 'ANNIVERSARY', key: `ANNIVERSARY:${p.id}`, employeeId: p.id, years: p.years, text: `${p.name}’s ${ordinal(p.years)} work anniversary today` })));
  const { count, told } = await tellTeams(accountId, orgId, today, all, anniversaries, 'people.anniversary', (n) => `Today: ${list(n)}’s work anniversary`);
  return { count: count || anniversaries.length, recipients: told.length ? told : anniversaries.map((p) => p.name) };
});

/** The manager hears "Wish Ravi a happy birthday today": their own reports only, once a day. */
registerRecipe('wishNudge', async ({ accountId, orgId, today }) => {
  const { all, birthdays, anniversaries } = await celebrationsOn(orgId, today);
  const byId = new Map(all.map((p) => [p.id, p]));
  const asks = new Map<string, string[]>();
  for (const p of birthdays) if (p.reportingManagerId) asks.set(p.reportingManagerId, [...(asks.get(p.reportingManagerId) || []), `${p.name.split(' ')[0]} a happy birthday`]);
  for (const p of anniversaries) if (p.reportingManagerId) asks.set(p.reportingManagerId, [...(asks.get(p.reportingManagerId) || []), `${p.name.split(' ')[0]} on ${p.years} ${p.years === 1 ? 'year' : 'years'} here`]);
  let count = 0;
  const told: string[] = [];
  for (const [managerId, lines] of asks) {
    const m = byId.get(managerId);
    if (!m?.userId) continue;
    const n = await sendNotice(accountId, orgId, [m.userId], { kind: 'people.wish', title: `Wish ${list(lines)} today`, link: { app: 'people', screen: 'overview' } }, { dedupeKey: `people.wish:${today}` });
    count += n;
    if (n) told.push(m.name);
  }
  return { count, recipients: told };
});

/** The day before a holiday: a post for the people whose list has it, and the bell for those who sign in to CLOR. */
registerRecipe('holidayHeadsUp', async ({ accountId, orgId, today }) => {
  const tomorrow = plusDays(today, 1);
  const holidays = await peoplePrisma.holiday.findMany({ where: { orgId, date: tomorrow, isOptional: false }, select: { id: true, name: true, date: true, areaId: true, branchId: true } });
  if (!holidays.length) return { count: 0, recipients: [] };
  await post(accountId, orgId, today, holidays.map((h) => ({ kind: 'HOLIDAY', key: `HOLIDAY:${h.id}`, holidayId: h.id, holidayDate: h.date, areaId: h.areaId, branchId: h.branchId, text: `Tomorrow, ${longDay(h.date)}, is a holiday: ${h.name}` })));
  const all = await active(orgId, today);
  let count = 0;
  const told: string[] = [];
  for (const p of all.filter((x) => x.userId)) {
    const mine = holidays.filter((h) => (!h.areaId || h.areaId === p.areaId) && (!h.branchId || h.branchId === p.branchId));
    if (!mine.length) continue;
    const n = await sendNotice(accountId, orgId, [p.userId!], { kind: 'people.holiday', title: `Tomorrow is a holiday: ${mine.map((h) => h.name).join(', ')}`, link: { app: 'people', screen: 'holidays' } }, { dedupeKey: `people.holiday:${tomorrow}` });
    count += n;
    if (n) told.push(p.name);
  }
  return { count: count || holidays.length, recipients: told.length ? told : holidays.map((h) => h.name) };
});

/**
 * The employee app's "Today": the day's posts this person may see (their team's celebrations, their own
 * list's holiday), from the last two days so a morning post is still there in the evening.
 */
export async function feedFor(orgId: string, me: { id: string; departmentId?: string | null; reportingManagerId?: string | null; areaId?: string | null; branchId?: string | null }, today: string) {
  const posts = await peoplePrisma.greetingPost.findMany({ where: { orgId, onDate: { gte: plusDays(today, -1), lte: today } }, orderBy: [{ onDate: 'desc' }, { createdAt: 'asc' }] });
  if (!posts.length) return [];
  const ids = [...new Set(posts.map((p) => p.employeeId).filter(Boolean) as string[])];
  const [people, size, out] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, departmentId: true, reportingManagerId: true, photoUrl: true } }),
    peoplePrisma.employee.count({ where: { orgId, status: { in: ['ACTIVE', 'ON_NOTICE'] } } }),
    optedOut(orgId),
  ]);
  const of = new Map(people.map((p) => [p.id, p]));
  const meP = { id: me.id, departmentId: me.departmentId || null, reportingManagerId: me.reportingManagerId || null };
  return posts
    .filter((p) => {
      if (p.kind === 'HOLIDAY') return p.onDate === today && (!p.areaId || p.areaId === me.areaId) && (!p.branchId || p.branchId === me.branchId);
      if (!p.employeeId || out.has(p.employeeId) || p.onDate !== today) return false;
      const them = of.get(p.employeeId);
      return Boolean(them && sameTeam({ id: them.id, departmentId: them.departmentId, reportingManagerId: them.reportingManagerId }, meP, size));
    })
    .map((p) => ({ id: p.id, kind: p.kind, text: p.employeeId === me.id ? (p.kind === 'BIRTHDAY' ? 'Happy birthday from everyone here' : `Happy ${ordinal(p.years || 1)} work anniversary`) : p.text, mine: p.employeeId === me.id, date: p.holidayDate || p.onDate }));
}
