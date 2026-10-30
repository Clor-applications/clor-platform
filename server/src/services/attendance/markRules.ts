import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { assertMonthOpen, daysOfMonth, payrollTaken, periodContext, today } from './days.js';
import { balancesFor, leaveYearOf } from './leaveBalances.js';
import { currentRuleVersion, rulesOf, timeRulesFor, type MarkRules } from './timeRules.js';

/**
 * Late marks and early exits that cost part of a day (WORKFLOW-GAP-RESEARCH-2026-10-30 B3, 4.4).
 *
 * The rule, in one sentence: every [N] late marks in a month after [grace] minutes cost [½ or 1]
 * day, taken from [these leave types, in order], else loss of pay; early exits counted the same
 * way when switched on. The first [free] marks of each kind cost nothing.
 *
 * Until someone decides a month, its penalty is worked out from the rules each time; payable days
 * count the part leave cannot cover as loss of pay, and say so ("late penalty"). Deciding:
 *  - Waive (a manager for their team, HR for anyone): the month costs nothing, with the reason kept.
 *  - Apply (HR, once the month has ended): the days are taken from leave in the rule's order as
 *    leave adjustments, the rest stays loss of pay, and the rule version is kept with the month.
 * Either can be undone while the Attendance month is open and payroll has not taken it.
 *
 * Not a fine: a deduction for time not worked, in proportion (Code on Wages s.18, s.19), under
 * rules the employee can read (the policy text is in the employee app). Fines for lateness need a
 * notified list of acts; CLOR does not do fines.
 */

const round = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthWords = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

type Rec = { date: string; status: string; lateMinutes: number; earlyOutMinutes: number; checkIn?: Date | null; checkOut?: Date | null };

export class MarksError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

/** The days of a month whose arrival or leaving counts as a mark under these rules. */
export function marksOf(rules: MarkRules, records: Iterable<Rec>, inSpan: (date: string) => boolean) {
  const late: string[] = [];
  const early: string[] = [];
  for (const r of records) {
    if (!inSpan(r.date) || (r.status !== 'PRESENT' && r.status !== 'HALF_DAY')) continue;
    if (rules.late.on && r.lateMinutes > 0 && r.lateMinutes > (rules.late.graceMinutes ?? 0)) late.push(r.date);
    if (rules.early.on && r.checkOut && r.earlyOutMinutes > 0 && r.earlyOutMinutes > (rules.early.graceMinutes ?? 0)) early.push(r.date);
  }
  return { late: late.sort(), early: early.sort() };
}

/** Days the marks cost: each kind on its own count, at the rule's cost per step. */
export function costOf(rules: MarkRules, lateCount: number, earlyCount: number) {
  if (!rules.on) return 0;
  const steps = (k: MarkRules['late'], n: number) => (k.on && k.every > 0 ? Math.floor(Math.max(0, n - k.free) / k.every) : 0);
  return round((steps(rules.late, lateCount) + steps(rules.early, earlyCount)) * rules.cost);
}

/** How far to the next cost, for the employee's line: "2 of 3 late marks; the next one costs ½ day". */
export function nextCost(k: MarkRules['late'], count: number) {
  if (!k.on || k.every <= 0) return null;
  const counted = Math.max(0, count - k.free);
  const into = counted % k.every;
  return { into, every: k.every, left: k.every - into, free: Math.max(0, k.free - count) };
}

export type LeavePart = { leaveTypeId: string; name: string; days: number; adjustmentId?: string };
export type PenaltyRow = {
  employeeId: string;
  lateMarks: number;
  earlyMarks: number;
  lateDates: string[];
  earlyDates: string[];
  /** What the rules give. */
  days: number;
  /** DUE (worked out, nobody decided) | WAIVED | APPLIED | NONE (nothing to pay). */
  status: 'DUE' | 'WAIVED' | 'APPLIED' | 'NONE';
  /** From leave: taken (APPLIED) or as it would be taken now (DUE). */
  fromLeave: LeavePart[];
  /** The days that are loss of pay: what payable days take off. */
  lossOfPayDays: number;
  decision: { by: string; at: Date; reason: string | null; ruleVersion: number } | null;
};

/** Split penalty days over the rule's leave types, in order, in half days, by what each person has left. */
async function splitOverLeave(accountId: string, orgId: string, rules: MarkRules, month: string, owed: Map<string, number>) {
  const out = new Map<string, LeavePart[]>();
  const ids = [...owed.entries()].filter(([, d]) => d > 0).map(([id]) => id);
  if (!rules.takeFrom.length || !ids.length) return out;
  const last = daysOfMonth(month).at(-1)!;
  const year = await leaveYearOf(orgId, last);
  const [{ balances }, types] = await Promise.all([
    balancesFor(accountId, orgId, ids, year, last),
    peoplePrisma.leaveType.findMany({ where: { orgId, id: { in: rules.takeFrom }, isPaid: true }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(types.map((t) => [t.id, t.name]));
  for (const id of ids) {
    let left = owed.get(id)!;
    const parts: LeavePart[] = [];
    for (const typeId of rules.takeFrom) {
      if (left <= 0 || !nameOf.has(typeId)) continue;
      const available = balances.get(id)?.get(typeId)?.available ?? 0;
      const take = Math.min(left, Math.floor(Math.max(0, available) * 2) / 2);
      if (take <= 0) continue;
      parts.push({ leaveTypeId: typeId, name: nameOf.get(typeId)!, days: round(take) });
      left = round(left - take);
    }
    out.set(id, parts);
  }
  return out;
}

/**
 * Each person's penalty over these days. A whole calendar month uses the decisions taken for it;
 * any other run of days (a pay period from the 26th) is worked out from the rules alone. `draft`
 * works the month out under rules not yet saved, for the preview.
 */
export async function penaltiesOver(accountId: string, orgId: string, days: string[], opts: { ctx?: Awaited<ReturnType<typeof periodContext>>; employeeIds?: string[]; draft?: MarkRules } = {}): Promise<Map<string, PenaltyRow>> {
  const ctx = opts.ctx || (await periodContext(accountId, orgId, days[0], days[days.length - 1]));
  const rules = opts.draft || rulesOf(ctx.settings).marks;
  const month = days[0].slice(0, 7);
  const wholeMonth = days.length === daysOfMonth(month).length && days[0] === `${month}-01`;
  const keep = opts.employeeIds ? new Set(opts.employeeIds) : null;
  const decided = wholeMonth && !opts.draft ? await peoplePrisma.attendancePenalty.findMany({ where: { orgId, month, ...(keep ? { employeeId: { in: [...keep] } } : {}) } }) : [];
  const decisionOf = new Map(decided.map((d) => [d.employeeId, d]));
  const out = new Map<string, PenaltyRow>();
  const owed = new Map<string, number>();
  for (const p of ctx.people) {
    if (keep && !keep.has(p.id)) continue;
    const span = new Set(ctx.spanOf(p).filter((d) => days.includes(d)));
    const recs = ctx.recordsOf.get(p.id) || new Map();
    const marks = rules.on ? marksOf(rules, recs.values() as Iterable<Rec>, (d) => span.has(d)) : { late: [], early: [] };
    const d = decisionOf.get(p.id);
    const cost = costOf(rules, marks.late.length, marks.early.length);
    const row: PenaltyRow = { employeeId: p.id, lateMarks: marks.late.length, earlyMarks: marks.early.length, lateDates: marks.late, earlyDates: marks.early, days: cost, status: cost > 0 ? 'DUE' : 'NONE', fromLeave: [], lossOfPayDays: cost, decision: null };
    if (d) {
      row.decision = { by: d.decidedByUserId, at: d.decidedAt, reason: d.reason, ruleVersion: d.ruleVersion };
      if (d.status === 'WAIVED') Object.assign(row, { status: 'WAIVED', fromLeave: [], lossOfPayDays: 0 });
      /* Applied: what was taken then, under the rules of then, whatever the rules say now. */
      if (d.status === 'APPLIED') Object.assign(row, { status: 'APPLIED', days: d.days, lateMarks: d.lateMarks, earlyMarks: d.earlyMarks, fromLeave: (Array.isArray(d.fromLeave) ? d.fromLeave : []) as LeavePart[], lossOfPayDays: d.lossOfPayDays });
    } else if (cost > 0) owed.set(p.id, cost);
    out.set(p.id, row);
  }
  const split = await splitOverLeave(accountId, orgId, rules, month, owed);
  for (const [id, parts] of split) {
    const row = out.get(id)!;
    row.fromLeave = parts;
    row.lossOfPayDays = round(row.days - parts.reduce((s, x) => s + x.days, 0));
  }
  return out;
}

/** The month's penalties for a screen: people with marks or a decision, with names, newest problems first. */
export async function monthPenalties(accountId: string, orgId: string, month: string, opts: { employeeIds?: string[]; draft?: MarkRules } = {}) {
  const days = daysOfMonth(month);
  const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1]);
  const rules = opts.draft || rulesOf(ctx.settings).marks;
  const rows = await penaltiesOver(accountId, orgId, days, { ctx, ...opts });
  const names = new Map(ctx.people.map((p) => [p.id, p]));
  const deciders = [...new Set([...rows.values()].map((r) => r.decision?.by).filter(Boolean) as string[])];
  const users = deciders.length ? new Map((await platformPrisma.user.findMany({ where: { id: { in: deciders.filter((u) => !u.startsWith('portal:')) } }, select: { id: true, fullName: true, email: true } })).map((u) => [u.id, u.fullName || u.email])) : new Map<string, string>();
  const list = [...rows.values()]
    .filter((r) => r.lateMarks || r.earlyMarks || r.decision)
    .map((r) => ({ ...r, name: names.get(r.employeeId)?.name || '—', code: names.get(r.employeeId)?.code || null, department: names.get(r.employeeId)?.department || null, decidedBy: r.decision ? users.get(r.decision.by) || null : null }))
    .sort((a, b) => b.days - a.days || b.lateMarks + b.earlyMarks - (a.lateMarks + a.earlyMarks) || a.name.localeCompare(b.name));
  const last = days[days.length - 1];
  return {
    month,
    rules,
    ended: last < today(),
    totals: {
      people: list.filter((r) => r.days > 0).length,
      due: list.filter((r) => r.status === 'DUE').length,
      days: round(list.filter((r) => r.status !== 'WAIVED').reduce((s, r) => s + r.days, 0)),
      lossOfPayDays: round(list.reduce((s, r) => s + r.lossOfPayDays, 0)),
      fromLeaveDays: round(list.reduce((s, r) => s + r.fromLeave.reduce((x, p) => x + p.days, 0), 0)),
      waived: list.filter((r) => r.status === 'WAIVED').length,
      applied: list.filter((r) => r.status === 'APPLIED').length,
    },
    rows: list,
  };
}

// ---------------------------------------------------------------------------
// Deciding: waive, apply, undo
// ---------------------------------------------------------------------------

type Actor = { accountId: string; orgId: string; userId: string };
const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

async function audit(who: Actor, entityId: string, action: string, message: string, metadata: Record<string, unknown>) {
  await platformPrisma.auditLog
    .create({ data: { accountId: who.accountId, orgId: who.orgId, branchId: '', entity: 'AttendancePenalty', entityId, action, message: message.slice(0, 500), metadata: JSON.stringify(metadata).slice(0, 20_000), createdByUserId: who.userId, correlationId: null } })
    .catch((e) => console.error('[late marks] audit not recorded:', e instanceof Error ? e.message : e));
}

/** Waive a person's penalty for a month, with the reason. Refused once applied (undo the apply first) or decided already. */
export async function waive(who: Actor, employeeId: string, month: string, reason: string) {
  if (!isMonth(month)) throw new MarksError('Month must be YYYY-MM.');
  const why = String(reason || '').trim();
  if (why.length < 3) throw new MarksError('Say why it is waived.');
  const last = daysOfMonth(month).at(-1)!;
  await assertMonthOpen(who.orgId, last, employeeId);
  return peopleWrite(who.orgId, async () => {
    const row = (await penaltiesOver(who.accountId, who.orgId, daysOfMonth(month), { employeeIds: [employeeId] })).get(employeeId);
    if (!row) throw new MarksError('No such person in this month.', 404);
    if (row.status === 'APPLIED') throw new MarksError('This penalty was applied. Undo the apply first, then waive it.', 409, 'APPLIED');
    if (row.status === 'WAIVED') throw new MarksError('Already waived.', 409, 'DECIDED');
    if (row.days <= 0) throw new MarksError('There is no penalty to waive this month.', 409, 'NOTHING');
    const made = await peoplePrisma.attendancePenalty.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId, month, status: 'WAIVED', lateMarks: row.lateMarks, earlyMarks: row.earlyMarks, days: row.days, reason: why.slice(0, 500), ruleVersion: await currentRuleVersion(who.orgId), decidedByUserId: who.userId } });
    await audit(who, made.id, 'WAIVE', `Waived ${row.days} day late-mark penalty for ${monthWords(month)}: ${why}`, { employeeId, month, days: row.days, lateMarks: row.lateMarks, earlyMarks: row.earlyMarks });
    return made;
  });
}

/** Take back a waiver or an apply: the month is worked out from the rules again; leave taken goes back. */
export async function undo(who: Actor, employeeId: string, month: string) {
  if (!isMonth(month)) throw new MarksError('Month must be YYYY-MM.');
  await assertMonthOpen(who.orgId, daysOfMonth(month).at(-1)!, employeeId);
  return peopleWrite(who.orgId, async () => {
    const row = await peoplePrisma.attendancePenalty.findUnique({ where: { orgId_employeeId_month: { orgId: who.orgId, employeeId, month } } });
    if (!row) throw new MarksError('Nothing was decided for this month.', 404);
    const parts = (Array.isArray(row.fromLeave) ? row.fromLeave : []) as LeavePart[];
    const ids = parts.map((p) => p.adjustmentId).filter(Boolean) as string[];
    if (ids.length) await peoplePrisma.leaveAdjustment.updateMany({ where: { orgId: who.orgId, id: { in: ids }, reversedAt: null }, data: { reversedAt: new Date(), reversedByUserId: who.userId } });
    await peoplePrisma.attendancePenalty.delete({ where: { id: row.id } });
    await audit(who, row.id, row.status === 'WAIVED' ? 'UNWAIVE' : 'UNAPPLY', `${row.status === 'WAIVED' ? 'Waiver taken back' : 'Applied penalty undone'} for ${monthWords(month)}`, { employeeId, month, days: row.days, leaveReturned: parts });
    return { undone: row.status };
  });
}

/**
 * Apply a month's penalties (HR, once the month has ended): for each person still DUE, leave is taken
 * in the rule's order as a leave adjustment, the rest stays loss of pay, and the month keeps the rule
 * version. Under the company's write lock and a unique row per person and month, two clicks at once
 * apply once. `employeeIds` limits it to some people.
 */
export async function apply(who: Actor, month: string, employeeIds?: string[] | null) {
  if (!isMonth(month)) throw new MarksError('Month must be YYYY-MM.');
  const days = daysOfMonth(month);
  const last = days[days.length - 1];
  if (last >= today()) throw new MarksError(`Apply once ${monthWords(month)} has ended.`, 409, 'NOT_ENDED');
  await assertMonthOpen(who.orgId, last);
  const rules = (await timeRulesFor(who.orgId)).marks;
  if (!rules.on) throw new MarksError('Late-mark penalties are switched off.', 409, 'OFF');
  const version = await currentRuleVersion(who.orgId);
  const year = await leaveYearOf(who.orgId, last);
  const skipped: Array<{ employeeId: string; why: string }> = [];
  let applied = 0;
  await peopleWrite(who.orgId, async () => {
    const rows = await penaltiesOver(who.accountId, who.orgId, days, { employeeIds: employeeIds || undefined });
    for (const r of rows.values()) {
      if (r.status !== 'DUE' || r.days <= 0) continue;
      const taken = await payrollTaken(who.orgId, r.employeeId, last);
      if (taken) { skipped.push({ employeeId: r.employeeId, why: `Payroll for ${taken.period} has taken this month.` }); continue; }
      const parts: LeavePart[] = [];
      for (const p of r.fromLeave) {
        const adj = await peoplePrisma.leaveAdjustment.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId: r.employeeId, leaveTypeId: p.leaveTypeId, year, days: -p.days, kind: 'ADJUST', reason: `Late marks, ${monthWords(month)}: ${[r.lateMarks ? `${r.lateMarks} late` : '', r.earlyMarks ? `${r.earlyMarks} early` : ''].filter(Boolean).join(', ')}`, createdByUserId: who.userId } });
        parts.push({ ...p, adjustmentId: adj.id });
      }
      await peoplePrisma.attendancePenalty.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId: r.employeeId, month, status: 'APPLIED', lateMarks: r.lateMarks, earlyMarks: r.earlyMarks, days: r.days, fromLeave: parts as any, lossOfPayDays: r.lossOfPayDays, ruleVersion: version, decidedByUserId: who.userId } });
      applied += 1;
    }
  });
  await audit(who, month, 'APPLY', `Applied late-mark penalties for ${monthWords(month)}: ${applied} ${applied === 1 ? 'person' : 'people'}`, { month, applied, skipped, ruleVersion: version });
  return { applied, skipped };
}

// ---------------------------------------------------------------------------
// The employee's own line
// ---------------------------------------------------------------------------

const half = (d: number) => (d === 0.5 ? '½ day' : d === 1 ? '1 day' : `${d} days`);

/** The rule in one sentence, as the employee reads it. */
export function policyText(rules: MarkRules, leaveNames: string[]) {
  if (!rules.on) return null;
  const from = leaveNames.length ? `taken from ${leaveNames.join(', then ')}, or unpaid when there is none left` : 'unpaid';
  const part = (k: MarkRules['late'], what: string) => {
    if (!k.on) return null;
    const grace = k.graceMinutes ? ` by more than ${k.graceMinutes} minutes` : '';
    const free = k.free ? `The first ${k.free} ${what}${grace} in a month are free; after that, every ${k.every}` : `Every ${k.every} ${what}${grace} in a month`;
    return `${free} ${k.every === 1 ? 'costs' : 'cost'} ${half(rules.cost)}`;
  };
  const parts = [part(rules.late, 'late arrivals'), part(rules.early, 'early exits')].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join('. ')}, ${from}.`;
}

/** One person's month: counts, how far to the next cost, what it costs so far and whether anyone decided it. */
export async function myMarks(e: { id: string; accountId: string; orgId: string }, month: string) {
  const rules = (await timeRulesFor(e.orgId)).marks;
  const names = rules.takeFrom.length ? await peoplePrisma.leaveType.findMany({ where: { orgId: e.orgId, id: { in: rules.takeFrom } }, select: { id: true, name: true } }) : [];
  const ordered = rules.takeFrom.map((id) => names.find((n) => n.id === id)?.name).filter(Boolean) as string[];
  if (!rules.on) return { on: false as const, month };
  const row = (await penaltiesOver(e.accountId, e.orgId, daysOfMonth(month), { employeeIds: [e.id] })).get(e.id);
  const line = (k: MarkRules['late'], count: number, what: string) => {
    const n = nextCost(k, count);
    if (!n) return null;
    if (n.free > 0) return `${count} ${what} so far; ${n.free} more ${n.free === 1 ? 'is' : 'are'} free this month.`;
    return n.left === 1 ? `${n.into} of ${n.every} ${what}; the next one costs ${half(rules.cost)}.` : `${n.into} of ${n.every} ${what}.`;
  };
  return {
    on: true as const,
    month,
    policy: policyText(rules, ordered),
    late: rules.late.on ? { count: row?.lateMarks ?? 0, dates: row?.lateDates ?? [], line: line(rules.late, row?.lateMarks ?? 0, 'late marks') } : null,
    early: rules.early.on ? { count: row?.earlyMarks ?? 0, dates: row?.earlyDates ?? [], line: line(rules.early, row?.earlyMarks ?? 0, 'early exits') } : null,
    days: row?.days ?? 0,
    status: row?.status ?? 'NONE',
    fromLeave: row?.fromLeave ?? [],
    lossOfPayDays: row?.lossOfPayDays ?? 0,
    waivedReason: row?.status === 'WAIVED' ? row.decision?.reason ?? null : null,
  };
}
