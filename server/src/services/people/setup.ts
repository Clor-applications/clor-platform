import { holidayMinimum } from '../attendance/holidayMinimum.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { getFeatures } from '../features.js';
import { usersWithPermission } from '../notifications.js';
import { track } from '../productEvents.js';

/**
 * People Home's setup list (PRODUCT-VIEW §2, R1): what a new company does
 * before People is any use, worked out from what is really there, the way
 * Attendance Setup does it. A step ticks itself when its records exist;
 * a person may skip a step, or hide the whole list. The list goes away once
 * every step that matters is done or skipped, or when it is hidden.
 *
 * Beside it, simple mode's one-time suggestion: a company that has grown past
 * up to 10 people and up to 2 users is told once that the full menus exist,
 * never switched for.
 */

export const SIMPLE_MAX_EMPLOYEES = 10;
export const SIMPLE_MAX_USERS = 2;

export type SetupStepKey = 'people' | 'week' | 'leave' | 'app' | 'payroll';
export const SETUP_STEPS: SetupStepKey[] = ['people', 'week', 'leave', 'app', 'payroll'];

export type SetupStep = {
  key: SetupStepKey;
  title: string;
  blurb: string;
  detail: string;
  done: boolean;
  skipped: boolean;
  optional: boolean;
  /** The screen in People that does it. */
  screen: string;
  /** A second way to do it (Import beside Add). */
  alt?: { label: string; screen: string };
  /** Another app, when the step lives there. */
  app?: string;
};

type SetupState = { skipped?: string[]; hidden?: string | null; recorded?: string[]; simpleAdvice?: string | null };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const istYear = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 4);

async function stateOf(orgId: string): Promise<SetupState> {
  const row = await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { setupState: true } });
  const s = (row?.setupState && typeof row.setupState === 'object' ? row.setupState : {}) as SetupState;
  return { skipped: Array.isArray(s.skipped) ? s.skipped : [], hidden: s.hidden || null, recorded: Array.isArray(s.recorded) ? s.recorded : [], simpleAdvice: s.simpleAdvice || null };
}

async function saveState(accountId: string, orgId: string, state: SetupState, userId: string | null) {
  await peoplePrisma.peopleSetting.upsert({
    where: { orgId },
    update: { setupState: state as any, updatedByUserId: userId },
    create: { accountId, orgId, setupState: state as any, updatedByUserId: userId },
  });
}

/** Active users of the company (sign-ins, not employees). */
async function activeUsers(orgId: string) {
  const members = await platformPrisma.userOrgMembership.findMany({ where: { orgId }, select: { userId: true } });
  if (!members.length) return 0;
  return platformPrisma.user.count({ where: { id: { in: members.map((m) => m.userId) }, isActive: true } });
}

/** What the steps are made of, counted once. */
async function facts(accountId: string, orgId: string, now: Date) {
  const year = istYear(now);
  const [employees, settings, holidays, leaveTypes, appUsers, features] = await Promise.all([
    peoplePrisma.employee.count({ where: { orgId, status: { not: 'LEFT' } } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { weeklyOffDays: true, defaultShiftId: true } }),
    peoplePrisma.holiday.count({ where: { orgId, date: { startsWith: year } } }),
    peoplePrisma.leaveType.count({ where: { orgId, isActive: true } }),
    peoplePrisma.employee.count({ where: { orgId, status: { not: 'LEFT' }, portalPasswordSetAt: { not: null } } }),
    getFeatures(accountId, orgId),
  ]);
  /* A branch short of its state's national and festival holidays (holidayMinimum.ts), once some holidays are set. */
  const short = holidays ? (await holidayMinimum(orgId, year)).filter((b) => b.short) : [];
  return { year, employees, weekSet: Boolean(settings), holidays, leaveTypes, appUsers, payroll: Boolean(features.payroll), features, short };
}

export function buildSteps(f: Awaited<ReturnType<typeof facts>>, state: SetupState): SetupStep[] {
  const skipped = new Set(state.skipped || []);
  const step = (s: Omit<SetupStep, 'skipped'>): SetupStep => ({ ...s, skipped: !s.done && skipped.has(s.key) });
  const weekDone = f.weekSet && f.holidays > 0;
  return [
    step({ key: 'people', title: 'Add your people', blurb: 'Everyone who works here, with a joining date. Add them one by one, or import a spreadsheet.', detail: f.employees ? plural(f.employees, 'person', 'people') : 'Nobody yet', done: f.employees > 0, optional: false, screen: 'employeeNew', alt: { label: 'Import', screen: 'employeeImport' } }),
    step({ key: 'week', title: 'Set the working week and holidays', blurb: 'Which days are off, and this year’s holidays, so leave counts only working days.', detail: [f.weekSet ? 'Working week set' : 'Working week not set', `${plural(f.holidays, 'holiday')} in ${f.year}`, ...(f.short || []).slice(0, 2).map((b) => `${b.branchName}: ${b.state} asks for ${b.minimum}, ${b.holidays} set`)].join(' · '), done: weekDone, optional: false, screen: f.weekSet ? 'holidays' : 'workingWeek' }),
    step({ key: 'leave', title: 'Pick your leave types', blurb: 'Start from your state’s rules (Karnataka, Maharashtra, Tamil Nadu, Delhi, Factories) and change what you need.', detail: f.leaveTypes ? plural(f.leaveTypes, 'leave type') : 'None yet', done: f.leaveTypes > 0, optional: false, screen: 'leaveTypes' }),
    step({ key: 'app', title: 'Give your staff the employee app', blurb: 'They ask for leave, see their balance and holidays, and check in from their phone.', detail: f.appUsers ? `${plural(f.appUsers, 'person', 'people')} signed in` : 'Nobody signed in yet', done: f.appUsers > 0, optional: false, screen: 'selfService' }),
    step({ key: 'payroll', title: 'Connect Payroll (optional)', blurb: 'Pay salaries from the same people and leave: unpaid leave becomes loss of pay on its own.', detail: f.payroll ? 'Payroll is on' : 'Not connected', done: f.payroll, optional: true, screen: 'modules', app: 'payroll' }),
  ];
}

/** Why simple mode no longer fits, in plain words; empty while it does. */
async function outgrownReasons(accountId: string, orgId: string, employees: number) {
  const [users, branches, readers, approvers] = await Promise.all([
    activeUsers(orgId),
    platformPrisma.branch.count({ where: { orgId } }),
    peoplePrisma.attendanceDevice.count({ where: { orgId, isActive: true, vendor: { not: 'MOBILE' } } }),
    usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE').then((ids) => ids.length).catch(() => 0),
  ]);
  const out: string[] = [];
  if (employees > SIMPLE_MAX_EMPLOYEES) out.push(`${employees} people work here`);
  if (users > SIMPLE_MAX_USERS) out.push(`${users} people sign in to CLOR`);
  if (approvers > 1) out.push('more than one person approves leave');
  if (branches > 1) out.push(`${branches} branches`);
  if (readers > 0) out.push(plural(readers, 'attendance reader') + ' connected');
  return out;
}

/**
 * The list and the suggestion for this company. Newly done steps are noted
 * once (setup_step_done) so the activation funnel can be read later.
 */
export async function peopleSetup(accountId: string, orgId: string, userId: string | null, now = new Date()) {
  const [state, f] = await Promise.all([stateOf(orgId), facts(accountId, orgId, now)]);
  const steps = buildSteps(f, state);

  const recorded = new Set(state.recorded || []);
  const newlyDone = steps.filter((s) => s.done && !recorded.has(s.key));
  if (newlyDone.length) {
    for (const s of newlyDone) {
      recorded.add(s.key);
      void track(orgId, userId, 'setup_step_done', { step: s.key, app: 'people' });
    }
    await saveState(accountId, orgId, { ...state, recorded: [...recorded] }, userId).catch((e) => console.error('[people-setup]', e instanceof Error ? e.message : e));
  }

  const required = steps.filter((s) => !s.optional);
  const settled = required.every((s) => s.done || s.skipped);
  const simpleOn = Boolean(f.features.peopleSimpleMode);
  const reasons = simpleOn && !state.simpleAdvice ? await outgrownReasons(accountId, orgId, f.employees) : [];
  return {
    setup: {
      steps,
      done: required.filter((s) => s.done).length,
      total: required.length,
      show: !state.hidden && !settled,
    },
    simpleMode: { on: simpleOn, suggest: reasons.length > 0, reasons },
  };
}

export class SetupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Skip a step, bring it back, hide the list, or say the simple-mode suggestion was seen. */
export async function changeSetup(accountId: string, orgId: string, userId: string | null, body: { action?: string; step?: string }) {
  const state = await stateOf(orgId);
  const skipped = new Set(state.skipped || []);
  const action = String(body?.action || '');
  const step = String(body?.step || '');
  if (action === 'skip' || action === 'unskip') {
    if (!(SETUP_STEPS as string[]).includes(step)) throw new SetupError('Say which step: people, week, leave, app or payroll.');
    if (action === 'skip') skipped.add(step);
    else skipped.delete(step);
  } else if (action === 'hide') {
    state.hidden = new Date().toISOString();
  } else if (action === 'show') {
    state.hidden = null;
  } else if (action === 'simpleAdviceSeen') {
    state.simpleAdvice = new Date().toISOString();
  } else {
    throw new SetupError('Say what to do: skip, unskip, hide, show or simpleAdviceSeen.');
  }
  await saveState(accountId, orgId, { ...state, skipped: [...skipped] }, userId);
  return peopleSetup(accountId, orgId, userId);
}
