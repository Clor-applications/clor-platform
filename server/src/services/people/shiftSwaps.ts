import type { Prisma } from '../../generated/people/index.js';
import { afterPeopleCommit, peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { notifyUsers } from '../notifications.js';
import { isOvernight, isWeeklyOff } from '../attendance/compute.js';
import { loadHolidays, loadSchedule, resolveShift } from '../attendance/schedule.js';
import { assertScheduleOpen, scheduleGuard } from '../attendance/scheduleGuard.js';
import { today } from '../attendance/days.js';
import { nightRefusal } from './nightConsent.js';
import { ApprovalError, PORTAL_PREFIX, activeRule, beforeApproving, onApproved, onClosed, saveRule, submitRequest, withdraw } from './approvals/engine.js';
import type { Actor } from './changeLog.js';
import { eachDay } from '../../utils/istDate.js';

/**
 * Shift swaps (FEATURE-UI-AUDIT gap 24; WORKFLOW-GAP-RESEARCH: Frappe HR's
 * shift request, Zoho Shifts' and Deputy's swap, greytHR's swap request).
 *
 *   1. A person asks a named colleague to swap shifts on a day or a few days
 *      in a row (at most seven, all still to come). The colleague must work a
 *      different shift on each of those days, neither may be off, on a
 *      holiday or on leave, and the swap may not leave either of them less
 *      than MIN_REST_HOURS between one shift's end and the next one's start.
 *   2. The colleague accepts or declines, from the employee app.
 *   3. Accepted, it goes through the approval engine as SHIFT_SWAP (default
 *      rule: the requester's manager), so it waits in the one Approvals inbox
 *      with ask-for-more, reply and withdraw like every other request.
 *   4. Approved, each gets a temporary schedule on the other's shift for those
 *      days. A temporary schedule wins over every other schedule
 *      (attendance/schedule.ts), so the days, lateness and payable days follow
 *      with nothing else to change. Both are told.
 *
 * Race safety: asking, answering and applying run inside peopleWrite, which
 * holds the company's write lock, and each re-reads under it: two swaps that
 * touch the same person on the same day cannot both be open, and a swap whose
 * schedules changed since it was asked is refused, never half applied.
 *
 * Not built: the women's night-work consent check. CLOR keeps no per-person
 * consent record (only the compliance obligation IN-OSH-WOMEN-NIGHT), so there
 * is nothing to check a swap against; see the PR.
 */

export const MAX_SWAP_DAYS = 7;
/** Rest between the end of one shift and the start of the next, both people, after the swap. */
export const MIN_REST_HOURS = 8;

export type SwapStatus = 'ASKED' | 'DECLINED' | 'WAITING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED';
export const OPEN: SwapStatus[] = ['ASKED', 'WAITING'];
type Day = { date: string; requesterShiftId: string; colleagueShiftId: string };
type SwapRow = Prisma.ShiftSwapGetPayload<object>;

export class SwapError extends Error {
  constructor(message: string, public status = 400, public code = 'SWAP_REFUSED') {
    super(message);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayWords = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const spanWords = (from: string, to: string) => (from === to ? dayWords(from) : `${dayWords(from)} to ${dayWords(to)}`);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
const addDays = (date: string, n: number) => new Date((dayNumber(date) + n) * 86_400_000).toISOString().slice(0, 10);
const ACTIVE = { notIn: ['LEFT', 'SUSPENDED'] };
/** The same days on the same shifts (the stored copy comes back from JSONB with its keys reordered). */
const sameDays = (a: Day[], b: unknown) => {
  const list = (Array.isArray(b) ? b : []) as Day[];
  return a.length === list.length && a.every((d, i) => d.date === list[i]?.date && d.requesterShiftId === list[i]?.requesterShiftId && d.colleagueShiftId === list[i]?.colleagueShiftId);
};

type Person = { id: string; name: string; code: string | null; userId: string | null; branchId: string | null; areaId: string | null; reportingManagerId: string | null; status: string };
const personSelect = { id: true, name: true, code: true, userId: true, branchId: true, areaId: true, reportingManagerId: true, status: true } as const;

/** What someone works on each day: a shift (id, hours), or why they are not working. */
type Plan = Map<string, { shiftId: string | null; name: string; start: string; end: string; off: string | null }>;

/**
 * Everything checkSwap reads, loaded once for some people and days: their
 * schedules, the holidays, their leave, the open swaps and the closed months.
 * The colleague picker checks a whole company against it in memory instead of
 * asking the database per person (review of PR #75, 4).
 */
export type SwapContext = { plans: Map<string, Plan>; open: Array<{ id: string; requesterEmployeeId: string; colleagueEmployeeId: string; fromDate: string; toDate: string }>; closed: string | null };

export async function swapContext(orgId: string, people: Person[], from: string, to: string): Promise<SwapContext> {
  const ids = people.map((p) => p.id);
  /* The day before and after, too: the rest rule looks across the edges. */
  const a = addDays(from, -1);
  const b = addDays(to, 1);
  const [data, holidays, leave, open, guard] = await Promise.all([
    loadSchedule(orgId, ids),
    loadHolidays(orgId, a, b),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: b }, toDate: { gte: a } }, select: { employeeId: true, fromDate: true, toDate: true, status: true } }),
    peoplePrisma.shiftSwap.findMany({ where: { orgId, status: { in: OPEN }, fromDate: { lte: to }, toDate: { gte: from } }, select: { id: true, requesterEmployeeId: true, colleagueEmployeeId: true, fromDate: true, toDate: true, approvalRequestId: true } }),
    scheduleGuard(orgId),
  ]);
  const plans = new Map<string, Plan>();
  for (const p of people) {
    const plan: Plan = new Map();
    const mine = holidays.forArea(p.areaId, p.branchId);
    for (const date of eachDay(a, b)) {
      const r = resolveShift(data, p.id, date);
      const onLeave = leave.find((l) => l.employeeId === p.id && l.fromDate <= date && l.toDate >= date);
      const off = onLeave ? (onLeave.status === 'PENDING' ? 'has leave waiting' : 'is on leave') : mine.has(date) ? 'has a holiday' : isWeeklyOff(r.rule, date) ? 'has a weekly off' : null;
      plan.set(date, { shiftId: r.shiftId, name: r.name, start: r.rule.startTime, end: r.rule.endTime, off });
    }
    plans.set(p.id, plan);
  }
  /* A swap whose approval closed without its record catching up is not open (squareUp says the same on reads). */
  const reqIds = open.map((o) => o.approvalRequestId).filter(Boolean) as string[];
  const closedReqs = reqIds.length ? new Set((await peoplePrisma.approvalRequest.findMany({ where: { orgId, id: { in: reqIds }, status: { in: ['REJECTED', 'WITHDRAWN'] } }, select: { id: true } })).map((r) => r.id)) : new Set<string>();
  const refusal = guard.refusal([{ from, to }]);
  return { plans, open: open.filter((o) => !o.approvalRequestId || !closedReqs.has(o.approvalRequestId)), closed: refusal ? refusal.message : null };
}

/** A shift on a date as minutes on one timeline: its start, and its end (the next morning for a night shift). */
const span = (date: string, start: string, end: string) => {
  const s = dayNumber(date) * 1440 + minutesOf(start);
  let e = dayNumber(date) * 1440 + minutesOf(end);
  if (isOvernight({ startTime: start, endTime: end })) e += 1440;
  return { s, e };
};

/**
 * The rest rule: on each swapped day, the new shift must start at least
 * MIN_REST_HOURS after the shift before it ended, and end at least that long
 * before the next one starts (the day before and after the swap included).
 * Returns the first day that breaks it, in words, or null.
 */
function restBreak(plan: Plan, swapped: Map<string, { start: string; end: string }>, from: string, to: string) {
  const work = (date: string) => {
    if (swapped.has(date)) return swapped.get(date)!;
    const p = plan.get(date);
    return p && !p.off ? { start: p.start, end: p.end } : null;
  };
  const need = MIN_REST_HOURS * 60;
  for (let d = addDays(from, -1); d <= to; d = addDays(d, 1)) {
    const a = work(d);
    const b = work(addDays(d, 1));
    if (!a || !b) continue;
    if (!swapped.has(d) && !swapped.has(addDays(d, 1))) continue;
    const gap = span(addDays(d, 1), b.start, b.end).s - span(d, a.start, a.end).e;
    if (gap < need) return { day: swapped.has(addDays(d, 1)) ? addDays(d, 1) : d, hours: Math.max(0, Math.round((gap / 60) * 10) / 10) };
  }
  return null;
}

/**
 * Everything that makes a swap possible or not, for two people and some
 * days, on the schedules as they are now. Returns the days, or throws a
 * SwapError saying what is wrong in plain words.
 */
export async function checkSwap(orgId: string, requester: Person, colleague: Person, from: string, to: string, opts: { exceptSwapId?: string | null; ctx?: SwapContext } = {}): Promise<Day[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new SwapError('Give the days as YYYY-MM-DD.');
  if (to < from) throw new SwapError('The last day is before the first.');
  if (from <= today()) throw new SwapError('A swap is for days still to come; today and earlier are already planned.');
  const dates = eachDay(from, to);
  if (dates.length > MAX_SWAP_DAYS) throw new SwapError(`Up to ${MAX_SWAP_DAYS} days in one swap.`);
  if (requester.id === colleague.id) throw new SwapError('Choose someone else to swap with.');
  if (ACTIVE.notIn.includes(colleague.status)) throw new SwapError(`${colleague.name} is not working here now.`);
  const ctx = opts.ctx || (await swapContext(orgId, [requester, colleague], from, to));
  const mine = ctx.plans.get(requester.id)!;
  const theirs = ctx.plans.get(colleague.id)!;
  const days: Day[] = [];
  for (const date of dates) {
    const a = mine.get(date)!;
    const b = theirs.get(date)!;
    if (a.off) throw new SwapError(`You ${a.off} on ${dayWords(date)}: there is no shift to swap.`, 409, 'NOT_WORKING');
    if (b.off) throw new SwapError(`${colleague.name} ${b.off} on ${dayWords(date)}.`, 409, 'NOT_WORKING');
    if (!a.shiftId || !b.shiftId) throw new SwapError(`Only shifts set up in Attendance can be swapped; ${!a.shiftId ? 'you work' : `${colleague.name} works`} the standard day on ${dayWords(date)}.`, 409, 'NO_SHIFT');
    if (a.shiftId === b.shiftId) throw new SwapError(`You both work ${a.name} on ${dayWords(date)}: nothing to swap.`, 409, 'SAME_SHIFT');
    days.push({ date, requesterShiftId: a.shiftId, colleagueShiftId: b.shiftId });
  }
  const after = (d: Day[], take: 'requester' | 'colleague') => new Map(d.map((x) => {
    const p = (take === 'requester' ? theirs : mine).get(x.date)!;
    return [x.date, { start: p.start, end: p.end }];
  }));
  const forMe = restBreak(mine, after(days, 'requester'), from, to);
  if (forMe) throw new SwapError(`The swap leaves you ${forMe.hours} hours between shifts around ${dayWords(forMe.day)}; at least ${MIN_REST_HOURS} are needed.`, 409, 'REST_RULE');
  const forThem = restBreak(theirs, after(days, 'colleague'), from, to);
  if (forThem) throw new SwapError(`The swap leaves ${colleague.name} ${forThem.hours} hours between shifts around ${dayWords(forThem.day)}; at least ${MIN_REST_HOURS} are needed.`, 409, 'REST_RULE');
  /* One open swap per person per day: a second would be decided on a schedule the first may change. */
  const both = [requester.id, colleague.id];
  const clash = ctx.open.find((x) => x.id !== opts.exceptSwapId && x.fromDate <= to && x.toDate >= from && (both.includes(x.requesterEmployeeId) || both.includes(x.colleagueEmployeeId)));
  if (clash) {
    const who = [clash.requesterEmployeeId, clash.colleagueEmployeeId].includes(requester.id) ? 'You already have' : `${colleague.name} already has`;
    throw new SwapError(`${who} a swap waiting for ${spanWords(clash.fromDate, clash.toDate)}. Wait for it, or withdraw it, first.`, 409, 'SWAP_OPEN');
  }
  /* A closed attendance month cannot take a schedule (O-05). */
  if (ctx.closed) throw new SwapError(ctx.closed, 409, 'MONTH_CLOSED');
  return days;
}

/** Each takes the other's shifts: a woman taking one into the night needs her consent on file (OSH Code s.43; nightConsent.ts). */
async function nightCheck(orgId: string, requester: Person, colleague: Person, days: Day[], self = true) {
  const refused = await nightRefusal(orgId, [{ employeeId: requester.id, shiftIds: days.map((d) => d.colleagueShiftId) }, { employeeId: colleague.id, shiftIds: days.map((d) => d.requesterShiftId) }], { self });
  if (refused) throw new SwapError(refused.message, 409, 'NIGHT_CONSENT');
}

async function personIn(orgId: string, id: string) {
  const p = await peoplePrisma.employee.findFirst({ where: { id, orgId }, select: personSelect });
  if (!p) throw new SwapError('No such person.', 404, 'NOT_FOUND');
  return p as Person;
}

/**
 * Colleagues one may ask for these days: working every one of them, on a
 * different shift each day, with the swap inside the rest rule. Names, codes
 * and their shifts on those days only: nothing else about them.
 */
export async function colleaguesFor(orgId: string, requesterId: string, from: string, to: string) {
  const requester = await personIn(orgId, requesterId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || eachDay(from, to).length > MAX_SWAP_DAYS || from <= today()) return [];
  const others = (await peoplePrisma.employee.findMany({ where: { orgId, id: { not: requester.id }, status: ACTIVE }, select: personSelect, orderBy: { name: 'asc' }, take: 500 })) as Person[];
  if (!others.length) return [];
  /* Read once for everyone; each colleague is then checked in memory. */
  const ctx = await swapContext(orgId, [requester, ...others], from, to);
  const shifts = new Map((await peoplePrisma.shift.findMany({ where: { orgId }, select: { id: true, name: true, startTime: true, endTime: true } })).map((s) => [s.id, s]));
  const out: Array<{ employeeId: string; name: string; code: string | null; days: Array<{ date: string; shift: string; startTime: string; endTime: string }> }> = [];
  for (const o of others) {
    try {
      const days = await checkSwap(orgId, requester, o, from, to, { ctx });
      out.push({ employeeId: o.id, name: o.name, code: o.code, days: days.map((d) => { const s = shifts.get(d.colleagueShiftId)!; return { date: d.date, shift: s.name, startTime: s.startTime, endTime: s.endTime }; }) });
    } catch (e) {
      if (!(e instanceof SwapError)) throw e;
    }
  }
  return out;
}

const requesterOf = (p: { id: string; userId: string | null }, userId?: string | null) => userId || p.userId || `${PORTAL_PREFIX}${p.id}`;
const tell = async (r: { accountId: string; orgId: string }, person: { userId: string | null }, title: string, body: string | null = null) => {
  if (person.userId) await notifyUsers(r.accountId, r.orgId, [person.userId], { kind: 'people.shift_swap', title, body, link: { app: 'people', screen: 'shiftSwaps' } as any });
};

/** Ask a colleague to swap. `userId`: the asker's CLOR sign-in, when they have one (the employee app otherwise). */
export async function askSwap(who: { accountId: string; orgId: string; employeeId: string; userId?: string | null }, body: { colleagueEmployeeId?: unknown; fromDate?: unknown; toDate?: unknown; reason?: unknown }) {
  const colleagueId = String(body.colleagueEmployeeId || '').trim();
  const from = String(body.fromDate || '').trim();
  const to = String(body.toDate || body.fromDate || '').trim();
  const reason = String(body.reason || '').trim().slice(0, 300) || null;
  if (!colleagueId) throw new SwapError('Choose who to swap with.');
  const swap = await peopleWrite(who.orgId, async () => {
    const requester = await personIn(who.orgId, who.employeeId);
    const colleague = await peoplePrisma.employee.findFirst({ where: { id: colleagueId, orgId: who.orgId }, select: personSelect });
    if (!colleague) throw new SwapError('That person is not in this company.', 400, 'NOT_FOUND');
    const days = await checkSwap(who.orgId, requester, colleague as Person, from, to);
    await nightCheck(who.orgId, requester, colleague as Person, days);
    return peoplePrisma.shiftSwap.create({
      data: { accountId: who.accountId, orgId: who.orgId, requesterEmployeeId: requester.id, colleagueEmployeeId: colleague.id, fromDate: from, toDate: to, days: days as unknown as Prisma.InputJsonValue, reason, status: 'ASKED', requestedByUserId: requesterOf(requester, who.userId) },
    });
  });
  const [requester, colleague] = await Promise.all([personIn(who.orgId, swap.requesterEmployeeId), personIn(who.orgId, swap.colleagueEmployeeId)]);
  await tell(swap, colleague, `${requester.name} asks to swap shifts with you`, `${spanWords(swap.fromDate, swap.toDate)}. Accept or decline in the employee app.`);
  return swap;
}

const OLD_RULE_NAME = 'Shift swaps (default: their manager)';
const RULE_NAME = 'Shift swaps (default: both managers)';
/**
 * The company's swap rule, written the first time a swap is accepted: the
 * requester's manager, then the colleague's manager when that is someone else
 * (HR stands in for a missing manager), two working days each. The first
 * default, one step, is moved on to this one; a rule HR wrote is left alone.
 */
async function ensureRule(accountId: string, orgId: string) {
  const rule = await activeRule(orgId, 'SHIFT_SWAP');
  if (rule && rule.name !== OLD_RULE_NAME) return;
  await saveRule({ accountId, orgId, userId: null }, 'SHIFT_SWAP', RULE_NAME, [
    { order: 1, approver: { kind: 'MANAGER' }, dueDays: 2, overdue: { action: 'REMIND' } },
    { order: 2, approver: { kind: 'COLLEAGUE_MANAGER' }, dueDays: 2, overdue: { action: 'REMIND' } },
  ]);
}

async function linesOf(orgId: string, swap: { requesterEmployeeId: string; colleagueEmployeeId: string; days: unknown; reason: string | null }, names: { requester: string; colleague: string }) {
  const days = (swap.days || []) as Day[];
  const shifts = new Map((await peoplePrisma.shift.findMany({ where: { orgId, id: { in: days.flatMap((d) => [d.requesterShiftId, d.colleagueShiftId]) } }, select: { id: true, name: true, startTime: true, endTime: true } })).map((s) => [s.id, `${s.name} ${s.startTime}–${s.endTime}`]));
  return [
    ...days.map((d) => ({ label: dayWords(d.date), value: `${names.requester}: ${shifts.get(d.requesterShiftId) || '—'} → ${shifts.get(d.colleagueShiftId) || '—'}; ${names.colleague}: the other way` })),
    ...(swap.reason ? [{ label: 'Why', value: swap.reason }] : []),
  ];
}

/** The colleague accepts (it goes for approval) or declines (it closes). Only the colleague, only while it is asked. */
export async function answerSwap(who: { accountId: string; orgId: string; employeeId: string; correlationId: string }, swapId: string, accept: boolean, note?: string | null) {
  const text = String(note || '').trim().slice(0, 300) || null;
  const out = await peopleWrite(who.orgId, async () => {
    const swap = await peoplePrisma.shiftSwap.findFirst({ where: { id: swapId, orgId: who.orgId } });
    if (!swap || swap.colleagueEmployeeId !== who.employeeId) throw new SwapError('No such swap.', 404, 'NOT_FOUND');
    if (swap.status !== 'ASKED') throw new SwapError(`This swap is already ${words(swap.status)}.`, 409, 'NOT_ASKED');
    const [requester, colleague] = await Promise.all([personIn(who.orgId, swap.requesterEmployeeId), personIn(who.orgId, swap.colleagueEmployeeId)]);
    if (!accept) {
      const claimed = await peoplePrisma.shiftSwap.updateMany({ where: { id: swap.id, status: 'ASKED' }, data: { status: 'DECLINED', colleagueNote: text, colleagueAnsweredAt: new Date() } });
      if (!claimed.count) throw new SwapError('This swap was answered a moment ago.', 409, 'NOT_ASKED');
      return { swap: await peoplePrisma.shiftSwap.findUniqueOrThrow({ where: { id: swap.id } }), requester, colleague };
    }
    /* Checked again now: the schedules may have moved since it was asked. */
    const days = await checkSwap(who.orgId, requester, colleague, swap.fromDate, swap.toDate, { exceptSwapId: swap.id });
    if (!sameDays(days, swap.days)) throw new SwapError('The shifts on those days changed since this was asked. Ask for the swap again.', 409, 'SCHEDULE_CHANGED');
    const claimed = await peoplePrisma.shiftSwap.updateMany({ where: { id: swap.id, status: 'ASKED' }, data: { status: 'WAITING', colleagueNote: text, colleagueAnsweredAt: new Date() } });
    if (!claimed.count) throw new SwapError('This swap was answered a moment ago.', 409, 'NOT_ASKED');
    await ensureRule(who.accountId, who.orgId);
    const actor: Actor = { accountId: who.accountId, orgId: who.orgId, userId: swap.requestedByUserId, source: 'SELF_SERVICE', correlationId: who.correlationId, reason: swap.reason };
    const r = await submitRequest(actor, {
      requestType: 'SHIFT_SWAP', subjectEmployeeId: requester.id,
      title: `Shift swap: ${requester.name} with ${colleague.name}, ${spanWords(swap.fromDate, swap.toDate)}`,
      /* The colleague is a party: they never decide it (engine partyEmployeeIds). */
      payload: { swapId: swap.id, employeeId: requester.id, colleagueEmployeeId: colleague.id, partyEmployeeIds: [colleague.id], colleagueName: colleague.name, fromDate: swap.fromDate, toDate: swap.toDate, reason: swap.reason, colleagueNote: text, lines: await linesOf(who.orgId, swap, { requester: requester.name, colleague: colleague.name }) },
      idempotencyKey: `shift-swap:${swap.id}`,
    });
    await peoplePrisma.shiftSwap.update({ where: { id: swap.id }, data: { approvalRequestId: r.request.id } });
    return { swap: await peoplePrisma.shiftSwap.findUniqueOrThrow({ where: { id: swap.id } }), requester, colleague };
  });
  if (!accept) await tell(out.swap, out.requester, `${out.colleague.name} declined your shift swap`, text ? `“${text}”` : spanWords(out.swap.fromDate, out.swap.toDate));
  else await tell(out.swap, out.requester, `${out.colleague.name} accepted your shift swap`, 'It now waits for approval.');
  return out.swap;
}

/** The asker takes it back before it is decided: while the colleague has not answered, or while it waits for approval. */
export async function withdrawSwap(who: { accountId: string; orgId: string; employeeId: string; correlationId: string }, swapId: string) {
  const swap = await peoplePrisma.shiftSwap.findFirst({ where: { id: swapId, orgId: who.orgId } });
  if (!swap || swap.requesterEmployeeId !== who.employeeId) throw new SwapError('No such swap.', 404, 'NOT_FOUND');
  if (swap.status === 'WAITING' && swap.approvalRequestId) {
    try {
      await withdraw({ accountId: who.accountId, orgId: who.orgId, userId: swap.requestedByUserId, source: 'SELF_SERVICE', correlationId: who.correlationId }, swap.approvalRequestId);
    } catch (e) {
      if (e instanceof ApprovalError) throw new SwapError(e.message, e.status, e.code);
      throw e;
    }
    return peoplePrisma.shiftSwap.findUniqueOrThrow({ where: { id: swap.id } });
  }
  const claimed = await peoplePrisma.shiftSwap.updateMany({ where: { id: swap.id, orgId: who.orgId, status: 'ASKED' }, data: { status: 'WITHDRAWN', closedNote: 'Withdrawn before the colleague answered.' } });
  if (!claimed.count) throw new SwapError(`This swap is already ${words(swap.status)}.`, 409, 'NOT_OPEN');
  const colleague = await personIn(who.orgId, swap.colleagueEmployeeId);
  const requester = await personIn(who.orgId, swap.requesterEmployeeId);
  await tell(swap, colleague, `${requester.name} withdrew the shift swap`, spanWords(swap.fromDate, swap.toDate));
  return peoplePrisma.shiftSwap.findUniqueOrThrow({ where: { id: swap.id } });
}

/** Contiguous days on the same shift, as one schedule each. */
function runs(list: Array<{ date: string; shiftId: string }>) {
  const out: Array<{ from: string; to: string; shiftId: string }> = [];
  for (const d of list) {
    const last = out[out.length - 1];
    if (last && last.shiftId === d.shiftId && addDays(last.to, 1) === d.date) last.to = d.date;
    else out.push({ from: d.date, to: d.date, shiftId: d.shiftId });
  }
  return out;
}

/**
 * Approval: the schedules are checked once more (they may have moved since
 * the colleague accepted) and each person gets the other's shift for those
 * days. Anything wrong throws, and the engine closes the request as not
 * applied with the reason.
 */
async function applySwap(request: { id: string; orgId: string; accountId: string; payload: unknown }, actor: Actor) {
  const swapId = String((request.payload as { swapId?: unknown })?.swapId || '');
  return peopleWrite(request.orgId, async () => {
    const swap = await peoplePrisma.shiftSwap.findFirst({ where: { id: swapId, orgId: request.orgId } });
    if (!swap || swap.approvalRequestId !== request.id) throw new ApprovalError('This request is not a shift swap anyone asked for.', 409, 'NOT_A_SWAP');
    if (swap.status !== 'WAITING') throw new ApprovalError(`The swap is ${words(swap.status)}.`, 409, 'NOT_WAITING');
    const [requester, colleague] = await Promise.all([personIn(request.orgId, swap.requesterEmployeeId), personIn(request.orgId, swap.colleagueEmployeeId)]);
    let days: Day[];
    try {
      days = await checkSwap(request.orgId, requester, colleague, swap.fromDate, swap.toDate, { exceptSwapId: swap.id });
      await nightCheck(request.orgId, requester, colleague, days, false);
    } catch (e) {
      if (e instanceof SwapError) throw new ApprovalError(e.message, 409, e.code);
      throw e;
    }
    if (!sameDays(days, swap.days)) throw new ApprovalError('The shifts on those days changed since the swap was asked.', 409, 'SCHEDULE_CHANGED');
    const reason = (name: string) => `Shift swap with ${name}`.slice(0, 200);
    /*
     * A temporary schedule already on those days (cover, a shift change) would
     * sit beside the swap's and resolveShift would pick either. It is cut
     * around the swapped days: kept as it was, the parts before and after
     * written back, so cancelling the swap can put it back whole.
     */
    const originals: Array<Record<string, unknown>> = [];
    const pieces: string[] = [];
    for (const person of [requester, colleague]) {
      const covering = await peoplePrisma.temporarySchedule.findMany({ where: { orgId: request.orgId, employeeId: person.id, fromDate: { lte: swap.toDate }, toDate: { gte: swap.fromDate } } });
      for (const t of covering) {
        originals.push({ employeeId: t.employeeId, shiftId: t.shiftId, fromDate: t.fromDate, toDate: t.toDate, reason: t.reason, pickedByPunch: t.pickedByPunch, createdByUserId: t.createdByUserId });
        await peoplePrisma.temporarySchedule.delete({ where: { id: t.id } });
        const keep = [t.fromDate < swap.fromDate ? { from: t.fromDate, to: addDays(swap.fromDate, -1) } : null, t.toDate > swap.toDate ? { from: addDays(swap.toDate, 1), to: t.toDate } : null].filter(Boolean) as Array<{ from: string; to: string }>;
        for (const k of keep) {
          const piece = await peoplePrisma.temporarySchedule.create({ data: { accountId: t.accountId, orgId: t.orgId, employeeId: t.employeeId, shiftId: t.shiftId, fromDate: k.from, toDate: k.to, reason: t.reason, pickedByPunch: t.pickedByPunch, createdByUserId: t.createdByUserId } });
          pieces.push(piece.id);
        }
      }
    }
    const created: string[] = [];
    for (const [person, other, pick] of [[requester, colleague, (d: Day) => d.colleagueShiftId], [colleague, requester, (d: Day) => d.requesterShiftId]] as const) {
      for (const r of runs(days.map((d) => ({ date: d.date, shiftId: pick(d) })))) {
        const t = await peoplePrisma.temporarySchedule.create({ data: { accountId: request.accountId, orgId: request.orgId, employeeId: person.id, shiftId: r.shiftId, fromDate: r.from, toDate: r.to, reason: reason(other.name), createdByUserId: actor.userId || 'system' } });
        created.push(t.id);
      }
    }
    const claimed = await peoplePrisma.shiftSwap.updateMany({ where: { id: swap.id, status: 'WAITING' }, data: { status: 'APPROVED', scheduleIds: created, replacedSchedules: originals.length ? ({ originals, pieces } as Prisma.InputJsonValue) : undefined } });
    if (!claimed.count) throw new ApprovalError('The swap changed a moment ago.', 409, 'NOT_WAITING');
    /* Told once the schedules are written for good, not from inside the transaction. */
    afterPeopleCommit(() => void tell(swap, colleague, `Shift swap approved: ${spanWords(swap.fromDate, swap.toDate)}`, `You work ${requester.name}'s shift on those days.`));
    return { swapId: swap.id, schedules: created.length };
  });
}

/** HR takes back an approved swap whose days have not started: the schedules go, both are told. */
export async function cancelSwap(who: { accountId: string; orgId: string; userId: string }, swapId: string, note: string | null) {
  const out = await peopleWrite(who.orgId, async () => {
    const swap = await peoplePrisma.shiftSwap.findFirst({ where: { id: swapId, orgId: who.orgId } });
    if (!swap) throw new SwapError('No such swap.', 404, 'NOT_FOUND');
    if (swap.status !== 'APPROVED') throw new SwapError(`Only an approved swap can be cancelled; this one is ${words(swap.status)}.`, 409, 'NOT_APPROVED');
    if (swap.fromDate <= today()) throw new SwapError('The swap has started; change the schedule instead.', 409, 'STARTED');
    try {
      await assertScheduleOpen(who.orgId, [{ from: swap.fromDate, to: swap.toDate }]);
    } catch (e) {
      throw new SwapError(e instanceof Error ? e.message : 'That month is closed.', 409, 'MONTH_CLOSED');
    }
    const claimed = await peoplePrisma.shiftSwap.updateMany({ where: { id: swap.id, status: 'APPROVED' }, data: { status: 'CANCELLED', closedNote: note || 'Cancelled by HR.' } });
    if (!claimed.count) throw new SwapError('This swap changed a moment ago.', 409, 'NOT_APPROVED');
    if (swap.scheduleIds.length) await peoplePrisma.temporarySchedule.deleteMany({ where: { orgId: who.orgId, id: { in: swap.scheduleIds } } });
    /* The temporary schedules the swap cut around come back as they were. */
    const replaced = (swap.replacedSchedules || null) as { originals?: Array<Record<string, any>>; pieces?: string[] } | null;
    if (replaced?.pieces?.length) await peoplePrisma.temporarySchedule.deleteMany({ where: { orgId: who.orgId, id: { in: replaced.pieces } } });
    for (const o of replaced?.originals || []) {
      await peoplePrisma.temporarySchedule.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId: String(o.employeeId), shiftId: String(o.shiftId), fromDate: String(o.fromDate), toDate: String(o.toDate), reason: o.reason ?? null, pickedByPunch: Boolean(o.pickedByPunch), createdByUserId: String(o.createdByUserId || who.userId) } });
    }
    return swap;
  });
  const [requester, colleague] = await Promise.all([personIn(who.orgId, out.requesterEmployeeId), personIn(who.orgId, out.colleagueEmployeeId)]);
  for (const p of [requester, colleague]) await tell(out, p, `Shift swap cancelled: ${spanWords(out.fromDate, out.toDate)}`, note || 'Your usual shifts apply on those days.');
  return peoplePrisma.shiftSwap.findUniqueOrThrow({ where: { id: out.id } });
}

const WORDS: Record<string, string> = { ASKED: 'waiting for the colleague', DECLINED: 'declined', WAITING: 'waiting for approval', APPROVED: 'approved', REJECTED: 'not approved', WITHDRAWN: 'withdrawn', CANCELLED: 'cancelled' };
const words = (s: string) => WORDS[s] || s.toLowerCase();

/** A swap waiting for approval whose request closed without it (missed by the hook): shown as closed on every read. */
async function squareUp(rows: SwapRow[]) {
  const waiting = rows.filter((r) => r.status === 'WAITING' && r.approvalRequestId);
  if (!waiting.length) return rows;
  const reqs = await peoplePrisma.approvalRequest.findMany({ where: { id: { in: waiting.map((r) => r.approvalRequestId!) } }, select: { id: true, status: true } });
  const closed = new Map(reqs.filter((r) => r.status === 'REJECTED' || r.status === 'WITHDRAWN').map((r) => [r.id, r.status]));
  if (!closed.size) return rows;
  /* Said as it is, never written from a read: the engine's onClosed hook writes the record. */
  return rows.map((r) => {
    const s = r.approvalRequestId ? closed.get(r.approvalRequestId) : null;
    return r.status === 'WAITING' && s ? { ...r, status: s } : r;
  });
}

/** Swaps for screens: with names, shifts, the approval's status and its current step. */
export async function shapeSwaps(orgId: string, rows: SwapRow[]) {
  rows = await squareUp(rows);
  const ids = [...new Set(rows.flatMap((r) => [r.requesterEmployeeId, r.colleagueEmployeeId]))];
  const [people, shifts, requests] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, photoUrl: true } }),
    peoplePrisma.shift.findMany({ where: { orgId }, select: { id: true, name: true, startTime: true, endTime: true, color: true } }),
    peoplePrisma.approvalRequest.findMany({ where: { orgId, id: { in: rows.map((r) => r.approvalRequestId).filter(Boolean) as string[] } }, select: { id: true, status: true, outcome: true, steps: { select: { status: true, comment: true, order: true, createdAt: true }, orderBy: { createdAt: 'asc' } } } }),
  ]);
  const p = new Map(people.map((x) => [x.id, x]));
  const s = new Map(shifts.map((x) => [x.id, x]));
  const q = new Map(requests.map((x) => [x.id, x]));
  const shiftOf = (id: string) => { const x = s.get(id); return x ? { id: x.id, name: x.name, startTime: x.startTime, endTime: x.endTime, color: x.color } : { id, name: '—', startTime: '', endTime: '', color: null }; };
  return rows.map((r) => {
    const req = r.approvalRequestId ? q.get(r.approvalRequestId) : null;
    const last = req?.steps.filter((x) => x.comment && x.status !== 'SKIPPED').slice(-1)[0];
    return {
      id: r.id, status: r.status, statusWords: words(r.status), fromDate: r.fromDate, toDate: r.toDate, reason: r.reason, colleagueNote: r.colleagueNote, closedNote: r.closedNote,
      requester: { id: r.requesterEmployeeId, name: p.get(r.requesterEmployeeId)?.name || '', code: p.get(r.requesterEmployeeId)?.code || null, photoUrl: p.get(r.requesterEmployeeId)?.photoUrl || null },
      colleague: { id: r.colleagueEmployeeId, name: p.get(r.colleagueEmployeeId)?.name || '', code: p.get(r.colleagueEmployeeId)?.code || null, photoUrl: p.get(r.colleagueEmployeeId)?.photoUrl || null },
      days: ((r.days || []) as Day[]).map((d) => ({ date: d.date, requesterShift: shiftOf(d.requesterShiftId), colleagueShift: shiftOf(d.colleagueShiftId) })),
      approvalRequestId: r.approvalRequestId, approvalStatus: req?.status || null, moreInfo: req?.status === 'MORE_INFO', decisionNote: last?.comment || null,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  });
}

/** The employee app's view: what I asked, and what others asked of me. */
export async function swapsOf(orgId: string, employeeId: string) {
  const since = addDays(today(), -60);
  const rows = await peoplePrisma.shiftSwap.findMany({ where: { orgId, toDate: { gte: since }, OR: [{ requesterEmployeeId: employeeId }, { colleagueEmployeeId: employeeId }] }, orderBy: { createdAt: 'desc' }, take: 100 });
  const shaped = await shapeSwaps(orgId, rows);
  return { mine: shaped.filter((r) => r.requester.id === employeeId), askedOfMe: shaped.filter((r) => r.colleague.id === employeeId) };
}

/** People's list for HR (everyone) and managers (their team): newest first, by status. */
export async function listSwaps(orgId: string, scope: { all: boolean; ids: string[] }, opts: { status?: string | null } = {}) {
  const where: Prisma.ShiftSwapWhereInput = { orgId };
  if (opts.status && Object.keys(WORDS).includes(opts.status)) where.status = opts.status;
  if (!scope.all) where.OR = [{ requesterEmployeeId: { in: scope.ids } }, { colleagueEmployeeId: { in: scope.ids } }];
  const rows = await peoplePrisma.shiftSwap.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
  return shapeSwaps(orgId, rows);
}

/* Registered once, with the engine: what approval does, and keeping the swap in step when it closes otherwise. */
let registered = false;
export function registerShiftSwaps() {
  if (registered) return;
  registered = true;
  onApproved('SHIFT_SWAP', ({ request, actor }) => applySwap(request, actor));
  /* A schedule that moved since the colleague accepted is said before the decision, not after. */
  beforeApproving('SHIFT_SWAP', async (request) => {
    const swapId = String((request.payload as { swapId?: unknown })?.swapId || '');
    const swap = await peoplePrisma.shiftSwap.findFirst({ where: { id: swapId, orgId: request.orgId } });
    if (!swap || swap.status !== 'WAITING') return;
    const [requester, colleague] = await Promise.all([personIn(request.orgId, swap.requesterEmployeeId), personIn(request.orgId, swap.colleagueEmployeeId)]);
    try {
      const days = await checkSwap(request.orgId, requester, colleague, swap.fromDate, swap.toDate, { exceptSwapId: swap.id });
      if (!sameDays(days, swap.days)) throw new SwapError('The shifts on those days changed since the swap was asked. Reject it; they can ask again.', 409, 'SCHEDULE_CHANGED');
    } catch (e) {
      if (e instanceof SwapError) throw new ApprovalError(e.message, 409, e.code);
      throw e;
    }
  });
  onClosed('SHIFT_SWAP', async (request, status, note) => {
    const swapId = String((request.payload as { swapId?: unknown })?.swapId || '');
    const swap = await peoplePrisma.shiftSwap.findFirst({ where: { id: swapId, orgId: request.orgId, approvalRequestId: request.id } });
    if (!swap) return;
    const moved = await peoplePrisma.shiftSwap.updateMany({ where: { id: swap.id, status: 'WAITING' }, data: { status, closedNote: note } });
    if (!moved.count) return;
    const colleague = await personIn(request.orgId, swap.colleagueEmployeeId);
    await tell(swap, colleague, status === 'WITHDRAWN' ? 'A shift swap with you was withdrawn' : 'A shift swap with you was not approved', `${spanWords(swap.fromDate, swap.toDate)}${note ? `: ${note}` : ''}`);
  });
}
