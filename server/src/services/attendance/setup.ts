import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { track } from '../productEvents.js';
import { readSetupState, writeSetupState } from '../people/setup.js';

/**
 * Attendance → Today's "Get started" list: the six things a small company
 * does before attendance keeps itself (launch audit: "first-run for a
 * 10-person shop: shift, weekly off, holidays, add staff, phone or reader").
 *
 * Every step is read from what is really there. Nobody ticks a step: it is
 * done when its records exist. The list goes away when all six are done, or
 * when someone who may set Attendance up hides it; that choice is kept for the
 * company beside People's (PeopleSetting.setupState, under `attendance`).
 *
 * The longer checklist under Settings → Attendance setup stays: it covers
 * reader IDs, leave types and the portal as well. This is the short one a new
 * company meets on its first page.
 */

/** People on the list before "add your staff" counts as done. */
export const ATTENDANCE_MIN_EMPLOYEES = 1;

export type AttendanceStepKey = 'shift' | 'weeklyOff' | 'holidays' | 'people' | 'punch' | 'firstDay';
export const ATTENDANCE_STEPS: AttendanceStepKey[] = ['shift', 'weeklyOff', 'holidays', 'people', 'punch', 'firstDay'];

export type AttendanceStep = {
  key: AttendanceStepKey;
  title: string;
  blurb: string;
  /** What is there now, in words. */
  detail: string;
  done: boolean;
  /** The Attendance screen that does it. */
  screen: string;
  /** A second way to do it. */
  alt?: { label: string; screen: string };
  /** Whether this person holds the permission the step's screen needs to change things. */
  can: boolean;
};

export type AttendanceFacts = {
  year: string;
  shifts: Array<{ name: string; weeklyOffDays: string; offSaturdays: string }>;
  /** The company's working week, once someone has saved it. */
  week: { weeklyOffDays: string; offSaturdays: string } | null;
  holidays: number;
  employees: number;
  readers: number;
  readersHeard: number;
  phonePunch: number;
  firstDay: string | null;
};

type State = { hidden: string | null; recorded: string[] };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const istYear = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 4);
const numbers = (s: string) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n));
const list = (words: string[]) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/** "Sunday off", "Saturday and Sunday off", "Sunday and the 2nd and 4th Saturday off", "no weekly off". */
export function weeklyOffWords(weeklyOffDays: string, offSaturdays = ''): string {
  const days = [...new Set(numbers(weeklyOffDays).filter((d) => d >= 0 && d <= 6))];
  /* Monday first, Sunday last: the way a week is said. */
  const named = days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]);
  const sats = days.includes(6) ? [] : [...new Set(numbers(offSaturdays).filter((n) => n >= 1 && n <= 5))].sort();
  const parts = [...named, ...(sats.length ? [`the ${list(sats.map((n) => ORDINAL[n]))} Saturday`] : [])];
  return parts.length ? `${list(parts)} off` : 'no weekly off';
}

/** What the steps are made of, counted once. */
export async function attendanceFacts(orgId: string, now = new Date()): Promise<AttendanceFacts> {
  const year = istYear(now);
  const current = { orgId, status: { not: 'LEFT' } };
  const [shifts, week, holidays, employees, readers, readersHeard, phonePunch, first] = await Promise.all([
    peoplePrisma.shift.findMany({ where: { orgId, isActive: true }, select: { name: true, weeklyOffDays: true, offSaturdays: true }, orderBy: { name: 'asc' } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { weeklyOffDays: true, offSaturdays: true } }),
    peoplePrisma.holiday.count({ where: { orgId, date: { startsWith: year } } }),
    peoplePrisma.employee.count({ where: current }),
    peoplePrisma.attendanceDevice.count({ where: { orgId, isActive: true, vendor: { not: 'MOBILE' } } }),
    peoplePrisma.attendanceDevice.count({ where: { orgId, isActive: true, vendor: { not: 'MOBILE' }, lastSeenAt: { not: null } } }),
    peoplePrisma.employee.count({ where: { ...current, mobilePunch: true } }),
    peoplePrisma.attendanceRecord.findFirst({ where: { orgId }, select: { date: true }, orderBy: { date: 'asc' } }),
  ]);
  return { year, shifts, week, holidays, employees, readers, readersHeard, phonePunch, firstDay: first?.date || null };
}

const sayDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The six steps, each done or not, from the facts. Pure, for the tests. `may` holds the steps this person can act on. */
export function buildAttendanceSteps(f: AttendanceFacts, may: ReadonlySet<string> = new Set(ATTENDANCE_STEPS)): AttendanceStep[] {
  const hasShift = f.shifts.length > 0;
  const offs = hasShift
    ? f.shifts.slice(0, 2).map((s) => `${s.name}: ${weeklyOffWords(s.weeklyOffDays, s.offSaturdays)}`).join(' · ') + (f.shifts.length > 2 ? ` · and ${f.shifts.length - 2} more` : '')
    : f.week
      ? `Working week: ${weeklyOffWords(f.week.weeklyOffDays, f.week.offSaturdays)}`
      : 'Not set yet';
  const punchDone = f.readersHeard > 0 || f.phonePunch > 0;
  const punchDetail = [
    f.readers ? `${f.readersHeard} of ${plural(f.readers, 'reader')} connected` : 'No reader added',
    f.phonePunch ? `phone punch on for ${plural(f.phonePunch, 'person', 'people')}` : 'phone punch off',
  ].join(' · ');
  const step = (s: Omit<AttendanceStep, 'can'>): AttendanceStep => ({ ...s, can: may.has(s.key) });
  return [
    step({ key: 'shift', title: 'Add a shift', blurb: 'The working hours: when the day starts and ends, and how late is late.', detail: hasShift ? list(f.shifts.slice(0, 3).map((s) => s.name)) + (f.shifts.length > 3 ? ` and ${f.shifts.length - 3} more` : '') : 'No shift yet', done: hasShift, screen: 'shifts' }),
    step({ key: 'weeklyOff', title: 'Set the weekly off', blurb: 'Each shift carries its own days off. Anyone without a shift follows the working week.', detail: offs, done: hasShift || Boolean(f.week), screen: hasShift ? 'weeklyOffPolicy' : 'workingWeek' }),
    step({ key: 'holidays', title: `Add ${f.year}’s holidays`, blurb: 'Paid days off, so nobody is marked absent on a holiday.', detail: f.holidays ? `${plural(f.holidays, 'holiday')} in ${f.year}` : 'None yet', done: f.holidays > 0, screen: 'holidays' }),
    step({ key: 'people', title: 'Add your staff', blurb: 'Everyone whose attendance is kept, each with an employee code. Add them one by one, or import a spreadsheet.', detail: f.employees ? plural(f.employees, 'person', 'people') : 'Nobody yet', done: f.employees >= ATTENDANCE_MIN_EMPLOYEES, screen: 'employees', alt: { label: 'Import', screen: 'dataImport' } }),
    step({ key: 'punch', title: 'Connect a reader or switch on phone punch', blurb: 'How punches reach CLOR: a biometric reader at the door, or each person’s own phone.', detail: punchDetail, done: punchDone, screen: 'readers', alt: { label: 'Phone punch', screen: 'portalAccess' } }),
    step({ key: 'firstDay', title: 'See the first day recorded', blurb: 'One day with a punch or a mark shows that everything above works together.', detail: f.firstDay ? `First day ${sayDate(f.firstDay)}` : 'No day recorded yet', done: Boolean(f.firstDay), screen: 'records' }),
  ];
}

async function stateOf(orgId: string): Promise<State> {
  const raw = (await readSetupState(orgId)).attendance;
  const s = (raw && typeof raw === 'object' ? raw : {}) as { hidden?: unknown; recorded?: unknown };
  return { hidden: typeof s.hidden === 'string' && s.hidden ? s.hidden : null, recorded: Array.isArray(s.recorded) ? s.recorded.map(String) : [] };
}

/** The list for this company, as this person may act on it. Newly done steps are noted once, as People's are. */
export async function attendanceSetup(accountId: string, orgId: string, userId: string | null, may: ReadonlySet<string>, now = new Date()) {
  const [state, facts] = await Promise.all([stateOf(orgId), attendanceFacts(orgId, now)]);
  const steps = buildAttendanceSteps(facts, may);
  const recorded = new Set(state.recorded);
  const newlyDone = steps.filter((s) => s.done && !recorded.has(s.key));
  if (newlyDone.length) {
    for (const s of newlyDone) {
      recorded.add(s.key);
      void track(orgId, userId, 'setup_step_done', { step: s.key, app: 'attendance' });
    }
    await writeSetupState(accountId, orgId, { attendance: { ...state, recorded: [...recorded] } }, userId).catch((e) => console.error('[attendance-setup]', e instanceof Error ? e.message : e));
  }
  const done = steps.filter((s) => s.done).length;
  return { setup: { steps, done, total: steps.length, show: !state.hidden && done < steps.length } };
}

export class AttendanceSetupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Hide the list for the company, or bring it back. */
export async function changeAttendanceSetup(accountId: string, orgId: string, userId: string | null, may: ReadonlySet<string>, body: { action?: string }) {
  const action = String(body?.action || '');
  if (action !== 'hide' && action !== 'show') throw new AttendanceSetupError('Say what to do: hide or show.');
  const state = await stateOf(orgId);
  await writeSetupState(accountId, orgId, { attendance: { ...state, hidden: action === 'hide' ? new Date().toISOString() : null } }, userId);
  return attendanceSetup(accountId, orgId, userId, may);
}
