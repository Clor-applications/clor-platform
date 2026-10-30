import { z } from 'zod';

import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { registerJob } from '../../jobRegistry.js';
import { isFeatureEnabled } from '../../features.js';
import { istDate } from '../../attendance/compute.js';
import { rulesOf } from '../../attendance/timeRules.js';

/**
 * Ready-made automations (WORKFLOW-GAP-RESEARCH-2026-10-30 A27, 4.7): a list of plain sentences with a
 * switch, at most one number each, not a workflow builder. Each recipe is wired to work CLOR already does
 * or to one daily job (`people.automations`, below):
 *
 *  - Recipes that ran before this screen existed (the task digest, probation and contract end dates,
 *    document expiry, the leave digest) start on and keep running; their switch now gates them.
 *  - The missing-punch reminder and the absence check have their own settings under Attendance rules;
 *    they show here as on or off and link there, so there is one place to change each.
 *  - Everything new starts off.
 *
 * Every recipe records what it sent per company and day (AutomationRun), so the screen shows the last
 * run, how many and to whom. The daily job claims each (company, recipe, day) with a unique row before
 * it sends anything, so two instances, or a wake call on top of the timer, send once.
 */

export type RecipeKey =
  | 'taskDigest' | 'firstDayPlan' | 'probationEnds' | 'contractEnds' | 'exitInterview' | 'clearanceDue' | 'finalPayDue'
  | 'leaveDigest' | 'leaveWaiting' | 'missingPunch' | 'absence' | 'documentExpiry' | 'policyAccept'
  | 'birthdays' | 'anniversaries' | 'wishNudge' | 'holidayHeadsUp';

export type Recipe = {
  key: RecipeKey;
  group: string;
  /** The sentence; `{n}` is where the number goes. */
  sentence: string;
  /** On for a company that never changed it: only what already ran before this screen. */
  defaultOn: boolean;
  n?: { default: number; min: number; max: number };
  /** Its own setting lives on another screen (read only here). */
  managedIn?: { screen: string; label: string };
  /** The background job (lease name) whose last run is "last checked". */
  job: string;
  /** When it runs, in words. */
  when: string;
};

export const RECIPES: Recipe[] = [
  { key: 'taskDigest', group: 'Joining and leaving', sentence: 'Send each task owner a morning list of joining and leaving tasks due or late', defaultOn: true, job: 'people.lifecycle', when: 'Every morning from 9' },
  { key: 'firstDayPlan', group: 'Joining and leaving', sentence: 'Send the joiner their first-day plan the day before they start', defaultOn: false, job: 'people.automations', when: 'Every morning' },
  { key: 'probationEnds', group: 'Joining and leaving', sentence: 'Tell HR when probation ends in {n} days, and on the day', defaultOn: true, n: { default: 14, min: 1, max: 60 }, job: 'people.end-dates', when: 'Once a day' },
  { key: 'contractEnds', group: 'Joining and leaving', sentence: 'Tell HR when a contract ends in {n} days, a week before, and on the day', defaultOn: true, n: { default: 30, min: 8, max: 90 }, job: 'people.end-dates', when: 'Once a day' },
  { key: 'exitInterview', group: 'Joining and leaving', sentence: 'Remind a leaver to fill the exit interview {n} days before their last day', defaultOn: false, n: { default: 2, min: 1, max: 30 }, job: 'people.automations', when: 'Every morning' },
  { key: 'clearanceDue', group: 'Joining and leaving', sentence: 'Remind sign-off owners of no-dues lines still open on the last working day', defaultOn: false, job: 'people.automations', when: 'Every morning' },
  { key: 'finalPayDue', group: 'Joining and leaving', sentence: 'Tell the owner the day before final pay is due, and on the day', defaultOn: false, job: 'people.automations', when: 'Every morning' },
  { key: 'leaveDigest', group: 'Leave and attendance', sentence: 'Send each approver a morning list of leave waiting for them', defaultOn: true, job: 'leave.automation', when: 'Every morning' },
  { key: 'leaveWaiting', group: 'Leave and attendance', sentence: 'Remind managers of leave waiting {n} days', defaultOn: false, n: { default: 2, min: 1, max: 14 }, job: 'people.automations', when: 'Every morning' },
  { key: 'missingPunch', group: 'Leave and attendance', sentence: 'Remind people who forgot to punch, and give managers the list', defaultOn: false, managedIn: { screen: 'attendanceRules', label: 'Attendance rules' }, job: 'attendance.punch-nudge', when: 'Every hour' },
  { key: 'absence', group: 'Leave and attendance', sentence: 'Tell HR when someone is absent several days with no word', defaultOn: false, managedIn: { screen: 'attendanceRules', label: 'Attendance rules' }, job: 'people.absence-check', when: 'Every morning' },
  { key: 'documentExpiry', group: 'Documents and policies', sentence: 'Tell HR when a document is about to expire: 60, 30 and 7 days before, and on the day', defaultOn: true, job: 'people.document-reminders', when: 'Once a day' },
  { key: 'policyAccept', group: 'Documents and policies', sentence: 'Remind employees to accept a policy after {n} days', defaultOn: false, n: { default: 3, min: 1, max: 30 }, job: 'people.automations', when: 'Every morning' },
  { key: 'birthdays', group: 'Celebrations and holidays', sentence: 'Tell the team on someone’s birthday', defaultOn: false, job: 'people.automations', when: 'Every morning' },
  { key: 'anniversaries', group: 'Celebrations and holidays', sentence: 'Tell the team on someone’s work anniversary', defaultOn: false, job: 'people.automations', when: 'Every morning' },
  { key: 'wishNudge', group: 'Celebrations and holidays', sentence: 'Remind a manager to wish their team member on the day', defaultOn: false, job: 'people.automations', when: 'Every morning' },
  { key: 'holidayHeadsUp', group: 'Celebrations and holidays', sentence: 'Tell everyone about a holiday the day before', defaultOn: false, job: 'people.automations', when: 'Every morning' },
];
export const RECIPE = new Map(RECIPES.map((r) => [r.key, r]));

export type Setting = { on: boolean; n: number | null };

const saved = async (orgId: string) => ((await peoplePrisma.engagementSettings.findUnique({ where: { orgId }, select: { automations: true } }))?.automations || {}) as Record<string, { on?: boolean; n?: number }>;

/** Every recipe's switch and number for a company: what it saved, else the defaults. */
export async function automationsFor(orgId: string): Promise<Record<RecipeKey, Setting>> {
  const s = await saved(orgId);
  const out = {} as Record<RecipeKey, Setting>;
  for (const r of RECIPES) {
    const mine = s[r.key] || {};
    const n = r.n ? Math.max(r.n.min, Math.min(r.n.max, Number.isFinite(Number(mine.n)) ? Math.round(Number(mine.n)) : r.n.default)) : null;
    out[r.key] = { on: typeof mine.on === 'boolean' ? mine.on : r.defaultOn, n };
  }
  return out;
}

/** One recipe's setting: whether the job should do it for this company, and its number. */
export async function automation(orgId: string, key: RecipeKey): Promise<Setting> {
  return (await automationsFor(orgId))[key];
}

export const saveSchema = z.object({
  automations: z.record(z.string(), z.object({ on: z.boolean().optional(), n: z.coerce.number().int().optional().nullable() })),
});

export class AutomationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Saves switches and numbers. Recipes managed elsewhere and unknown keys are refused, not ignored. */
export async function saveAutomations(who: { accountId: string; orgId: string; userId: string }, body: unknown) {
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) throw new AutomationError('Those settings could not be read.');
  const current = await saved(who.orgId);
  const next: Record<string, { on?: boolean; n?: number }> = { ...current };
  for (const [key, v] of Object.entries(parsed.data.automations)) {
    const r = RECIPE.get(key as RecipeKey);
    if (!r) throw new AutomationError('There is no such automation.');
    if (r.managedIn) throw new AutomationError(`This one is set under ${r.managedIn.label}.`);
    const row = { ...(next[key] || {}) };
    if (typeof v.on === 'boolean') row.on = v.on;
    if (v.n != null) {
      if (!r.n) throw new AutomationError('This automation has no number to set.');
      if (v.n < r.n.min || v.n > r.n.max) throw new AutomationError(`Choose ${r.n.min} to ${r.n.max} days.`);
      row.n = v.n;
    }
    next[key] = row;
  }
  await peoplePrisma.engagementSettings.upsert({
    where: { orgId: who.orgId },
    create: { accountId: who.accountId, orgId: who.orgId, automations: next as any, updatedByUserId: who.userId },
    update: { automations: next as any, updatedByUserId: who.userId },
  });
  return automationsFor(who.orgId);
}

// ---------------------------------------------------------------------------
// What each recipe sent
// ---------------------------------------------------------------------------

const todayIst = (now = new Date()) => istDate(now);

/**
 * Adds to a recipe's count for the day, with who got it (names, at most 20). Never throws: a record of a
 * reminder must not stop the reminder. Called by the jobs that already existed, after they sent.
 */
export async function recordRun(accountId: string, orgId: string, key: RecipeKey, count: number, recipients: string[] = [], now = new Date()) {
  if (!count) return;
  const ranOn = todayIst(now);
  try {
    await peoplePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`automation-run:${orgId}:${key}:${ranOn}`}))`;
      const row = await tx.automationRun.findUnique({ where: { orgId_key_ranOn: { orgId, key, ranOn } } });
      const names = [...new Set([...((row?.recipients as string[]) || []), ...recipients])].slice(0, 20);
      if (row) await tx.automationRun.update({ where: { id: row.id }, data: { count: row.count + count, recipients: names } });
      else await tx.automationRun.create({ data: { accountId, orgId, key, ranOn, count, recipients: names } });
    });
  } catch (e) {
    console.error(`[automations] run not recorded ${key}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * The daily job's claim on one recipe for one company and day: the unique row is made before anything is
 * sent, so a second instance, or a second wake the same day, finds it and does nothing. Returns whether
 * this caller holds it.
 */
export async function claimDay(accountId: string, orgId: string, key: RecipeKey, ranOn: string) {
  const made = await peoplePrisma.automationRun.createMany({ data: [{ accountId, orgId, key, ranOn, count: 0, recipients: [] }], skipDuplicates: true });
  return made.count === 1;
}

async function finishDay(orgId: string, key: RecipeKey, ranOn: string, count: number, recipients: string[]) {
  await peoplePrisma.automationRun.updateMany({ where: { orgId, key, ranOn }, data: { count, recipients: [...new Set(recipients)].slice(0, 20) } });
}

/** The screen: every recipe with its setting, last run (by this company), how many, to whom, and the next run. */
export async function listAutomations(orgId: string, now = new Date()) {
  const today = todayIst(now);
  const [settings, runs, attendance, jobRuns, ranToday] = await Promise.all([
    automationsFor(orgId),
    peoplePrisma.automationRun.findMany({ where: { orgId, count: { gt: 0 } }, orderBy: { ranOn: 'desc' }, take: 400 }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId } }),
    platformPrisma.jobRun.findMany({ where: { worker: { in: [...new Set(RECIPES.map((r) => r.job))] }, outcome: 'OK' }, orderBy: { startedAt: 'desc' }, take: 200, select: { worker: true, startedAt: true } }).catch(() => []),
    /* Today's claims, sent or not: a recipe that ran this morning with nobody to tell runs again tomorrow. */
    peoplePrisma.automationRun.findMany({ where: { orgId, ranOn: today }, select: { key: true } }),
  ]);
  const doneToday = new Set(ranToday.map((r) => r.key));
  const time = rulesOf(attendance);
  const lastOf = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastOf.has(r.key)) lastOf.set(r.key, r);
  const checked = new Map<string, Date>();
  for (const j of jobRuns) if (!checked.has(j.worker)) checked.set(j.worker, j.startedAt);
  return RECIPES.map((r) => {
    const s = r.key === 'missingPunch' ? { on: Boolean(time.nudge.on), n: null } : r.key === 'absence' ? { on: Boolean(time.absence.on), n: null } : settings[r.key];
    const last = lastOf.get(r.key);
    const lastChecked = checked.get(r.job) || null;
    return {
      key: r.key,
      group: r.group,
      sentence: r.sentence,
      on: s.on,
      n: s.n,
      range: r.n ? { min: r.n.min, max: r.n.max } : null,
      defaultOn: r.defaultOn,
      managedIn: r.managedIn || null,
      when: r.when,
      lastRun: last ? { on: last.ranOn, count: last.count, recipients: last.recipients as string[] } : null,
      lastChecked,
      nextRun: !s.on ? null : r.job === 'people.automations' ? (doneToday.has(r.key) ? 'Tomorrow morning' : istHour(now) < 8 ? 'This morning' : 'Within the hour') : r.when,
    };
  });
}

const istHour = (now: Date) => new Date(now.getTime() + 330 * 60_000).getUTCHours();

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

export type RecipeRun = (ctx: { accountId: string; orgId: string; today: string; n: number | null; now: Date }) => Promise<{ count: number; recipients: string[] }>;

/** The recipes this job runs, filled in by the modules that own them (clearance, exit interviews, greetings, reminders). */
const runners = new Map<RecipeKey, RecipeRun>();
export function registerRecipe(key: RecipeKey, run: RecipeRun) {
  runners.set(key, run);
}

/** One company's day: each recipe that is on and has a runner, claimed for the day first. */
export async function runCompany(accountId: string, orgId: string, now = new Date()) {
  const today = todayIst(now);
  const settings = await automationsFor(orgId);
  const done: Record<string, number> = {};
  for (const [key, run] of runners) {
    const s = settings[key];
    if (!s?.on) continue;
    if (!(await claimDay(accountId, orgId, key, today))) continue;
    try {
      const out = await run({ accountId, orgId, today, n: s.n, now });
      await finishDay(orgId, key, today, out.count, out.recipients);
      done[key] = out.count;
    } catch (e) {
      /* A failed recipe gives its claim back, so the next wake today tries it again. */
      await peoplePrisma.automationRun.deleteMany({ where: { orgId, key, ranOn: today, count: 0 } }).catch(() => undefined);
      console.error(`[automations] ${orgId} ${key}:`, e instanceof Error ? e.message : e);
    }
  }
  return done;
}

export async function runAutomations(now = new Date()) {
  /* Only companies that turned something on are visited: a saved row is where a switch lives. */
  const orgs = await outsideTenant('job: automations', () => peoplePrisma.engagementSettings.findMany({ select: { accountId: true, orgId: true } }));
  let ran = 0;
  for (const o of orgs) {
    try {
      if (!(await isFeatureEnabled(o.accountId, o.orgId, 'people'))) continue;
      const done = await runInTenant(o.orgId, () => runCompany(o.accountId, o.orgId, now));
      ran += Object.keys(done).length;
    } catch (e) {
      console.error(`[automations] ${o.orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return ran;
}

/** Hourly under a lease; from 8 in the morning IST the day's recipes run, each once per company. */
export function startPeopleAutomations({ intervalMs = 3_600_000, startupDelayMs = 200_000 } = {}) {
  const tick = () =>
    exclusive('people.automations', leaseFor(intervalMs), async () => {
      if (istHour(new Date()) >= 8) return runAutomations();
      return 0;
    }).catch((e) => {
      console.error('[automations] failed:', e instanceof Error ? e.message : e);
      throw e;
    });
  registerJob('startPeopleAutomations', tick, intervalMs);
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const timed = () => tick().catch(() => {});
  const t = setTimeout(() => {
    timed();
    const i = setInterval(timed, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
