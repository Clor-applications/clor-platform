import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { registerJob } from '../jobRegistry.js';
import { notifyPermission } from '../notifications.js';
import { isFeatureEnabled } from '../features.js';
import { sendTemplate } from '../mailer.js';
import { isWeeklyOff, istDate } from '../attendance/compute.js';
import { periodContext, today } from '../attendance/days.js';
import { rulesOf, timeRulesFor } from '../attendance/timeRules.js';
import { issueLetter, LetterError } from './letters.js';
import { leaveEmployee } from './lifecycle/leaving.js';
import { writeEvent } from './outbox.js';
import { eachDay } from '../../utils/istDate.js';

/**
 * Unexplained absence and absconding (WORKFLOW-GAP-RESEARCH-2026-10-30 A12, A13, 4.6).
 *
 * Each morning CLOR looks for someone absent [5] working days in a row (the company's setting) with
 * no leave asked for, no correction asked for and no punch: HR is told "Ravi Kumar absent 5 working
 * days with no leave", and the person shows under People, Absences. From there HR:
 *  1. sends notice 1 (a letter from the template, into the person's documents and the employee app,
 *     and e-mailed when there is an address; the time, the channels, the address and a copy are kept),
 *     asking them to report back or explain by a date;
 *  2. sends notice 2, offered [7] days after the first;
 *  3. once the second notice's date has passed with no word, records the leaving as ABSCONDED with a
 *     last working day, and may hold the final settlement (shown on Home until released). A hold is a
 *     hold: wages earned are never zeroed (Code on Wages 2019, s.17(2), s.18(1)), Payroll still works the settlement out.
 * Or closes the case at any point: they came back, or there was a reason (with a note), and nothing is
 * recorded against them. A case nobody acted on closes itself when the person is back at work.
 *
 * Law: misconduct needs a show-cause opportunity, which the two notices are; how many days of absence
 * the standing orders call abandonment differs by state and is the company's setting, to be checked
 * with a lawyer (the research marks it unverified). Payroll does not read the hold yet: it is recorded
 * here and raised as `people.settlement.hold.v1` for Payroll to honour (interface need, PR notes).
 */

export class AbsenceError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

const OPEN = ['OPEN', 'NOTICE_1', 'NOTICE_2'];
const DAY_MS = 86_400_000;
const LOOKBACK = 45;
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export type Streak = { employeeId: string; fromDate: string; lastAbsentDate: string; days: number; lastWorked: string | null };

/**
 * Each person's run of unexplained absence ending on the last working day before today: working
 * days (their shift, the working week, their holidays) with no record or an absent one, no leave
 * asked for or given, no request waiting. Holidays and weekly offs neither count nor break it. Only
 * people who punch are looked at: in a company that keeps no attendance, nobody is "absent".
 */
export async function streaks(accountId: string, orgId: string, opts: { employeeIds?: string[] } = {}): Promise<Map<string, Streak>> {
  const t = today();
  const from = plusDays(t, -LOOKBACK);
  const to = plusDays(t, -1);
  const ctx = await periodContext(accountId, orgId, from, to);
  const keep = opts.employeeIds ? new Set(opts.employeeIds) : null;
  const people = ctx.people.filter((p) => (!keep || keep.has(p.id)) && (p.status === 'ACTIVE' || p.status === 'ON_NOTICE'));
  const out = new Map<string, Streak>();
  if (!people.length) return out;
  const ids = people.map((p) => p.id);
  const [punchers, leave, asked] = await Promise.all([
    peoplePrisma.attendanceRecord.groupBy({ by: ['employeeId'], where: { orgId, employeeId: { in: ids }, checkIn: { not: null }, date: { gte: plusDays(t, -60) } } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: to }, toDate: { gte: from } }, select: { employeeId: true, fromDate: true, toDate: true } }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: { in: ['PENDING', 'APPROVED'] }, date: { lte: to }, OR: [{ toDate: null, date: { gte: from } }, { toDate: { gte: from } }] }, select: { employeeId: true, date: true, toDate: true } }),
  ]);
  const punches = new Set(punchers.map((p) => p.employeeId));
  const explained = (id: string, d: string) => leave.some((l) => l.employeeId === id && l.fromDate <= d && l.toDate >= d) || asked.some((r) => r.employeeId === id && r.date <= d && (r.toDate || r.date) >= d);
  for (const p of people) {
    if (!punches.has(p.id)) continue;
    const span = new Set(ctx.spanOf(p));
    const holidays = ctx.holidaysFor(p);
    const recs = ctx.recordsOf.get(p.id) || new Map();
    let days = 0;
    let first: string | null = null;
    let last: string | null = null;
    let lastWorked: string | null = null;
    /* Back from yesterday until a day that breaks the run. */
    for (const d of eachDay(from, to).reverse()) {
      if (!span.has(d)) break;
      if (holidays.has(d) || isWeeklyOff(ctx.shiftOn(p.id, d).rule, d)) continue;
      const r = recs.get(d);
      const absent = (!r || (r.status === 'ABSENT' && !r.checkIn)) && !explained(p.id, d);
      if (!absent) {
        lastWorked = r && (r.status === 'PRESENT' || r.status === 'HALF_DAY') ? d : null;
        break;
      }
      days += 1;
      first = d;
      if (!last) last = d;
    }
    if (days > 0 && first && last) out.set(p.id, { employeeId: p.id, fromDate: first, lastAbsentDate: last, days, lastWorked });
  }
  return out;
}

/** One company's morning: open a case for each new streak at the setting, keep open cases up to date, close what came back. */
export async function checkCompany(accountId: string, orgId: string) {
  const rules = rulesOf(await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } })).absence;
  if (!rules.on) return { opened: 0, closed: 0 };
  const found = await streaks(accountId, orgId);
  const open = await peoplePrisma.absenceCase.findMany({ where: { orgId, status: { in: OPEN } } });
  const openOf = new Map(open.map((c) => [c.employeeId, c]));
  let opened = 0;
  let closed = 0;
  const fresh: Array<{ name: string; days: number }> = [];
  for (const s of found.values()) {
    const c = openOf.get(s.employeeId);
    if (c) {
      if (c.lastAbsentDate !== s.lastAbsentDate) await peoplePrisma.absenceCase.updateMany({ where: { id: c.id, status: { in: OPEN } }, data: { lastAbsentDate: s.lastAbsentDate, days: Math.max(c.days, s.days) } });
      continue;
    }
    if (s.days < rules.days) continue;
    /* One open case per person: decided under the company's write lock, so two instances open one. */
    const made = await peopleWrite(orgId, async () => {
      if (await peoplePrisma.absenceCase.findFirst({ where: { orgId, employeeId: s.employeeId, status: { in: OPEN } }, select: { id: true } })) return null;
      /* A case closed for this same run (came back, or ignored with a reason) is not opened again for it. */
      if (await peoplePrisma.absenceCase.findFirst({ where: { orgId, employeeId: s.employeeId, fromDate: s.fromDate, status: { in: ['IGNORED', 'RETURNED', 'EXPLAINED'] } }, select: { id: true } })) return null;
      return peoplePrisma.absenceCase.create({ data: { accountId, orgId, employeeId: s.employeeId, fromDate: s.fromDate, lastAbsentDate: s.lastAbsentDate, days: s.days } });
    });
    if (!made) continue;
    opened += 1;
    const p = await peoplePrisma.employee.findFirst({ where: { id: s.employeeId, orgId }, select: { name: true } });
    fresh.push({ name: p?.name || 'Someone', days: s.days });
  }
  /* Cases nobody has sent a notice in, whose person is back (the run broke): closed with a note. */
  for (const c of open) {
    if (c.status !== 'OPEN' || found.has(c.employeeId)) continue;
    const done = await peoplePrisma.absenceCase.updateMany({ where: { id: c.id, status: 'OPEN' }, data: { status: 'EXPLAINED', closedAt: new Date(), closedByUserId: 'system', closedNote: 'Back at work, or leave or a correction was asked for.' } });
    closed += done.count;
  }
  if (fresh.length) {
    const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
    const title = fresh.length === 1 ? `${fresh[0].name} absent ${fresh[0].days} working days with no leave` : `${fresh.length} people absent ${rules.days} or more working days with no leave`;
    await notifyPermission(accountId, orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.absence', title, body: 'Send a notice, or close it if there is a reason.', link: { app, screen: 'absences' } }).catch((e) => console.error('[absence] notice', e instanceof Error ? e.message : e));
  }
  return { opened, closed };
}

export async function runAbsenceChecks() {
  const orgs = await outsideTenant('job: absence checks', () => peoplePrisma.employee.groupBy({ by: ['accountId', 'orgId'], where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } } }));
  let opened = 0;
  for (const o of orgs) {
    try {
      if (!(await isFeatureEnabled(o.accountId, o.orgId, 'people')) && !(await isFeatureEnabled(o.accountId, o.orgId, 'attendance'))) continue;
      opened += (await runInTenant(o.orgId, () => checkCompany(o.accountId, o.orgId))).opened;
    } catch (e) {
      console.error(`[absence] ${o.orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return { opened };
}

/** Daily, under a lease, in the morning (IST 7 to 12); a wake outside that window does nothing. */
export function startAbsenceChecks({ intervalMs = 3_600_000, startupDelayMs = 220_000 } = {}) {
  const tick = () =>
    exclusive('people.absence-check', leaseFor(intervalMs), async () => {
      const hour = new Date(Date.now() + 330 * 60_000).getUTCHours();
      if (hour >= 7 && hour < 12) await runAbsenceChecks();
    }).catch((e) => {
      console.error('[absence] failed:', e instanceof Error ? e.message : e);
      throw e;
    });
  registerJob('startAbsenceChecks', tick, intervalMs);
  const timed = () => tick().catch(() => {});
  const t = setTimeout(() => {
    timed();
    const i = setInterval(timed, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  t.unref?.();
  return () => clearTimeout(t);
}

// ---------------------------------------------------------------------------
// HR's steps
// ---------------------------------------------------------------------------

type Who = { accountId: string; orgId: string; userId: string; correlationId: string };

async function caseIn(orgId: string, id: string) {
  const c = await peoplePrisma.absenceCase.findFirst({ where: { id, orgId } });
  if (!c) throw new AbsenceError('No such case.', 404);
  return c;
}

async function audit(who: Who, entityId: string, action: string, message: string, metadata: Record<string, unknown>) {
  await platformPrisma.auditLog
    .create({ data: { accountId: who.accountId, orgId: who.orgId, branchId: '', entity: 'AbsenceCase', entityId, action, message: message.slice(0, 500), metadata: JSON.stringify(metadata).slice(0, 20_000), createdByUserId: who.userId, correlationId: who.correlationId } })
    .catch((e) => console.error('[absence] audit not recorded:', e instanceof Error ? e.message : e));
}

/**
 * Send the next notice: the letter issued from its template (into the person's documents, so the
 * employee app has it), e-mailed when they have an address, and a post reference kept when HR also
 * posted it. The notice row is claimed first under the case's unique (case, number), so two clicks
 * send one; if the letter cannot be made (a blank field), the claim is taken back.
 */
export async function sendAbsenceNotice(who: Who, caseId: string, input: { reportBy?: string | null; signatory?: string | null; email?: boolean; postRef?: string | null }) {
  const rules = (await timeRulesFor(who.orgId)).absence;
  const t = today();
  const signatory = String(input.signatory || '').trim().slice(0, 120);
  if (!signatory) throw new AbsenceError('Who signs the notice? Give a name and role, e.g. "Meera Shah, HR".');
  const reportBy = String(input.reportBy || '').trim() || plusDays(t, rules.replyDays);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportBy)) throw new AbsenceError('Dates are YYYY-MM-DD.');
  if (reportBy <= t) throw new AbsenceError('Give them at least a day to answer: the date is after today.');
  const postRef = String(input.postRef || '').trim().slice(0, 120) || null;
  const claimed = await peopleWrite(who.orgId, async () => {
    const c = await caseIn(who.orgId, caseId);
    if (!OPEN.includes(c.status)) throw new AbsenceError('This case is closed.', 409, 'CLOSED');
    if (c.status === 'NOTICE_2') throw new AbsenceError('Both notices have gone. Record the leaving, or close the case.', 409, 'BOTH_SENT');
    const seq = c.status === 'OPEN' ? 1 : 2;
    if (seq === 2) {
      const first = await peoplePrisma.absenceNotice.findFirst({ where: { caseId, seq: 1 } });
      const from = first ? plusDays(istDate(first.sentAt), rules.noticeGapDays) : t;
      if (from > t) throw new AbsenceError(`The second notice can go from ${longDay(from)}, ${rules.noticeGapDays} days after the first.`, 409, 'TOO_SOON');
    }
    try {
      const row = await peoplePrisma.absenceNotice.create({ data: { accountId: who.accountId, orgId: who.orgId, caseId, employeeId: c.employeeId, seq, reportBy, channels: ['APP'], postRef, text: '', sentByUserId: who.userId } });
      await peoplePrisma.absenceCase.update({ where: { id: c.id }, data: { status: seq === 1 ? 'NOTICE_1' : 'NOTICE_2' } });
      return { row, c, seq };
    } catch (e: any) {
      if (String(e?.code) === 'P2002') throw new AbsenceError('That notice was sent a moment ago.', 409, 'SENT');
      throw e;
    }
  });
  const { row, c, seq } = claimed;
  const first = seq === 2 ? await peoplePrisma.absenceNotice.findFirst({ where: { caseId, seq: 1 } }) : null;
  let letter;
  try {
    letter = await issueLetter({ accountId: who.accountId, orgId: who.orgId, userId: who.userId, source: 'FORM', correlationId: who.correlationId }, c.employeeId, {
      kind: seq === 1 ? 'ABSENCE_NOTICE_1' : 'ABSENCE_NOTICE_2',
      extra: { absentFrom: longDay(c.fromDate), reportBy: longDay(reportBy), signatory, ...(first ? { firstNoticeOn: longDay(istDate(first.sentAt)) } : {}) },
    });
  } catch (e) {
    /* Nothing went out: the claim is taken back so it can be sent again. */
    await peopleWrite(who.orgId, async () => {
      await peoplePrisma.absenceNotice.delete({ where: { id: row.id } });
      await peoplePrisma.absenceCase.update({ where: { id: c.id }, data: { status: seq === 1 ? 'OPEN' : 'NOTICE_1' } });
    });
    if (e instanceof LetterError) throw new AbsenceError(e.message, e.status);
    throw e;
  }
  const person = await peoplePrisma.employee.findFirst({ where: { id: c.employeeId, orgId: who.orgId }, select: { name: true, personalEmail: true, workEmail: true, email: true } });
  const to = input.email === false ? null : person?.personalEmail || person?.email || person?.workEmail || null;
  let emailStatus: string | null = null;
  let emailOutboxId: string | null = null;
  if (to) {
    try {
      const org = await platformPrisma.org.findUnique({ where: { id: who.orgId }, select: { name: true } });
      const sent: any = await sendTemplate({ templateKey: 'people.absence_notice', to, toName: person?.name || undefined, accountId: who.accountId, orgId: who.orgId, relatedType: 'AbsenceNotice', relatedId: row.id, transactional: true, data: { name: person?.name || '', orgName: org?.name || '', letter: letter.text, reportBy: longDay(reportBy) } });
      emailStatus = String(sent?.status || 'QUEUED');
      emailOutboxId = sent?.id || null;
    } catch (e) {
      console.error('[absence] e-mail', e instanceof Error ? e.message : e);
      emailStatus = 'FAILED';
    }
  }
  const channels = ['APP', ...(to ? ['EMAIL'] : []), ...(postRef ? ['POST'] : [])];
  const saved = await peoplePrisma.absenceNotice.update({ where: { id: row.id }, data: { text: letter.text, documentId: letter.document.id, channels, emailTo: to, emailStatus, emailOutboxId } });
  await audit(who, c.id, `NOTICE_${seq}`, `Absence notice ${seq} sent to ${person?.name || 'employee'}: report back by ${longDay(reportBy)} (${channels.join(', ').toLowerCase()})`, { employeeId: c.employeeId, noticeId: row.id, reportBy, channels, emailTo: to, emailStatus, postRef });
  return saved;
}

/** The first day at work after the absence, if they came back: a present or half day with a punch. */
export async function backSince(orgId: string, employeeId: string, after: string) {
  const r = await peoplePrisma.attendanceRecord.findFirst({ where: { orgId, employeeId, date: { gt: after }, status: { in: ['PRESENT', 'HALF_DAY'] }, checkIn: { not: null } }, orderBy: { date: 'asc' }, select: { date: true } });
  return r?.date ?? null;
}

/** Close a case with a note: they came back (RETURNED), or there is a reason to let it be (IGNORED). Nothing is recorded against them. */
export async function closeCase(who: Who, caseId: string, input: { outcome?: string; note?: string | null }) {
  const outcome = String(input.outcome || '').toUpperCase();
  if (outcome !== 'RETURNED' && outcome !== 'IGNORED') throw new AbsenceError('Say whether they came back or why it is closed.');
  const note = String(input.note || '').trim();
  if (note.length < 3) throw new AbsenceError(outcome === 'RETURNED' ? 'Add a note: when they came back and what they said.' : 'Say why it is closed.');
  const c = await caseIn(who.orgId, caseId);
  if (c.status === 'ABSCONDED') throw new AbsenceError('The leaving is recorded. If they came back, rejoin them from Leaving.', 409, 'ABSCONDED');
  const done = await peoplePrisma.absenceCase.updateMany({ where: { id: c.id, status: { in: OPEN } }, data: { status: outcome, closedAt: new Date(), closedByUserId: who.userId, closedNote: note.slice(0, 500) } });
  if (!done.count) throw new AbsenceError('This case is already closed.', 409, 'CLOSED');
  await audit(who, c.id, outcome, `Absence case closed: ${outcome === 'RETURNED' ? 'came back' : 'let be'}. ${note}`, { employeeId: c.employeeId });
  return peoplePrisma.absenceCase.findFirst({ where: { id: c.id } });
}

/**
 * Record the leaving as ABSCONDED, after the second notice's date has passed: the last working day is
 * theirs to set (default: the day before the absence began), the notices go with it as evidence, and
 * the final settlement can be held at the same time.
 */
export async function recordAbsconded(who: Who, caseId: string, input: { lastWorkingDay?: string | null; reason?: string | null; hold?: boolean; holdReason?: string | null; confirmBack?: boolean }) {
  const c = await caseIn(who.orgId, caseId);
  if (c.status === 'ABSCONDED') throw new AbsenceError('Already recorded.', 409, 'ABSCONDED');
  if (c.status !== 'NOTICE_2') throw new AbsenceError('Send both notices first, so they had the chance to explain.', 409, 'NOTICES_FIRST');
  const second = await peoplePrisma.absenceNotice.findFirst({ where: { caseId, seq: 2 } });
  if (second && second.reportBy >= today()) throw new AbsenceError(`The second notice gave them until ${longDay(second.reportBy)}. Record the leaving after that.`, 409, 'WAIT');
  /* Back at work since: they did not abscond. Only with an explicit confirmation and a reason. */
  const back = await backSince(who.orgId, c.employeeId, c.lastAbsentDate);
  if (back && !(input.confirmBack && String(input.reason || '').trim().length >= 3)) {
    throw new AbsenceError(`They have been at work since ${longDay(back)}. Close the case instead; to record the leaving all the same, confirm it and give the reason.`, 409, 'CAME_BACK');
  }
  const lastDay = String(input.lastWorkingDay || '').trim() || plusDays(c.fromDate, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) throw new AbsenceError('Dates are YYYY-MM-DD.');
  if (lastDay >= today()) throw new AbsenceError('The last working day is a day already past.');
  if (input.hold && String(input.holdReason || '').trim().length < 3) throw new AbsenceError('Say why the settlement is held.');
  const existing = await peoplePrisma.employee.findFirst({ where: { id: c.employeeId, orgId: who.orgId } });
  if (!existing) throw new AbsenceError('No such employee.', 404);
  if (existing.status === 'LEFT') throw new AbsenceError(`${existing.name} has already left.`, 409, 'LEFT');
  const notices = await peoplePrisma.absenceNotice.findMany({ where: { caseId }, orderBy: { seq: 'asc' }, select: { seq: true, sentAt: true, reportBy: true, channels: true, documentId: true } });
  const reason = String(input.reason || '').trim().slice(0, 400) || `Absent from ${longDay(c.fromDate)}; notices sent ${notices.map((n) => longDay(istDate(n.sentAt))).join(' and ')} with no reply.`;
  /* The case is claimed first, so two clicks record one leaving. */
  const claimed = await peoplePrisma.absenceCase.updateMany({ where: { id: c.id, status: 'NOTICE_2' }, data: { status: 'ABSCONDED', lastWorkingDay: lastDay, closedAt: new Date(), closedByUserId: who.userId, closedNote: reason } });
  if (!claimed.count) throw new AbsenceError('This case changed a moment ago.', 409, 'CHANGED');
  try {
    await leaveEmployee({ accountId: who.accountId, orgId: who.orgId, userId: who.userId, source: 'FORM', correlationId: who.correlationId, reason }, existing as any, { lastDay, leavingType: 'ABSCONDED', reason });
  } catch (e) {
    await peoplePrisma.absenceCase.updateMany({ where: { id: c.id, status: 'ABSCONDED' }, data: { status: 'NOTICE_2', lastWorkingDay: null, closedAt: null, closedByUserId: null, closedNote: null } });
    throw e;
  }
  await audit(who, c.id, 'ABSCONDED', `${existing.name} recorded as absconded, last working day ${longDay(lastDay)}`, { employeeId: c.employeeId, lastDay, notices });
  if (input.hold) await holdSettlement(who, c.id, String(input.holdReason));
  return peoplePrisma.absenceCase.findFirst({ where: { id: c.id } });
}

/** Hold the final settlement: a mark Payroll is told of, shown on Home until released. Never a forfeiture. */
export async function holdSettlement(who: Who, caseId: string, reason: string) {
  const why = String(reason || '').trim();
  if (why.length < 3) throw new AbsenceError('Say why the settlement is held.');
  const c = await caseIn(who.orgId, caseId);
  if (c.status !== 'ABSCONDED') throw new AbsenceError('A settlement is held once the leaving is recorded.', 409, 'NOT_LEFT');
  const done = await peopleWrite(who.orgId, async () => {
    const n = await peoplePrisma.absenceCase.updateMany({ where: { id: c.id, OR: [{ heldAt: null }, { holdReleasedAt: { not: null } }] }, data: { holdReason: why.slice(0, 300), heldAt: new Date(), heldByUserId: who.userId, holdReleasedAt: null, holdReleaseNote: null } });
    if (n.count) await writeEvent(peoplePrisma, { accountId: who.accountId, orgId: who.orgId, correlationId: `hold_${c.id}_${Date.now()}` }, 'people.settlement.hold.v1', { employeeId: c.employeeId, held: true, reason: why }, c.employeeId);
    return n.count;
  });
  if (!done) throw new AbsenceError('The settlement is already on hold.', 409, 'HELD');
  await audit(who, c.id, 'HOLD', `Final settlement held: ${why}`, { employeeId: c.employeeId });
  return peoplePrisma.absenceCase.findFirst({ where: { id: c.id } });
}

export async function releaseHold(who: Who, caseId: string, note: string) {
  const why = String(note || '').trim();
  if (why.length < 3) throw new AbsenceError('Say why it is released, e.g. "Came in to settle, 4 Nov".');
  const c = await caseIn(who.orgId, caseId);
  const done = await peopleWrite(who.orgId, async () => {
    const n = await peoplePrisma.absenceCase.updateMany({ where: { id: c.id, heldAt: { not: null }, holdReleasedAt: null }, data: { holdReleasedAt: new Date(), holdReleaseNote: why.slice(0, 300) } });
    if (n.count) await writeEvent(peoplePrisma, { accountId: who.accountId, orgId: who.orgId, correlationId: `release_${c.id}_${Date.now()}` }, 'people.settlement.hold.v1', { employeeId: c.employeeId, held: false, reason: why }, c.employeeId);
    return n.count;
  });
  if (!done) throw new AbsenceError('The settlement is not on hold.', 409, 'NOT_HELD');
  await audit(who, c.id, 'RELEASE', `Final settlement released: ${why}`, { employeeId: c.employeeId });
  return peoplePrisma.absenceCase.findFirst({ where: { id: c.id } });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The cases for the Absences screen: open first, each with its notices, the next step and its date. */
export async function listCases(orgId: string, opts: { status?: string; scopeIds?: string[] | null } = {}) {
  const rules = (await timeRulesFor(orgId)).absence;
  const where: any = { orgId, ...(opts.scopeIds ? { employeeId: { in: opts.scopeIds } } : {}) };
  if (opts.status === 'open') where.status = { in: OPEN };
  else if (opts.status === 'closed') where.status = { notIn: [...OPEN, 'ABSCONDED'] };
  else if (opts.status === 'absconded') where.status = 'ABSCONDED';
  const cases = await peoplePrisma.absenceCase.findMany({ where, orderBy: [{ updatedAt: 'desc' }], take: 300 });
  const ids = cases.map((c) => c.id);
  const [notices, people] = await Promise.all([
    ids.length ? peoplePrisma.absenceNotice.findMany({ where: { orgId, caseId: { in: ids } }, orderBy: { seq: 'asc' } }) : [],
    cases.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(cases.map((c) => c.employeeId))] } }, select: { id: true, name: true, code: true, department: true, phone: true, personalEmail: true, workEmail: true, email: true, status: true } }) : [],
  ]);
  const personOf = new Map(people.map((p) => [p.id, p]));
  const t = today();
  const backOf = new Map<string, string | null>();
  for (const c of cases) if (OPEN.includes(c.status)) backOf.set(c.id, await backSince(orgId, c.employeeId, c.lastAbsentDate));
  const rows = cases.map((c) => {
    const mine = notices.filter((n) => n.caseId === c.id);
    const p = personOf.get(c.employeeId);
    const n1 = mine.find((n) => n.seq === 1);
    const n2 = mine.find((n) => n.seq === 2);
    let next: { step: string; from: string | null } | null = null;
    if (c.status === 'OPEN') next = { step: 'NOTICE_1', from: t };
    else if (c.status === 'NOTICE_1') next = { step: 'NOTICE_2', from: n1 ? plusDays(istDate(n1.sentAt), rules.noticeGapDays) : t };
    else if (c.status === 'NOTICE_2') next = { step: 'RECORD', from: n2 ? plusDays(n2.reportBy, 1) : t };
    return {
      id: c.id, employeeId: c.employeeId, name: p?.name || '—', code: p?.code || null, department: p?.department || null, phone: p?.phone || null,
      email: p?.personalEmail || p?.email || p?.workEmail || null,
      fromDate: c.fromDate, lastAbsentDate: c.lastAbsentDate, days: c.days, status: c.status,
      next, closedNote: c.closedNote, closedAt: c.closedAt, lastWorkingDay: c.lastWorkingDay,
      backSince: backOf.get(c.id) ?? null,
      hold: c.heldAt ? { reason: c.holdReason, at: c.heldAt, releasedAt: c.holdReleasedAt, releaseNote: c.holdReleaseNote } : null,
      notices: mine.map((n) => ({ id: n.id, seq: n.seq, sentAt: n.sentAt, reportBy: n.reportBy, channels: n.channels, emailTo: n.emailTo, emailStatus: n.emailStatus, postRef: n.postRef, documentId: n.documentId })),
      createdAt: c.createdAt,
    };
  });
  const order = (s: string) => (OPEN.includes(s) ? 0 : s === 'ABSCONDED' ? 1 : 2);
  rows.sort((a, b) => order(a.status) - order(b.status) || b.days - a.days);
  return { rules, rows, counts: { open: cases.filter((c) => OPEN.includes(c.status)).length, held: cases.filter((c) => c.heldAt && !c.holdReleasedAt).length } };
}

/** One notice's text, as sent (the copy kept). */
export async function noticeCopy(orgId: string, noticeId: string) {
  const n = await peoplePrisma.absenceNotice.findFirst({ where: { id: noticeId, orgId } });
  if (!n) throw new AbsenceError('No such notice.', 404);
  return { id: n.id, seq: n.seq, text: n.text, sentAt: n.sentAt, reportBy: n.reportBy, channels: n.channels, emailTo: n.emailTo, emailStatus: n.emailStatus, postRef: n.postRef };
}

/** Settlements on hold now: for Home, and for Payroll to read before paying (`people.settlement.hold.v1` tells it). */
export async function settlementHolds(orgId: string) {
  const rows = await peoplePrisma.absenceCase.findMany({ where: { orgId, heldAt: { not: null }, holdReleasedAt: null }, orderBy: { heldAt: 'desc' } });
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ caseId: r.id, employeeId: r.employeeId, name: names.get(r.employeeId) || '—', reason: r.holdReason, since: r.heldAt }));
}

/** What the person sees in the employee app: the notices sent to them, with the date to answer by. */
export async function noticesFor(orgId: string, employeeId: string) {
  const open = await peoplePrisma.absenceCase.findMany({ where: { orgId, employeeId, status: { in: ['NOTICE_1', 'NOTICE_2'] } }, select: { id: true } });
  if (!open.length) return [];
  const rows = await peoplePrisma.absenceNotice.findMany({ where: { orgId, caseId: { in: open.map((c) => c.id) } }, orderBy: { seq: 'desc' } });
  return rows.map((n) => ({ id: n.id, seq: n.seq, reportBy: n.reportBy, sentAt: n.sentAt, documentId: n.documentId }));
}
