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
 * The steps (launch checklist, Stage 1): the company's structure, its people,
 * the working week and holidays, leave types, who approves, the employee app,
 * then two that hold nothing up: documents and Payroll. A company that had
 * begun setting up before structure and approvers were added keeps them as
 * optional (`era` 1), so a list it had finished does not come back.
 *
 * Beside it, simple mode's one-time suggestion: a company that has grown past
 * up to 10 people and up to 2 users is told once that the full menus exist,
 * never switched for.
 */

export const SIMPLE_MAX_EMPLOYEES = 10;
export const SIMPLE_MAX_USERS = 2;

export type SetupStepKey = 'structure' | 'people' | 'week' | 'leave' | 'approvers' | 'app' | 'documents' | 'payroll';
export const SETUP_STEPS: SetupStepKey[] = ['structure', 'people', 'week', 'leave', 'approvers', 'app', 'documents', 'payroll'];
/** The steps added on 13 Nov 2026 that hold the list open only for a company that started after them. */
const LATER_STEPS: SetupStepKey[] = ['structure', 'approvers'];

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

type SetupState = { skipped?: string[]; hidden?: string | null; recorded?: string[]; simpleAdvice?: string | null; era?: 1 | 2 | null };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const istYear = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 4);

/** Everything kept for the company's setup lists, as stored: People's own keys, and Attendance's under `attendance` (services/attendance/setup.ts). */
export async function readSetupState(orgId: string): Promise<Record<string, unknown>> {
  const row = await peoplePrisma.peopleSetting.findUnique({ where: { orgId }, select: { setupState: true } });
  return row?.setupState && typeof row.setupState === 'object' && !Array.isArray(row.setupState) ? { ...(row.setupState as Record<string, unknown>) } : {};
}

/** Changes the named keys and keeps the rest, so People's list and Attendance's do not write over each other. */
export async function writeSetupState(accountId: string, orgId: string, patch: Record<string, unknown>, userId: string | null) {
  const next = { ...(await readSetupState(orgId)), ...patch };
  await peoplePrisma.peopleSetting.upsert({
    where: { orgId },
    update: { setupState: next as any, updatedByUserId: userId },
    create: { accountId, orgId, setupState: next as any, updatedByUserId: userId },
  });
}

async function stateOf(orgId: string): Promise<SetupState> {
  const s = (await readSetupState(orgId)) as SetupState;
  return { skipped: Array.isArray(s.skipped) ? s.skipped : [], hidden: s.hidden || null, recorded: Array.isArray(s.recorded) ? s.recorded : [], simpleAdvice: s.simpleAdvice || null, era: s.era === 1 || s.era === 2 ? s.era : null };
}

const saveState = (accountId: string, orgId: string, state: SetupState, userId: string | null) => writeSetupState(accountId, orgId, state as Record<string, unknown>, userId);

/** Active users of the company (sign-ins, not employees). */
async function activeUsers(orgId: string) {
  const members = await platformPrisma.userOrgMembership.findMany({ where: { orgId }, select: { userId: true } });
  if (!members.length) return 0;
  return platformPrisma.user.count({ where: { id: { in: members.map((m) => m.userId) }, isActive: true } });
}

/** What the steps are made of, counted once. */
async function facts(accountId: string, orgId: string, now: Date) {
  const year = istYear(now);
  const [employees, settings, holidays, leaveTypes, appUsers, features, departments, managed, approvalRules, documents] = await Promise.all([
    peoplePrisma.employee.count({ where: { orgId, status: { not: 'LEFT' } } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { weeklyOffDays: true, defaultShiftId: true, leaveApproval: true } }),
    peoplePrisma.holiday.count({ where: { orgId, date: { startsWith: year } } }),
    peoplePrisma.leaveType.count({ where: { orgId, isActive: true } }),
    peoplePrisma.employee.count({ where: { orgId, status: { not: 'LEFT' }, portalPasswordSetAt: { not: null } } }),
    getFeatures(accountId, orgId),
    peoplePrisma.department.count({ where: { orgId, isActive: true } }),
    /* People with a manager on their record ("Reports to"): the person their requests can go to. */
    peoplePrisma.employee.count({ where: { orgId, status: { not: 'LEFT' }, reportingManagerId: { not: null } } }),
    peoplePrisma.approvalRule.count({ where: { orgId, active: true } }),
    /* Current files only: a replaced version is not a second document. */
    peoplePrisma.employeeDocument.count({ where: { orgId, supersededById: null } }),
  ]);
  /* A branch short of its state's national and festival holidays (holidayMinimum.ts), once some holidays are set. */
  const short = holidays ? (await holidayMinimum(orgId, year)).filter((b) => b.short) : [];
  return { year, employees, weekSet: Boolean(settings), holidays, leaveTypes, appUsers, payroll: Boolean(features.payroll), features, short, departments, managed, approvalRules, documents, leaveApproval: settings?.leaveApproval || 'HR' };
}

/** Who decides leave, as the company has it now, in words. */
const LEAVE_DECIDED_BY: Record<string, string> = { HR: 'HR decides leave', MANAGER: 'The manager decides leave', MANAGER_THEN_HR: 'The manager, then HR, decide leave' };

export type SetupFacts = Awaited<ReturnType<typeof facts>>;

export function buildSteps(f: SetupFacts, state: SetupState): SetupStep[] {
  const skipped = new Set(state.skipped || []);
  /* A company that began before the later steps existed is not held to them. */
  const later = (key: SetupStepKey) => state.era === 1 && LATER_STEPS.includes(key);
  const step = (s: Omit<SetupStep, 'skipped'>): SetupStep => ({ ...s, optional: s.optional || later(s.key), skipped: !s.done && skipped.has(s.key) });
  const weekDone = f.weekSet && f.holidays > 0;
  return [
    step({ key: 'structure', title: 'Set up departments', blurb: 'The departments people are filed under. Designations and branches are in Settings too.', detail: f.departments ? plural(f.departments, 'department') : 'No departments yet', done: f.departments > 0, optional: false, screen: 'departments' }),
    step({ key: 'people', title: 'Add your people', blurb: 'Everyone who works here, with a joining date. Add them one by one, or import a spreadsheet.', detail: f.employees ? plural(f.employees, 'person', 'people') : 'Nobody yet', done: f.employees > 0, optional: false, screen: 'employeeNew', alt: { label: 'Import', screen: 'employeeImport' } }),
    step({ key: 'week', title: 'Set the working week and holidays', blurb: 'Which days are off, and this year’s holidays, so leave counts only working days.', detail: [f.weekSet ? 'Working week set' : 'Working week not set', `${plural(f.holidays, 'holiday')} in ${f.year}`, ...(f.short || []).slice(0, 2).map((b) => `${b.branchName}: ${b.state} asks for ${b.minimum}, ${b.holidays} set`)].join(' · '), done: weekDone, optional: false, screen: f.weekSet ? 'holidays' : 'workingWeek' }),
    step({ key: 'leave', title: 'Pick your leave types', blurb: 'Start from your state’s rules (Karnataka, Maharashtra, Tamil Nadu, Delhi, Factories) and change what you need.', detail: f.leaveTypes ? plural(f.leaveTypes, 'leave type') : 'None yet', done: f.leaveTypes > 0, optional: false, screen: 'leaveTypes' }),
    step({ key: 'approvers', title: 'Say who approves requests', blurb: 'Give each person a manager on their record, or set an approval rule, so a request has somewhere to go.', detail: [LEAVE_DECIDED_BY[f.leaveApproval] || LEAVE_DECIDED_BY.HR, f.employees ? `${f.managed} of ${plural(f.employees, 'person', 'people')} ${f.employees === 1 ? 'has' : 'have'} a manager` : 'nobody has a manager yet', ...(f.approvalRules ? [plural(f.approvalRules, 'approval rule')] : [])].join(' · '), done: f.managed > 0 || f.approvalRules > 0, optional: false, screen: 'companyChoices', alt: { label: 'Approval rules', screen: 'approvalRules' } }),
    step({ key: 'app', title: 'Give your staff the employee app', blurb: 'They ask for leave, see their balance and holidays, and check in from their phone.', detail: f.appUsers ? `${plural(f.appUsers, 'person', 'people')} signed in` : 'Nobody signed in yet', done: f.appUsers > 0, optional: false, screen: 'selfService' }),
    step({ key: 'documents', title: 'Add people’s documents (optional)', blurb: 'ID proofs, contracts and certificates on each person’s record, with the date they run out.', detail: f.documents ? plural(f.documents, 'document') : 'None yet', done: f.documents > 0, optional: true, screen: 'documents' }),
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
  const [stored, f] = await Promise.all([stateOf(orgId), facts(accountId, orgId, now)]);
  /* The first look since the later steps came in: a company that had already begun (people on the list, or a step
     skipped, done or hidden before) is era 1; one starting now is era 2 and is asked for every step. */
  const begun = f.employees > 0 || Boolean(stored.hidden) || (stored.skipped || []).length > 0 || (stored.recorded || []).length > 0;
  const state: SetupState = { ...stored, era: stored.era || (begun ? 1 : 2) };
  const steps = buildSteps(f, state);

  const recorded = new Set(state.recorded || []);
  const newlyDone = steps.filter((s) => s.done && !recorded.has(s.key));
  if (newlyDone.length || !stored.era) {
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
    if (!(SETUP_STEPS as string[]).includes(step)) throw new SetupError(`Say which step: ${SETUP_STEPS.join(', ')}.`);
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
