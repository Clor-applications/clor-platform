import { z } from 'zod';

import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { registerJob } from '../../jobRegistry.js';
import { isFeatureEnabled } from '../../features.js';
import { deliver, sendTemplate } from '../../mailer.js';
import { istDate } from '../../attendance/compute.js';
import { rulesOf } from '../../attendance/timeRules.js';
import { usersHoldingRoles, usersWithPermission } from '../../notifications.js';
import { todayIst } from '../../../utils/istDate.js';

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
 * it sends anything, so two instances, or a wake call on top of the timer, send once. A run that failed
 * part way is run again on the next wake (`retry`); notices carry dedupe keys and mail goes through
 * `mailOnce`, so only what did not go the first time goes then.
 *
 * The list is a registry: any module adds its own recipes with `defineRecipe({ module: 'payroll', ... })`
 * from its own file, and they show on that module's Automations screen (routes/automations.ts). A recipe
 * may let the company choose who hears (`recipients`, read by the job through `recipientUsers`) and turn
 * channels off (`chooseChannels`). Everything is saved in EngagementSettings.automations, keyed by the
 * recipe's id: People's under their old keys, others' as `module.key`.
 */

/** The recipes the daily job runs, filled in by the modules that own them (`defineRecipe({ run })` or `registerRecipe`). */
const runners = new Map<RecipeKey, RecipeRun>();

/** The People recipes, by the keys they were saved under before the registry: those keys never change. */
export type PeopleRecipeKey =
  | 'taskDigest' | 'firstDayPlan' | 'probationEnds' | 'contractEnds' | 'exitInterview' | 'clearanceDue' | 'finalPayDue'
  | 'leaveDigest' | 'leaveWaiting' | 'missingPunch' | 'absence' | 'documentExpiry' | 'policyAccept'
  | 'birthdays' | 'anniversaries' | 'wishNudge' | 'holidayHeadsUp';

/** The app whose Automations screen lists a recipe, and whose switch (features) gates the daily job's run of it. */
export type AutomationModule = 'people' | 'attendance' | 'payroll' | 'workspace';
export const MODULES: readonly AutomationModule[] = ['people', 'attendance', 'payroll', 'workspace'];
/** A People recipe is saved under its own key; another module's under `module.key` (`payroll.payslipReady`). */
export type RecipeKey = PeopleRecipeKey | `${Exclude<AutomationModule, 'people'>}.${string}`;

/** bell: the in-app bell; app: the employee app; email: mail through the company's outbox. */
export type Channel = 'bell' | 'app' | 'email';
export const CHANNELS: readonly Channel[] = ['bell', 'app', 'email'];
/** Who a recipe tells: HR (whoever may edit employees, administrators too), the owner, the person's manager, or one named user. */
export type RecipientKind = 'HR' | 'OWNER' | 'MANAGER' | 'PERSON';
/** 'HR' | 'OWNER' | 'MANAGER' | 'PERSON:<userId>' */
export type Recipient = string;

export type RecipeDef = {
  module: AutomationModule;
  /** Letters and digits, unique within the module; for People, the key it was always saved under. */
  key: string;
  group: string;
  /** The sentence; `{n}` is where the number goes. */
  sentence: string;
  /** On for a company that never changed it. */
  defaultOn: boolean;
  n?: { default: number; min: number; max: number };
  /** Its own setting lives on another screen (read only here); `isOn` reads that setting for the list. */
  managedIn?: { screen: string; label: string; isOn?: (orgId: string) => Promise<boolean> };
  /** The background job (lease name) whose last run is "last checked". */
  job: string;
  /** When it runs, in words. */
  when: string;
  /** What it sends by. With `chooseChannels`, a company may turn any of them off (one always stays), and the job must read `channels`. */
  channels: Channel[];
  chooseChannels?: boolean;
  /** Who it tells, when the company may choose: the job reads `to` through `recipientUsers`. `label` heads the choice ("Goes to"). */
  recipients?: { default: Recipient[]; options: RecipientKind[]; label?: string };
  /** The daily job's work for this recipe (`people.automations`, once per company and day), when it has no job of its own. */
  run?: RecipeRun;
};
export type Recipe = RecipeDef & { id: RecipeKey };

/** Every recipe, in the order defined: People's below, other modules' from their own files (`defineRecipe`). */
export const RECIPE = new Map<string, Recipe>();
export const recipeId = (module: AutomationModule, key: string) => (module === 'people' ? key : `${module}.${key}`) as RecipeKey;

const recipientOk = (r: Recipient, options: RecipientKind[]) => {
  const parts = String(r).split(':');
  if (!options.includes(parts[0] as RecipientKind)) return false;
  return parts[0] === 'PERSON' ? parts.length === 2 && Boolean(parts[1]) : parts.length === 1;
};

/**
 * Adds a recipe to its module's Automations screen and, with `run`, to the daily job. Called once per recipe
 * at import; a second definition of the same id is a mistake and throws.
 */
export function defineRecipe(def: RecipeDef): Recipe {
  if (!MODULES.includes(def.module)) throw new Error(`Unknown automation module ${def.module}`);
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(def.key)) throw new Error(`Automation key ${def.key} must be letters and digits`);
  const id = recipeId(def.module, def.key);
  if (RECIPE.has(id)) throw new Error(`Automation ${id} is defined twice`);
  if (!def.channels.length || def.channels.some((c) => !CHANNELS.includes(c))) throw new Error(`Automation ${id} needs channels from ${CHANNELS.join(', ')}`);
  if (def.recipients && (!def.recipients.default.length || def.recipients.default.some((r) => !recipientOk(r, def.recipients!.options)))) throw new Error(`Automation ${id}: default recipients must be among its options`);
  const r: Recipe = { ...def, id };
  RECIPE.set(id, r);
  if (def.run) runners.set(id, def.run);
  return r;
}

/** The recipes of one module (or all), in the order defined. */
export const recipesOf = (module?: AutomationModule) => [...RECIPE.values()].filter((r) => !module || r.module === module);

const people = (key: PeopleRecipeKey, group: string, sentence: string, rest: Omit<RecipeDef, 'module' | 'key' | 'group' | 'sentence'>) => defineRecipe({ module: 'people', key, group, sentence, ...rest });
const attendanceRule = (pick: (t: ReturnType<typeof rulesOf>) => unknown) => async (orgId: string) => Boolean(pick(rulesOf(await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } }))));
const JL = 'Joining and leaving';
const LA = 'Leave and attendance';
const DP = 'Documents and policies';
const CH = 'Celebrations and holidays';
const MORNING = { job: 'people.automations', when: 'Every morning' };
const TO_HR = { default: ['HR'], options: ['HR', 'OWNER', 'MANAGER', 'PERSON'] as RecipientKind[] };

people('taskDigest', JL, 'Send each task owner a morning list of joining and leaving tasks due or late', { defaultOn: true, job: 'people.lifecycle', when: 'Every morning from 9', channels: ['bell', 'email'], chooseChannels: true, recipients: { default: ['HR'], options: ['HR', 'OWNER', 'PERSON'], label: 'Tasks 3 days late also go to' } });
people('firstDayPlan', JL, 'Send the joiner their first-day plan the day before they start', { defaultOn: false, ...MORNING, channels: ['email', 'bell'] });
people('probationEnds', JL, 'Warn when probation ends in {n} days, and on the day', { defaultOn: true, n: { default: 14, min: 1, max: 60 }, job: 'people.end-dates', when: 'Once a day', channels: ['bell'], recipients: TO_HR });
people('contractEnds', JL, 'Warn when a contract ends in {n} days, a week before, and on the day', { defaultOn: true, n: { default: 30, min: 8, max: 90 }, job: 'people.end-dates', when: 'Once a day', channels: ['bell'], recipients: TO_HR });
people('exitInterview', JL, 'Remind a leaver to fill the exit interview {n} days before their last day', { defaultOn: false, n: { default: 2, min: 1, max: 30 }, ...MORNING, channels: ['email', 'bell'] });
people('clearanceDue', JL, 'Remind sign-off owners of no-dues lines still open on the last working day', { defaultOn: false, ...MORNING, channels: ['bell'] });
people('finalPayDue', JL, 'Tell the owner the day before final pay is due, and on the day', { defaultOn: false, ...MORNING, channels: ['bell'] });
people('leaveDigest', LA, 'Send each approver a morning list of leave waiting for them', { defaultOn: true, job: 'leave.automation', when: 'Every morning', channels: ['bell', 'email'] });
people('leaveWaiting', LA, 'Remind managers of leave waiting {n} days', { defaultOn: false, n: { default: 2, min: 1, max: 14 }, ...MORNING, channels: ['bell'] });
people('missingPunch', LA, 'Remind people who forgot to punch, and give managers the list', { defaultOn: false, managedIn: { screen: 'attendanceRules', label: 'Attendance rules', isOn: attendanceRule((t) => t.nudge.on) }, job: 'attendance.punch-nudge', when: 'Every hour', channels: ['bell', 'app'] });
people('absence', LA, 'Tell HR when someone is absent several days with no word', { defaultOn: false, managedIn: { screen: 'attendanceRules', label: 'Attendance rules', isOn: attendanceRule((t) => t.absence.on) }, job: 'people.absence-check', when: 'Every morning', channels: ['bell', 'email'] });
people('documentExpiry', DP, 'Tell HR when a document is about to expire: 60, 30 and 7 days before, and on the day', { defaultOn: true, job: 'people.document-reminders', when: 'Once a day', channels: ['bell', 'email'] });
people('policyAccept', DP, 'Remind employees to accept a policy after {n} days', { defaultOn: false, n: { default: 3, min: 1, max: 30 }, ...MORNING, channels: ['bell'] });
people('birthdays', CH, 'Tell the team on someone’s birthday', { defaultOn: false, ...MORNING, channels: ['bell', 'app'] });
people('anniversaries', CH, 'Tell the team on someone’s work anniversary', { defaultOn: false, ...MORNING, channels: ['bell', 'app'] });
people('wishNudge', CH, 'Remind a manager to wish their team member on the day', { defaultOn: false, ...MORNING, channels: ['bell'] });
people('holidayHeadsUp', CH, 'Tell everyone about a holiday the day before', { defaultOn: false, ...MORNING, channels: ['bell', 'app'] });

/** The People recipes (kept for callers that read the old list). */
export const RECIPES: Recipe[] = recipesOf('people');

export type Setting = { on: boolean; n: number | null; to: Recipient[] | null; channels: Channel[] };
type Saved = { on?: boolean; n?: number; to?: string[]; channels?: string[] };

const saved = async (orgId: string) => ((await peoplePrisma.engagementSettings.findUnique({ where: { orgId }, select: { automations: true } }))?.automations || {}) as Record<string, Saved>;

/** One recipe's setting from what the company saved, else its defaults. A saved choice no longer offered falls back to the default. */
function settingOf(r: Recipe, mine: Saved = {}): Setting {
  const n = r.n ? Math.max(r.n.min, Math.min(r.n.max, Number.isFinite(Number(mine.n)) ? Math.round(Number(mine.n)) : r.n.default)) : null;
  const to = r.recipients ? (Array.isArray(mine.to) && mine.to.length && mine.to.every((x) => recipientOk(x, r.recipients!.options)) ? mine.to : r.recipients.default) : null;
  const chosen = r.chooseChannels && Array.isArray(mine.channels) ? r.channels.filter((c) => mine.channels!.includes(c)) : [];
  return { on: typeof mine.on === 'boolean' ? mine.on : r.defaultOn, n, to, channels: chosen.length ? chosen : [...r.channels] };
}

/** Every recipe's switch, number, recipients and channels for a company: what it saved, else the defaults. */
export async function automationsFor(orgId: string): Promise<Record<RecipeKey, Setting>> {
  const s = await saved(orgId);
  const out = {} as Record<RecipeKey, Setting>;
  for (const r of RECIPE.values()) out[r.id] = settingOf(r, s[r.id]);
  return out;
}

/** One recipe's setting: whether the job should do it for this company, its number, who and how. */
export async function automation(orgId: string, key: RecipeKey): Promise<Setting> {
  const r = RECIPE.get(key);
  if (!r) throw new Error(`No automation ${key}`);
  return settingOf(r, (await saved(orgId))[key]);
}

export const saveSchema = z.object({
  automations: z.record(z.string(), z.object({
    on: z.boolean().optional(),
    n: z.coerce.number().int().optional().nullable(),
    to: z.array(z.string().max(80)).max(10).optional(),
    channels: z.array(z.string().max(10)).max(3).optional(),
  })),
});

export class AutomationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Active users of the company (all, or those of `ids`): who "a named person" may be. */
export async function companyUsers(orgId: string, ids?: string[]) {
  const members = await platformPrisma.userOrgMembership.findMany({ where: { orgId, ...(ids ? { userId: { in: ids } } : {}) }, select: { userId: true } });
  if (!members.length) return [] as Array<{ id: string; fullName: string }>;
  return platformPrisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) }, isActive: true }, select: { id: true, fullName: true }, orderBy: [{ fullName: 'asc' }, { id: 'asc' }] });
}

/**
 * Saves switches, numbers, recipients and channels for one module's recipes. Recipes managed elsewhere, other
 * modules' recipes and unknown keys are refused, not ignored, and so is a choice the recipe does not offer.
 */
export async function saveAutomations(who: { accountId: string; orgId: string; userId: string }, body: unknown, module: AutomationModule = 'people') {
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) throw new AutomationError('Those settings could not be read.');
  /* Read and written under one lock per company: two saves at once (two tabs) each keep the other's change. */
  await peoplePrisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`automations:${who.orgId}`}))`;
  const current = ((await tx.engagementSettings.findUnique({ where: { orgId: who.orgId }, select: { automations: true } }))?.automations || {}) as Record<string, Saved>;
  const next: Record<string, Saved> = { ...current };
  for (const [key, v] of Object.entries(parsed.data.automations)) {
    const r = RECIPE.get(key);
    if (!r || r.module !== module) throw new AutomationError('There is no such automation.');
    if (r.managedIn) throw new AutomationError(`This one is set under ${r.managedIn.label}.`);
    const row = { ...(next[key] || {}) };
    if (typeof v.on === 'boolean') row.on = v.on;
    if (v.n != null) {
      if (!r.n) throw new AutomationError('This automation has no number to set.');
      if (v.n < r.n.min || v.n > r.n.max) throw new AutomationError(`Choose ${r.n.min} to ${r.n.max} days.`);
      row.n = v.n;
    }
    if (v.to) {
      if (!r.recipients) throw new AutomationError('Who this one goes to is fixed.');
      const to = [...new Set(v.to)];
      if (!to.length) throw new AutomationError('Choose at least one person to tell.');
      if (to.some((x) => !recipientOk(x, r.recipients!.options))) throw new AutomationError('This automation cannot go to that choice.');
      const named = to.filter((x) => x.startsWith('PERSON:')).map((x) => x.slice(7));
      if (named.length && (await companyUsers(who.orgId, named)).length !== named.length) throw new AutomationError('That person is not a user of this company.');
      row.to = to;
    }
    if (v.channels) {
      if (!r.chooseChannels) throw new AutomationError('How this one is sent is fixed.');
      const ch = [...new Set(v.channels)];
      if (!ch.length) throw new AutomationError('Keep at least one way to send it.');
      if (ch.some((c) => !r.channels.includes(c as Channel))) throw new AutomationError('This automation cannot be sent that way.');
      row.channels = ch;
    }
    next[key] = row;
  }
  await tx.engagementSettings.upsert({
    where: { orgId: who.orgId },
    create: { accountId: who.accountId, orgId: who.orgId, automations: next as any, updatedByUserId: who.userId },
    update: { automations: next as any, updatedByUserId: who.userId },
  });
  });
  return automationsFor(who.orgId);
}

// ---------------------------------------------------------------------------
// Who a recipe tells
// ---------------------------------------------------------------------------

const MANAGES_PEOPLE = 'PEOPLE::Employees::EDIT';

/** The owner: holders of the administrator role named Owner, else every administrator. */
export async function ownerUsers(accountId: string, orgId: string) {
  const roles = await platformPrisma.role.findMany({ where: { accountId, orgId, roleType: 'ADMIN' }, select: { id: true, name: true } });
  const owners = await usersHoldingRoles(accountId, orgId, roles.filter((r) => r.name === 'Owner').map((r) => r.id));
  return owners.length ? owners : usersHoldingRoles(accountId, orgId, roles.map((r) => r.id));
}

/**
 * The users a recipe's `to` names, each once, in the order chosen: HR as before (whoever may edit employees,
 * administrators included), the owner, the reporting manager of `employeeId` when they sign in and still
 * work here, and named users still active in the company. A choice that resolves to nobody (the named
 * person left, the person has no manager) falls back to `fallback` (the recipe's default; HR when not said),
 * so a reminder is never sent to no one.
 */
export async function recipientUsers(ctx: { accountId: string; orgId: string }, to: Recipient[] | null, opts: { employeeId?: string | null; fallback?: Recipient[] } = {}): Promise<string[]> {
  const out = await resolve(ctx, to, opts.employeeId);
  if (out.length) return out;
  const fallback = opts.fallback || ['HR'];
  return fallback.join() === (to || []).join() ? out : resolve(ctx, fallback, opts.employeeId);
}

async function resolve(ctx: { accountId: string; orgId: string }, to: Recipient[] | null, employeeId?: string | null): Promise<string[]> {
  const opts = { employeeId };
  const out: string[] = [];
  for (const r of to || []) {
    const [kind, id] = r.split(':');
    if (kind === 'HR') out.push(...(await usersWithPermission(ctx.accountId, ctx.orgId, MANAGES_PEOPLE).catch(() => [] as string[])));
    else if (kind === 'OWNER') out.push(...(await ownerUsers(ctx.accountId, ctx.orgId).catch(() => [] as string[])));
    else if (kind === 'MANAGER' && opts.employeeId) {
      const e = await peoplePrisma.employee.findFirst({ where: { orgId: ctx.orgId, id: opts.employeeId }, select: { reportingManagerId: true } });
      const m = e?.reportingManagerId ? await peoplePrisma.employee.findFirst({ where: { orgId: ctx.orgId, id: e.reportingManagerId, status: { notIn: ['LEFT', 'SUSPENDED'] } }, select: { userId: true } }) : null;
      if (m?.userId) out.push(...(await companyUsers(ctx.orgId, [m.userId])).map((u) => u.id));
    } else if (kind === 'PERSON' && id) out.push(...(await companyUsers(ctx.orgId, [id])).map((u) => u.id));
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// What each recipe sent
// ---------------------------------------------------------------------------


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
  if (made.count === 1) return true;
  /* Already run today: only a run that failed part way is taken again, and by one caller. */
  const again = await peoplePrisma.automationRun.updateMany({ where: { orgId, key, ranOn, retry: true }, data: { retry: false } });
  return again.count === 1;
}

const runAgain = (orgId: string, key: RecipeKey, ranOn: string) => peoplePrisma.automationRun.updateMany({ where: { orgId, key, ranOn }, data: { retry: true } }).catch(() => undefined);

/**
 * Mail has no dedupe of its own: sent once per template and subject record in a day, whichever run asks. A
 * message that failed is delivered again rather than written twice. SENT, FAILED, or SKIPPED (switched off
 * for the company, or already gone).
 */
/** How long a queued message may be in someone's hands before it counts as left behind. */
const MAIL_IN_FLIGHT_MS = 15 * 60_000;

export async function mailOnce(opts: Parameters<typeof sendTemplate>[0], now = new Date()): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
  try {
    const earlier = await platformPrisma.emailOutbox.findFirst({ where: { orgId: opts.orgId, templateKey: opts.templateKey, relatedType: opts.relatedType, relatedId: opts.relatedId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, updatedAt: true } });
    if (earlier && (earlier.status === 'SENT' || earlier.status === 'SUPPRESSED')) return 'SKIPPED';
    if (earlier) {
      /*
       * Claimed before it is sent again: a FAILED row is taken back to QUEUED, which the mailer's own retry
       * (retryFailed reads FAILED only) and a second run then leave alone. A QUEUED row is someone's send in
       * flight, and is taken only once it has sat untouched long enough to be a crash's leftover.
       */
      const stale = new Date(now.getTime() - MAIL_IN_FLIGHT_MS);
      const claim = await platformPrisma.emailOutbox.updateMany({
        where: earlier.status === 'FAILED' ? { id: earlier.id, status: 'FAILED' } : { id: earlier.id, status: 'QUEUED', updatedAt: { lt: stale } },
        data: { status: 'QUEUED' },
      });
      if (!claim.count) return 'SKIPPED';
    }
    const row = earlier ? await deliver(earlier.id, opts.accountId, opts.orgId) : await sendTemplate(opts);
    return row?.status === 'SENT' ? 'SENT' : row?.status === 'SUPPRESSED' ? 'SKIPPED' : 'FAILED';
  } catch (e) {
    console.error('[automations] mail not sent:', e instanceof Error ? e.message : e);
    return 'FAILED';
  }
}

/**
 * The screen: one module's recipes with their setting, last run (by this company), how many, to whom, and the
 * next run. Who got it names people and the documents they hold, so `showRuns` is the editor's alone.
 */
export async function listAutomations(orgId: string, opts: { module?: AutomationModule; showRuns?: boolean; now?: Date } = {}) {
  const now = opts.now || new Date();
  const today = todayIst(now);
  const list = recipesOf(opts.module || 'people');
  const ids = list.map((r) => r.id as string);
  const [settings, runs, jobRuns, ranToday, managed] = await Promise.all([
    automationsFor(orgId),
    peoplePrisma.automationRun.findMany({ where: { orgId, key: { in: ids }, count: { gt: 0 } }, orderBy: { ranOn: 'desc' }, take: 400 }),
    platformPrisma.jobRun.findMany({ where: { worker: { in: [...new Set(list.map((r) => r.job))] }, outcome: 'OK' }, orderBy: { startedAt: 'desc' }, take: 200, select: { worker: true, startedAt: true } }).catch(() => []),
    /* Today's claims, sent or not: a recipe that ran this morning with nobody to tell runs again tomorrow. */
    peoplePrisma.automationRun.findMany({ where: { orgId, key: { in: ids }, ranOn: today }, select: { key: true } }),
    Promise.all(list.map(async (r) => [r.id, r.managedIn?.isOn ? await r.managedIn.isOn(orgId) : null] as const)),
  ]);
  const elsewhere = new Map(managed);
  const doneToday = new Set(ranToday.map((r) => r.key));
  const lastOf = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastOf.has(r.key)) lastOf.set(r.key, r);
  const checked = new Map<string, Date>();
  for (const j of jobRuns) if (!checked.has(j.worker)) checked.set(j.worker, j.startedAt);
  const named = [...new Set(list.flatMap((r) => settings[r.id].to || []).filter((x) => x.startsWith('PERSON:')).map((x) => x.slice(7)))];
  const names = new Map((named.length ? await companyUsers(orgId, named) : []).map((u) => [u.id, u.fullName]));
  return list.map((r) => {
    const own = settings[r.id];
    const s = r.managedIn ? { ...own, on: Boolean(elsewhere.get(r.id)), n: null } : own;
    const last = lastOf.get(r.id);
    const lastChecked = checked.get(r.job) || null;
    return {
      key: r.id,
      module: r.module,
      group: r.group,
      sentence: r.sentence,
      on: s.on,
      n: s.n,
      range: r.n ? { min: r.n.min, max: r.n.max } : null,
      defaultOn: r.defaultOn,
      managedIn: r.managedIn ? { screen: r.managedIn.screen, label: r.managedIn.label } : null,
      when: r.when,
      /* Who it goes to: each choice with the words for it; a named person who has left the company drops out. */
      /*
       * Who it goes to. A named person's name is the editor's to read (as who was told is): a reader sees "a
       * named person". A named person no longer an active user stays listed as gone, so the editor sees why
       * the default hears instead.
       */
      to: s.to ? s.to.map((v) => (!v.startsWith('PERSON:') ? { value: v, label: null } : !opts.showRuns ? { value: 'PERSON', label: null } : names.has(v.slice(7)) ? { value: v, label: names.get(v.slice(7))! } : { value: v, label: null, gone: true })) : null,
      fallback: r.recipients ? r.recipients.default : null,
      recipients: r.recipients ? { options: r.recipients.options, label: r.recipients.label || 'Goes to' } : null,
      channels: s.channels,
      channelOptions: r.chooseChannels ? r.channels : null,
      lastRun: last && opts.showRuns ? { on: last.ranOn, count: last.count, recipients: last.recipients as string[] } : null,
      lastChecked,
      nextRun: !s.on ? null : r.job === 'people.automations' ? (doneToday.has(r.id) || (GREETINGS.has(r.id) && istHour(now) >= GREET_UNTIL) ? 'Tomorrow morning' : istHour(now) < SEND_FROM ? 'This morning' : 'Within the hour') : r.when,
    };
  });
}

/** What one recipe sent, day by day, newest first: the editor's "History". */
export async function automationHistory(orgId: string, key: string, limit = 30) {
  if (!RECIPE.has(key)) throw new AutomationError('There is no such automation.', 404);
  const rows = await peoplePrisma.automationRun.findMany({ where: { orgId, key, count: { gt: 0 } }, orderBy: { ranOn: 'desc' }, take: Math.max(1, Math.min(90, limit)) });
  return rows.map((r) => ({ on: r.ranOn, count: r.count, recipients: r.recipients as string[] }));
}

const istHour = (now: Date) => new Date(now.getTime() + 330 * 60_000).getUTCHours();
/**
 * The hours, India time, the daily job runs in: from 08:00. Greetings (a birthday, an anniversary, the wish
 * nudge, the holiday heads-up) also stop at 20:00, so one switched on late in the evening waits for the
 * morning. The time-critical ones (final pay, no-dues, the exit interview) run whenever the job wakes after
 * 08:00, as before: a final-pay notice held overnight would cost a day of the two-working-day clock.
 */
export const SEND_FROM = 8;
export const GREET_UNTIL = 20;
export const GREETINGS: ReadonlySet<string> = new Set<RecipeKey>(['birthdays', 'anniversaries', 'wishNudge', 'holidayHeadsUp']);
export const inSendingHours = (now = new Date()) => istHour(now) >= SEND_FROM;
export const mayRunNow = (key: RecipeKey, now = new Date()) => inSendingHours(now) && (!GREETINGS.has(key) || istHour(now) < GREET_UNTIL);

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

/** `failed`: how many could not be sent, so the next wake runs the recipe again for those. `to` and `channels` are the company's choice. */
export type RecipeRun = (ctx: { accountId: string; orgId: string; today: string; n: number | null; now: Date; to: Recipient[] | null; channels: Channel[] }) => Promise<{ count: number; recipients: string[]; failed?: number }>;

/** Gives a defined recipe its daily work (clearance, exit interviews, greetings, reminders do this from their own files). */
export function registerRecipe(key: RecipeKey, run: RecipeRun) {
  if (!RECIPE.has(key)) throw new Error(`Automation ${key} is not defined`);
  runners.set(key, run);
}

/** The modules the daily job may run for a company: each module's own switch (Workspace is always there). */
const moduleOn = (accountId: string, orgId: string) => {
  const seen = new Map<AutomationModule, Promise<boolean>>();
  return (m: AutomationModule) => {
    if (m === 'workspace') return Promise.resolve(true);
    if (!seen.has(m)) seen.set(m, isFeatureEnabled(accountId, orgId, m).catch(() => false));
    return seen.get(m)!;
  };
};

/** One company's day: each recipe that is on and has a runner, claimed for the day first. */
export async function runCompany(accountId: string, orgId: string, now = new Date(), opts: { respectHours?: boolean; moduleOn?: (m: AutomationModule) => Promise<boolean> } = {}) {
  const today = todayIst(now);
  const settings = await automationsFor(orgId);
  const done: Record<string, number> = {};
  for (const [key, run] of runners) {
    const s = settings[key];
    if (!s?.on) continue;
    if (opts.moduleOn && !(await opts.moduleOn(RECIPE.get(key)!.module))) continue;
    /* Greetings are not posted at night; nothing is claimed, so the morning's run sends them. */
    if (opts.respectHours && !mayRunNow(key, now)) continue;
    if (!(await claimDay(accountId, orgId, key, today))) continue;
    try {
      const out = await run({ accountId, orgId, today, n: s.n, now, to: s.to, channels: s.channels });
      /* Added to what an earlier try today sent: what the screen says went, went. */
      await recordRun(accountId, orgId, key, out.count, out.recipients, now);
      if (out.failed) await runAgain(orgId, key, today);
      done[key] = out.count;
    } catch (e) {
      /* The next wake today tries again; what already went is not sent twice (see above). */
      await runAgain(orgId, key, today);
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
      /* Each recipe runs while its own module is switched on: People's while People is, as before. */
      const done = await runInTenant(o.orgId, () => runCompany(o.accountId, o.orgId, now, { respectHours: true, moduleOn: moduleOn(o.accountId, o.orgId) }));
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
      if (inSendingHours()) return runAutomations();
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
