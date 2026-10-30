import { z } from 'zod';

import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant } from '../../../utils/tenantScope.js';
import { istDate } from '../../attendance/compute.js';
import { notifyPermission, sendNotice } from '../../notifications.js';
import { ownPlanRefusal } from '../checklists.js';
import { NO_SETTLEMENT } from '../lifecycle/leaving.js';
import { cancelLeaving } from '../lifecycle/stayOn.js';
import { mailOnce, registerRecipe } from './automations.js';

/**
 * Exit interviews (WORKFLOW-GAP-RESEARCH-2026-10-30 A8, 4.9). When someone is leaving, an interview is
 * opened with the company's questions (five by default, HR edits them): the main reason from a list,
 * whether they would come back, what would have kept them, what they liked, and a note to the owner.
 * The leaver fills it in the employee app, about two minutes on a phone, or HR enters it from a
 * conversation.
 *
 * Who reads what (`shape`): HR and the owner read everything; those above them on the reporting line read
 * the answers and the outcome unless the leaver hid them; nobody else reads it, however widely their role
 * reads people. Could-we-have-kept-them and HR's note on the outcome are HR's alone, never the leaver's.
 *
 * HR records "could we have kept them" and the outcome: exit confirmed, or retained, which withdraws the
 * leaving through the existing stay-on (lifecycle/stayOn.ts). Submitting ticks the plan's "Exit
 * interview" step. The answers are erased after the company's keeping period (DPDP: purpose stated on
 * the form, kept no longer than needed); the reason and outcome stay for the report.
 */

export type Question = { key: string; text: string; kind: 'REASON' | 'CHOICE' | 'TEXT'; options?: Array<{ code: string; label: string }> };

export const DEFAULT_REASONS = [
  { code: 'PAY', label: 'Better pay elsewhere' },
  { code: 'GROWTH', label: 'Career growth' },
  { code: 'MANAGER', label: 'My manager or team' },
  { code: 'WORKLOAD', label: 'Hours or workload' },
  { code: 'COMMUTE', label: 'Commute or moving away' },
  { code: 'PERSONAL', label: 'Personal or family reasons' },
  { code: 'STUDIES', label: 'Going back to studies' },
  { code: 'HEALTH', label: 'Health' },
  { code: 'OTHER', label: 'Something else' },
];
export const DEFAULT_QUESTIONS: Question[] = [
  { key: 'reason', text: 'What is the main reason you are leaving?', kind: 'REASON', options: DEFAULT_REASONS },
  { key: 'comeBack', text: 'Would you come back to work here?', kind: 'CHOICE', options: [{ code: 'YES', label: 'Yes' }, { code: 'MAYBE', label: 'Maybe' }, { code: 'NO', label: 'No' }] },
  { key: 'keptYou', text: 'What would have made you stay?', kind: 'TEXT' },
  { key: 'liked', text: 'What did you like about working here?', kind: 'TEXT' },
  { key: 'toOwner', text: 'Anything you want the owner to know?', kind: 'TEXT' },
];
/** How long answers are kept unless the company chose otherwise: a company setting, not a legal number. */
export const DEFAULT_KEEP_MONTHS = 24;
export const COULD_KEEP = ['YES', 'MAYBE', 'NO'] as const;
export const OUTCOMES = ['EXIT_CONFIRMED', 'RETAINED'] as const;
/** Leavings with nobody to ask. */
const NOT_ASKED = new Set([...NO_SETTLEMENT, 'ABSCONDED', 'DECEASED']);

export class ExitError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

const today = () => istDate(new Date());
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const plusMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

const optionSchema = z.object({ code: z.string().trim().min(1).max(24).regex(/^[A-Z0-9_]+$/), label: z.string().trim().min(1).max(80) });
const questionSchema = z.object({
  key: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9_]+$/),
  text: z.string().trim().min(3, 'Write each question.').max(200),
  kind: z.enum(['REASON', 'CHOICE', 'TEXT']),
  options: z.array(optionSchema).max(15).optional(),
});
export const settingsSchema = z.object({
  questions: z.array(questionSchema).min(1).max(8),
  keepMonths: z.coerce.number().int().min(1).max(120),
});

/** The company's questions and keeping period: what it saved, else CLOR's five and two years. */
export async function exitSettings(orgId: string): Promise<{ questions: Question[]; keepMonths: number; custom: boolean }> {
  const row = await peoplePrisma.engagementSettings.findUnique({ where: { orgId }, select: { exitQuestions: true } });
  const saved = row?.exitQuestions as any;
  if (saved && !Array.isArray(saved) && Array.isArray(saved.questions) && saved.questions.length) {
    return { questions: saved.questions as Question[], keepMonths: Number(saved.keepMonths) || DEFAULT_KEEP_MONTHS, custom: true };
  }
  return { questions: DEFAULT_QUESTIONS, keepMonths: Number(saved?.keepMonths) || DEFAULT_KEEP_MONTHS, custom: false };
}

/** HR saves the questions. One question must give the main reason (the report counts it); keys are unique. */
export async function saveExitSettings(who: { accountId: string; orgId: string; userId: string }, body: unknown) {
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) throw new ExitError(parsed.error.issues[0]?.message || 'Those questions could not be read.');
  const { questions, keepMonths } = parsed.data;
  const reasons = questions.filter((q) => q.kind === 'REASON');
  if (reasons.length !== 1) throw new ExitError('Keep one question for the main reason: the report counts it.');
  if (new Set(questions.map((q) => q.key)).size !== questions.length) throw new ExitError('Two questions have the same key.');
  for (const q of questions) {
    if (q.kind !== 'TEXT' && (!q.options || q.options.length < 2)) throw new ExitError(`Give “${q.text}” at least two answers to choose from.`);
    if (q.options && new Set(q.options.map((o) => o.code)).size !== q.options.length) throw new ExitError(`Two answers to “${q.text}” are the same.`);
  }
  const value = { questions: questions.map((q) => (q.kind === 'TEXT' ? { key: q.key, text: q.text, kind: q.kind } : q)), keepMonths };
  await peoplePrisma.engagementSettings.upsert({
    where: { orgId: who.orgId },
    create: { accountId: who.accountId, orgId: who.orgId, exitQuestions: value as any, updatedByUserId: who.userId },
    update: { exitQuestions: value as any, updatedByUserId: who.userId },
  });
  return exitSettings(who.orgId);
}

export async function resetExitSettings(orgId: string) {
  await peoplePrisma.engagementSettings.updateMany({ where: { orgId }, data: { exitQuestions: [] } });
  return exitSettings(orgId);
}

type Leaver = { id: string; accountId: string; name: string; status: string; dateOfJoining: string | null; dateOfLeaving: string | null; leavingType: string | null; reportingManagerId: string | null; userId: string | null; email: string | null; personalEmail: string | null };
const LEAVER = { id: true, accountId: true, name: true, status: true, dateOfJoining: true, dateOfLeaving: true, leavingType: true, reportingManagerId: true, userId: true, email: true, personalEmail: true } as const;
const OWN_PLAN = 'This is your own leaving: someone else records it.';
const asked = (e: Leaver) => Boolean(e.dateOfLeaving && (e.status === 'ON_NOTICE' || e.status === 'LEFT') && !NOT_ASKED.has(String(e.leavingType || '')));

/**
 * The interview of this stint whose leaving was not withdrawn: the last day may have moved since it was opened
 * (the date is editable), and the leaver is not asked again. It takes the new day and its keeping period
 * along. Still unanswered, it is reminded afresh before the new day.
 */
async function carryInterview(orgId: string, e: Leaver) {
  const older = await peoplePrisma.exitInterview.findFirst({ where: { orgId, employeeId: e.id, leavingDate: { not: e.dateOfLeaving!, gte: e.dateOfJoining || '' }, withdrawnAt: null }, orderBy: { leavingDate: 'desc' } });
  if (!older) return;
  const moved = Date.parse(`${e.dateOfLeaving}T00:00:00Z`) - Date.parse(`${older.leavingDate}T00:00:00Z`);
  await peoplePrisma.exitInterview.updateMany({
    where: { id: older.id, orgId },
    data: {
      leavingDate: e.dateOfLeaving!,
      ...(older.keepUntil ? { keepUntil: new Date(Date.parse(`${older.keepUntil}T00:00:00Z`) + moved).toISOString().slice(0, 10) } : {}),
      ...(older.status === 'OPEN' ? { remindedOn: null } : {}),
    },
  }).catch((err) => { if (err?.code !== 'P2002') throw err; });
}

/** Opens the interview for this leaving, once (the unique row per person and last day). Returns the row, or null when nobody is asked. */
export async function ensureInterview(orgId: string, employeeId: string) {
  const e = (await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: LEAVER })) as Leaver | null;
  if (!e || !asked(e)) return null;
  const leavingDate = e.dateOfLeaving!;
  const key = { orgId_employeeId_leavingDate: { orgId, employeeId, leavingDate } };
  let found = await peoplePrisma.exitInterview.findUnique({ where: key });
  if (!found) {
    await carryInterview(orgId, e);
    found = await peoplePrisma.exitInterview.findUnique({ where: key });
  }
  /* Stayed on, then leaving again on the very same day: this leaving's outcome is still to be decided. */
  if (found?.withdrawnAt) {
    await peoplePrisma.exitInterview.updateMany({ where: { id: found.id, orgId }, data: { withdrawnAt: null, outcome: null, outcomeByUserId: null, outcomeAt: null, outcomeNote: null, remindedOn: null } });
    return peoplePrisma.exitInterview.findUnique({ where: key });
  }
  if (found) return found;
  const { questions, keepMonths } = await exitSettings(orgId);
  await peoplePrisma.exitInterview.createMany({ data: [{ accountId: e.accountId, orgId, employeeId, leavingDate, questions: questions as any, keepUntil: plusMonths(leavingDate, keepMonths) }], skipDuplicates: true });
  return peoplePrisma.exitInterview.findUnique({ where: key });
}

const purposeOf = (keepMonths: number) => `Your answers help the company understand why people leave and what to change. HR and the owner read them; your managers too, unless you hide them. They are kept for ${keepMonths} months, then erased.`;

/** The same promise, said to whoever reads it on the plan: HR, the owner or a manager, not the leaver. */
const readerPurposeOf = (keepMonths: number) => `The answers help the company understand why people leave and what to change. HR and the owner read them; their managers too, unless they hide them. They are kept for ${keepMonths} months, then erased.`;

type Row = NonNullable<Awaited<ReturnType<typeof ensureInterview>>>;
/** HR: everything. LINE: a manager above them. HIDDEN: that manager, kept out by the leaver. SELF: the leaver, with nothing of HR's. */
type View = 'HR' | 'LINE' | 'HIDDEN' | 'SELF';
function shape(r: Row, view: View) {
  const questions = (r.questions as unknown as Question[]) || [];
  const reasonQ = questions.find((q) => q.kind === 'REASON');
  return {
    id: r.id,
    employeeId: r.employeeId,
    lastDay: r.leavingDate,
    /* Two days before the last day; once that has passed, the last day itself; nothing once they have gone. */
    dueBy: plusDays(r.leavingDate, -2) >= today() ? plusDays(r.leavingDate, -2) : r.leavingDate >= today() ? r.leavingDate : null,
    status: r.status,
    questions,
    answers: view !== 'HIDDEN' && !r.erasedAt ? (r.answers as Record<string, string>) : null,
    /* The reason and the outcome are the answers by another name: a hidden interview carries neither. */
    ...(view === 'HIDDEN' ? {} : {
      reason: r.reason,
      reasonLabel: reasonQ?.options?.find((o) => o.code === r.reason)?.label || (r.reason ? DEFAULT_REASONS.find((o) => o.code === r.reason)?.label || r.reason : null),
    }),
    hideFromManager: r.hideFromManager,
    enteredBy: r.enteredBy,
    submittedAt: r.submittedAt,
    ...(view === 'HR' || view === 'LINE' ? { outcome: r.outcome, outcomeAt: r.outcomeAt } : {}),
    ...(view === 'HR' ? { couldKeep: r.couldKeep, outcomeNote: r.outcomeNote } : {}),
    keepUntil: r.keepUntil,
    erased: Boolean(r.erasedAt),
    updatedAt: r.updatedAt,
  };
}

/** The leaver's own, in the employee app: what they said, nothing of what HR made of it. */
export async function myInterview(orgId: string, employeeId: string) {
  const r = await ensureInterview(orgId, employeeId);
  if (!r) return null;
  const { keepMonths } = await exitSettings(orgId);
  return { ...shape(r, 'SELF'), purpose: purposeOf(keepMonths) };
}

/**
 * The view on the leaving plan: HR and the owner, the managers above them, or the person themself. Anyone
 * else with a company-wide role (IT) gets nothing: the form promises "HR, the owner and your managers".
 */
export async function interviewFor(orgId: string, employeeId: string, viewer: { hr: boolean; line?: boolean; self?: boolean }) {
  if (!viewer.hr && !viewer.line && !viewer.self) return null;
  const r = await ensureInterview(orgId, employeeId);
  if (!r) return null;
  const hidden = !viewer.hr && !viewer.self && r.hideFromManager;
  const view: View = viewer.hr ? 'HR' : viewer.self ? 'SELF' : hidden ? 'HIDDEN' : 'LINE';
  const { keepMonths } = await exitSettings(orgId);
  return { ...shape(r, view), hiddenFromYou: hidden, purpose: view === 'SELF' ? purposeOf(keepMonths) : readerPurposeOf(keepMonths), canEnter: viewer.hr && r.status === 'OPEN', canDecide: viewer.hr };
}

const answerSchema = z.object({
  answers: z.record(z.string(), z.string().max(2000)),
  hideFromManager: z.boolean().optional(),
});

/**
 * Sends the answers, by the leaver (EMPLOYEE) or HR from a conversation (HR). Every choice question needs
 * an answer from its list; text answers are optional. The write checks the interview is still open, so
 * two sends (a double tap, the leaver and HR at once) keep the first.
 */
export async function submitInterview(orgId: string, employeeId: string, by: { kind: 'EMPLOYEE' | 'HR'; userId: string | null; accountId: string }, body: unknown) {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) throw new ExitError('Those answers could not be read.');
  if (by.kind === 'HR' && by.userId && (await ownPlanRefusal({ accountId: by.accountId, orgId, userId: by.userId }, { employeeId, owner: 'HR' }))) throw new ExitError(OWN_PLAN, 403, 'OWN_PLAN');
  const r = await ensureInterview(orgId, employeeId);
  if (!r) throw new ExitError('There is no exit interview for this person.', 404);
  if (r.status !== 'OPEN') throw new ExitError('The exit interview has already been sent.', 409, 'SENT');
  const questions = (r.questions as unknown as Question[]) || [];
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const raw = String(parsed.data.answers[q.key] ?? '').trim();
    if (q.kind === 'TEXT') {
      if (raw) answers[q.key] = raw.slice(0, 2000);
      continue;
    }
    if (!raw) throw new ExitError(`Answer “${q.text}”.`);
    if (!q.options?.some((o) => o.code === raw)) throw new ExitError(`Choose one of the answers to “${q.text}”.`);
    answers[q.key] = raw;
  }
  const reasonQ = questions.find((q) => q.kind === 'REASON');
  const done = await peoplePrisma.exitInterview.updateMany({
    where: { id: r.id, orgId, status: 'OPEN' },
    data: { status: 'SUBMITTED', answers, reason: reasonQ ? answers[reasonQ.key] || null : null, hideFromManager: Boolean(parsed.data.hideFromManager), enteredBy: by.kind, enteredByUserId: by.userId, submittedAt: new Date() },
  });
  if (!done.count) throw new ExitError('The exit interview has already been sent.', 409, 'SENT');
  /* The plan's step ticks itself (4.9.3). */
  await peoplePrisma.checklistTask.updateMany({ where: { orgId, employeeId, kind: 'LEAVING', doneAt: null, title: 'Exit interview' }, data: { doneAt: new Date(), doneByUserId: by.userId, note: by.kind === 'EMPLOYEE' ? 'Filled in by them in the employee app.' : 'Entered by HR.' } });
  if (by.kind === 'EMPLOYEE') {
    const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { name: true } });
    await notifyPermission(by.accountId, orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.exit_interview', title: `${e?.name || 'A leaver'} filled in the exit interview`, link: { app: 'people', screen: 'leavers', params: { open: employeeId } } }).catch(() => undefined);
  }
  return peoplePrisma.exitInterview.findUnique({ where: { id: r.id } });
}

const decideSchema = z.object({
  couldKeep: z.enum(COULD_KEEP).optional().nullable(),
  outcome: z.enum(OUTCOMES).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  seenAt: z.string().optional(),
});

/**
 * HR's side: could we have kept them, and the outcome. Retained withdraws the leaving through the
 * existing stay-on, which only someone still on notice can be; the outcome is written first under a check
 * that it has not been decided, so two decisions do not both run the stay-on.
 */
export async function decideInterview(who: { accountId: string; orgId: string; userId: string }, employeeId: string, body: unknown) {
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) throw new ExitError('That outcome could not be read.');
  if (await ownPlanRefusal(who, { employeeId, owner: 'HR' })) throw new ExitError(OWN_PLAN, 403, 'OWN_PLAN');
  const r = await ensureInterview(who.orgId, employeeId);
  if (!r) {
    /* Retained a moment ago, so no longer asked: a second decision is told that, not "no such interview". */
    if (await peoplePrisma.exitInterview.count({ where: { orgId: who.orgId, employeeId, outcome: { not: null } } })) throw new ExitError('The outcome is already recorded.', 409, 'DECIDED');
    throw new ExitError('There is no exit interview for this person.', 404);
  }
  const { couldKeep, outcome, note } = parsed.data;
  if (outcome && r.outcome) throw new ExitError('The outcome is already recorded.', 409, 'DECIDED');
  if (outcome === 'RETAINED') {
    const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId: who.orgId }, select: { status: true, name: true } });
    if (e?.status !== 'ON_NOTICE') throw new ExitError(`${e?.name || 'They'} have already left. Use Rehire to bring them back.`, 409, 'LEFT');
  }
  const data: Record<string, unknown> = {};
  if (couldKeep !== undefined) data.couldKeep = couldKeep;
  if (note !== undefined) data.outcomeNote = note || null;
  if (outcome) Object.assign(data, { outcome, outcomeByUserId: who.userId, outcomeAt: new Date() });
  const done = await peoplePrisma.exitInterview.updateMany({ where: { id: r.id, orgId: who.orgId, ...(outcome ? { outcome: null } : {}) }, data: data as any });
  if (!done.count) throw new ExitError('The outcome is already recorded.', 409, 'DECIDED');
  if (outcome === 'RETAINED') {
    try {
      await cancelLeaving(who, employeeId, note ? `Retained after the exit interview: ${note}` : 'Retained after the exit interview');
    } catch (e) {
      /* The leaving stays: take the outcome back so the record does not say retained when they are not. */
      await peoplePrisma.exitInterview.updateMany({ where: { id: r.id, orgId: who.orgId }, data: { outcome: null, outcomeByUserId: null, outcomeAt: null } });
      throw e;
    }
  }
  return peoplePrisma.exitInterview.findUnique({ where: { id: r.id } });
}

/**
 * The People report's "Why people leave": leavers by month (from the last day) and reason, with how many
 * did not answer, how many HR thinks could have been kept, and how many were retained. HR's and the owner's
 * only (the route): in a team of three, a count of one is the person, flag or no flag.
 */
export async function leavingReasons(orgId: string, months = 12) {
  const t = today();
  const from = plusMonths(`${t.slice(0, 7)}-01`, -(months - 1));
  /* People on notice already count, in the month they leave: up to three months ahead (QA on #81: answered interviews read "No leavers"). */
  const ahead = plusMonths(`${t.slice(0, 7)}-01`, 3).slice(0, 7);
  const [rows, leavers, settings] = await Promise.all([
    peoplePrisma.exitInterview.findMany({ where: { orgId, leavingDate: { gte: from, lte: `${ahead}-31` } }, select: { employeeId: true, leavingDate: true, status: true, reason: true, couldKeep: true, outcome: true, withdrawnAt: true, questions: true } }),
    peoplePrisma.employee.findMany({ where: { orgId, dateOfLeaving: { gte: from, lte: `${ahead}-31` }, status: { in: ['ON_NOTICE', 'LEFT'] } }, select: { id: true, dateOfLeaving: true, leavingType: true } }),
    exitSettings(orgId),
  ]);
  /* A month ahead with only someone who stayed still shows, so their "retained" is counted. */
  const lastMonth = [t.slice(0, 7), ...leavers.map((l) => String(l.dateOfLeaving).slice(0, 7)), ...rows.map((r) => r.leavingDate.slice(0, 7))].filter((m) => m <= ahead).sort().pop()!;
  const labels = new Map<string, string>();
  for (const o of DEFAULT_REASONS) labels.set(o.code, o.label);
  for (const q of settings.questions) if (q.kind === 'REASON') for (const o of q.options || []) labels.set(o.code, o.label);
  const monthsList: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) monthsList.push(plusMonths(`${t.slice(0, 7)}-01`, -i).slice(0, 7));
  for (let m = plusMonths(`${t.slice(0, 7)}-01`, 1).slice(0, 7); m <= lastMonth; m = plusMonths(`${m}-01`, 1).slice(0, 7)) monthsList.push(m);
  const byMonth = new Map(monthsList.map((m) => [m, { month: m, leavers: 0, answered: 0, reasons: {} as Record<string, number>, couldKeep: 0, retained: 0 }]));
  const real = leavers.filter((l) => !NO_SETTLEMENT.has(String(l.leavingType || '')));
  for (const l of real) {
    const m = byMonth.get(String(l.dateOfLeaving).slice(0, 7));
    if (m) m.leavers += 1;
  }
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const m = byMonth.get(r.leavingDate.slice(0, 7));
    if (!m) continue;
    /* Retained: decided so, or the leaving withdrawn some other way (even after "exit confirmed"). */
    if (r.outcome === 'RETAINED' || r.withdrawnAt) m.retained += 1;
    /* Someone who stayed did not leave: their answers are no reason for leaving, and they are no one HR could have kept. */
    if (r.withdrawnAt || r.outcome === 'RETAINED') continue;
    if (r.status === 'SUBMITTED' && r.reason) {
      m.answered += 1;
      m.reasons[r.reason] = (m.reasons[r.reason] || 0) + 1;
      totals[r.reason] = (totals[r.reason] || 0) + 1;
    }
    if (r.couldKeep === 'YES' || r.couldKeep === 'MAYBE') m.couldKeep += 1;
  }
  const reasons = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, label: labels.get(code) || code, count }));
  return { months: [...byMonth.values()], reasons, labels: Object.fromEntries(labels) };
}

/** Answers past the keeping period are erased, for every company (the reason and outcome stay). */
export async function eraseExpiredAnswers(now = new Date()) {
  const r = await outsideTenant('job: exit interview answers past keeping', () => peoplePrisma.exitInterview.updateMany({ where: { keepUntil: { lt: istDate(now) }, erasedAt: null }, data: { answers: {}, outcomeNote: null, erasedAt: now } }));
  return r.count;
}

// ---------------------------------------------------------------------------
// The reminder (services/people/engagement/automations.ts)
// ---------------------------------------------------------------------------

/** N days before the last day, a leaver who has not filled it hears once: e-mail, the bell if they sign in to CLOR, and the app. */
registerRecipe('exitInterview', async ({ accountId, orgId, today: t, n, now }) => {
  const days = n ?? 2;
  /* Interviews exist once a plan or the app has been opened; make sure every leaver in the window has one. */
  const leavers = await peoplePrisma.employee.findMany({ where: { orgId, status: 'ON_NOTICE', dateOfLeaving: { gte: t, lte: plusDays(t, days) } }, select: { id: true } });
  for (const l of leavers) await ensureInterview(orgId, l.id);
  const open = await peoplePrisma.exitInterview.findMany({ where: { orgId, status: 'OPEN', remindedOn: null, leavingDate: { gte: t, lte: plusDays(t, days) } } });
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: open.map((o) => o.employeeId) } }, select: LEAVER })).map((p) => [p.id, p as Leaver]));
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }).catch(() => null);
  const names: string[] = [];
  let failed = 0;
  for (const o of open) {
    const p = people.get(o.employeeId);
    /* The row must be for the day they really leave now: one whose day moved is reminded before the new day. */
    if (!p || !asked(p) || p.dateOfLeaving !== o.leavingDate) continue;
    const to = p.email || p.personalEmail;
    if (!to && !p.userId) continue;
    /* Claimed first: a second run the same day finds it reminded. Given back if nothing reached them. */
    const claim = await peoplePrisma.exitInterview.updateMany({ where: { id: o.id, remindedOn: null, status: 'OPEN' }, data: { remindedOn: t } });
    if (!claim.count) continue;
    const headline = 'Your exit interview';
    const asks = ((o.questions as unknown as Question[]) || []).length;
    const body = `Before your last day (${o.leavingDate}), please answer ${asks === 1 ? 'a short question' : `${asks} short questions`} about working here. It takes about two minutes in the employee app, under Me.`;
    const mail = to ? await mailOnce({ templateKey: 'people.automation', to, toName: p.name, accountId, orgId, relatedType: 'ExitInterview', relatedId: o.id, data: { name: p.name, orgName: org?.name || 'Your company', headline, body } }, now) : null;
    const bell = p.userId ? await sendNotice(accountId, orgId, [p.userId], { kind: 'people.exit_interview', title: headline, body, link: null }, { dedupeKey: `exit-interview:${o.id}:${o.leavingDate}` }).catch(() => null) : 0;
    if (mail === 'SENT' || (bell && bell > 0)) names.push(p.name);
    else if (mail === 'FAILED' || bell === null) {
      await peoplePrisma.exitInterview.updateMany({ where: { id: o.id, orgId }, data: { remindedOn: null } });
      failed += 1;
    }
  }
  return { count: names.length, recipients: names, failed };
});
