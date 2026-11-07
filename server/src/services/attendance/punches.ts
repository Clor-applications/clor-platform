import { createHash, randomUUID } from 'node:crypto';
import { enqueuePunches } from '../../services/hr/sync.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { instantOf, pairDay, parseAttlogLine, punchKind, shiftDayOf } from './adms.js';
import { emit as emitWebhook } from './webhooks.js';
import { closedMonths, shiftFor, writeDay } from './days.js';
import { readerIdMatcher } from './readerIds.js';
import { driverOf, parserOf } from './drivers.js';
import { istDate } from './compute.js';
import { nightShiftsOn } from './nightShift.js';
import { notePunchOnDecidedDay } from './trust.js';
import { autoPickShift, withinWindow } from './autoShift.js';

/**
 * Punches in: one path for every reader channel — parse, match the person, drop repeats, keep the evidence, store, then work the affected days out again.
 *
 * Moved out of routes/iclock.ts, the ZKTeco ADMS route, so that every reader
 * channel, the portal, scheduling and payroll call a service instead of a
 * route file. Behaviour is unchanged.
 */

/** Days someone decided by hand are not rewritten by a reader: a correction, a request, an approved leave. */
export const DECIDED = new Set(['MANUAL', 'REQUEST', 'LEAVE']);

/**
 * Who a reader's user ID is (services/attendance/readerIds.ts): a site ID at a
 * site's readers, else the company Reader ID, else an employee code only one
 * person has. Call the result with the reader's area.
 */
export const pinMatcher = (orgId: string) => readerIdMatcher(orgId);

const isNight = (rule: { startTime: string; endTime: string }) => rule.endTime <= rule.startTime;
/** An instant as the IST wall clock a reader would print: "YYYY-MM-DD HH:mm:ss". */
const istLocal = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const minutesOfDay = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The shift day a punch belongs to. A morning punch is the end of last night's
 * shift only if the shift that started the evening before was a night shift —
 * the shift on the punch's own date says nothing about that — and only until
 * the morning's own shift could have begun: halfway from the night's end to the
 * day shift's start, and never more than four hours after the night ends.
 * (Moving from nights back to days put the night's 06:00 exit on the day shift,
 * or the day shift's 09:00 arrival on the night.)
 */
export async function shiftDayFor(orgId: string, employeeId: string, localTime: string) {
  const date = localTime.slice(0, 10);
  if (Number(localTime.slice(11, 13)) >= 12) return date;
  const before = dayBefore(date);
  const { rule: last } = await shiftFor(orgId, employeeId, before);
  if (!isNight(last)) return date;
  const end = minutesOfDay(last.endTime);
  let cutoff = end + 240;
  const { rule: own } = await shiftFor(orgId, employeeId, date);
  const start = minutesOfDay(own.startTime);
  if (!isNight(own) && start > end) cutoff = Math.min(cutoff, Math.max(end + 60, Math.floor((end + start) / 2)));
  return minutesOfDay(localTime.slice(11, 16)) < cutoff ? before : date;
}

/**
 * The day a clock-in from the web or the app goes on. With night shifts on
 * (attendanceNightShifts), the shift day a reader would give the same moment:
 * 01:30 after a 22:00–06:00 night is that night's. Off, the calendar date, as
 * it always was.
 */
export async function clockDateFor(orgId: string, accountId: string, employeeId: string, at: Date) {
  if (!(await nightShiftsOn(orgId, accountId))) return istDate(at);
  return shiftDayFor(orgId, employeeId, istLocal(at));
}

/**
 * Work a day out again from its reader punches (and any app clock-ins on the
 * same shift day), then write it through the same path as every other day.
 */
export async function recomputeDeviceDay(accountId: string, orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, date: string) {
  /* A closed month keeps its days: the punch is stored, the day does not move (and the reader is not told to resend). */
  if ((await closedMonths(orgId, [date.slice(0, 7)])).size) return null;
  const existing = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date } } });
  if (existing && DECIDED.has(existing.source)) {
    /* The day stays as decided. With reader trust on, the punch is raised for HR instead of vanishing (O-11). */
    await notePunchOnDecidedDay(accountId, orgId, existing);
    return null;
  }

  /* Field punches still waiting for approval, or refused, do not count. */
  const punches = await peoplePrisma.devicePunch.findMany({
    where: { orgId, employeeId: employee.id, shiftDate: date, OR: [{ reviewStatus: null }, { reviewStatus: 'APPROVED' }] },
    select: { at: true, kind: true },
  });
  /* App clock-ins on the same shift day count too: someone may use both. */
  const from = new Date(`${date}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 36 * 3_600_000);
  const clocks = await peoplePrisma.attendanceActivity.findMany({
    where: { orgId, employeeId: employee.id, source: 'CLOCK', at: { gte: from, lt: to } },
    select: { at: true, kind: true },
  });
  /* With the switch on, the first punch may pick the day's shift before the day is worked out (autoShift.ts). */
  const first = [...punches, ...clocks].reduce<Date | null>((m, p) => (!m || p.at < m ? p.at : m), null);
  await autoPickShift(accountId, orgId, employee.id, date, first);
  const { rule } = await shiftFor(orgId, employee.id, date);
  /* With night shifts on, a clock belongs where a reader's punch at that moment would (shiftDayFor), so the two never split one night. */
  const night = clocks.length ? await nightShiftsOn(orgId, accountId) : false;
  const sameDay: typeof clocks = [];
  for (const c of clocks) if ((night ? await shiftDayFor(orgId, employee.id, istLocal(c.at)) : shiftDayOf(istLocal(c.at), isNight(rule))) === date) sameDay.push(c);
  /* Only punches inside the shift's punch window make the day; the rest stay stored (autoShift.ts withinWindow). */
  const points = withinWindow(rule, date, [
    ...punches.map((p) => ({ at: p.at, kind: (p.kind as 'IN' | 'OUT' | null) ?? null })),
    ...sameDay.map((c) => ({ at: c.at, kind: c.kind === 'OUT' ? ('OUT' as const) : ('IN' as const) })),
  ]);
  const day = pairDay(points);
  if (!day) return null;
  /* An approved half-day leave on this day: the punches are the other half. */
  const half = await peoplePrisma.leaveRequest.findFirst({ where: { orgId, employeeId: employee.id, status: 'APPROVED', fromDate: date, toDate: date, halfDay: { not: null } }, select: { id: true, halfDay: true } });
  return writeDay({ accountId, orgId, userId: 'reader', employee, date, checkIn: day.checkIn, checkOut: day.checkOut, source: 'DEVICE', ...(half ? { leaveRequestId: half.id, halfDayLeave: half.halfDay as 'FIRST' | 'SECOND' } : {}) });
}

/**
 * A reader punch more than this far ahead of the server's clock is held, not counted (audit 7 Nov 2026, #11):
 * a reader whose clock jumped ahead wrote a working day in March 2027. A few minutes of drift is normal.
 */
export const FUTURE_TOLERANCE_MS = 15 * 60_000;
/** Why a punch is held, for the list HR reviews. */
export const HELD_REASON = { FUTURE: 'FUTURE' } as const;

/** What a channel knows about each line besides the line: the vendor's own record and event id, and records it set aside. */
export type IngestMeta = { sources?: string[]; ids?: Array<string | null>; aside?: Array<{ original: string; reason: string; id?: string | null }> };

/** Store a batch of punch lines from one reader; returns how many were new. */
export async function ingestPunches(device: { id: string; accountId: string; orgId: string; serialNumber: string; direction: string; vendor?: string; areaId?: string | null }, body: string, meta: IngestMeta = {}) {
  const match = await pinMatcher(device.orgId);
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const all = lines.map((raw, i) => ({ raw, i, p: parseAttlogLine(raw) }));
  const parsed = all.filter((x): x is { raw: string; i: number; p: NonNullable<ReturnType<typeof parseAttlogLine>> } => Boolean(x.p));
  /* One row per batch, whatever the channel: what came, what was new, what was a repeat, what could not be read. */
  const trace = { traceId: randomUUID(), received: lines.length, rejected: lines.length - parsed.length, errors: all.filter((x) => !x.p).slice(0, 5).map((x) => x.raw.slice(0, 120)) };
  const record = (accepted: number, duplicates: number, extraRejected = 0) =>
    peoplePrisma.ingestRun
      .create({
        data: {
          accountId: device.accountId, orgId: device.orgId, deviceId: device.id, channel: device.vendor || 'ADMS', traceId: trace.traceId,
          received: trace.received, accepted, duplicates, rejected: trace.rejected + extraRejected,
          errorsJson: trace.errors.length ? JSON.stringify(trace.errors) : null,
        },
      })
      .catch((e) => console.error('[ingest-run]', e instanceof Error ? e.message : e));

  /*
   * The original of every line that becomes a punch, cannot be read, or is set
   * aside — never the repeats (counted on the run). Evidence for a dispute and
   * for certifying a reader model; deleted after 13 months (services/retention).
   */
  const parser = parserOf(device.vendor);
  const channel = device.vendor || 'ADMS';
  const evidence: any[] = [];
  const keep = (outcome: string, original: string, extra: { reason?: string; id?: string | null; pin?: string; localTime?: string }) =>
    evidence.push({
      accountId: device.accountId, orgId: device.orgId, deviceId: device.id, traceId: trace.traceId, channel, outcome, parser,
      original: original.slice(0, 8_000), payloadHash: createHash('sha256').update(original).digest('hex'),
      reason: extra.reason ?? null, sourceEventId: extra.id ?? null, pin: extra.pin ?? null, localTime: extra.localTime ?? null,
    });
  for (const x of all) if (!x.p) keep('REJECTED', meta.sources?.[x.i] ?? x.raw, { reason: 'Could not be read', id: meta.ids?.[x.i] });
  for (const a of meta.aside || []) keep('IGNORED', a.original, { reason: a.reason, id: a.id });
  const saveEvidence = () => (evidence.length ? peoplePrisma.readerEvent.createMany({ data: evidence }).catch((e) => console.error('[reader-event]', e instanceof Error ? e.message : e)) : null);

  const rows: any[] = [];
  const heldAfter = Date.now() + FUTURE_TOLERANCE_MS;
  for (const { raw, i, p } of parsed) {
    const at = instantOf(p.localTime);
    if (!at) {
      keep('REJECTED', meta.sources?.[i] ?? raw, { reason: 'Not a real date and time', id: meta.ids?.[i], pin: p.pin, localTime: p.localTime });
      continue;
    }
    /* Ahead of now: stored (so a resend is a repeat) but held, with no shift day, until someone looks (#11). */
    const held = at.getTime() > heldAfter;
    const emp = match(p.pin, device.areaId);
    rows.push({
      accountId: device.accountId,
      orgId: device.orgId,
      deviceId: device.id,
      serialNumber: device.serialNumber,
      pin: p.pin,
      at,
      localTime: p.localTime,
      state: p.state,
      /* Sources that say in/out outright send state 0 / 1 (ClorTime vendor_ingest); from a reader, 0 alone says nothing (services/attendance/drivers.ts). */
      kind: driverOf(device.vendor).explicitDirection ? (p.state === '0' ? 'IN' : p.state === '1' ? 'OUT' : punchKind(p.state, device.direction)) : punchKind(p.state, device.direction),
      verifyMode: p.verifyMode,
      workCode: p.workCode,
      employeeId: emp?.id ?? null,
      shiftDate: null as string | null,
      raw: raw.slice(0, 300),
      reviewStatus: held ? 'HELD' : null,
      heldReason: held ? HELD_REASON.FUTURE : null,
      _held: held,
      _emp: emp,
      _src: { original: meta.sources?.[i] ?? raw, id: meta.ids?.[i] ?? null },
    });
  }
  if (!rows.length) {
    await saveEvidence();
    if (lines.length) await record(0, 0, parsed.length);
    return 0;
  }

  /* Readers resend (Stamp=0 asks for everything; outages replay). Only new punches change a day. */
  const fresh: typeof rows = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    /* A repeat is the same ID on the same reader at the same second — or the same person at the same second on any reader. */
    const people = [...new Set(chunk.map((r) => r.employeeId).filter(Boolean))] as string[];
    const [seen, seenPeople] = await Promise.all([
      peoplePrisma.devicePunch.findMany({ where: { orgId: device.orgId, deviceId: device.id, OR: chunk.map((r) => ({ pin: r.pin, at: r.at })) }, select: { pin: true, at: true } }),
      people.length
        ? peoplePrisma.devicePunch.findMany({ where: { orgId: device.orgId, employeeId: { in: people }, at: { in: [...new Set(chunk.map((r) => r.at.getTime()))].map((t) => new Date(t)) } }, select: { employeeId: true, at: true } })
        : [],
    ]);
    const have = new Set([...seen.map((s) => `p|${s.pin}|${s.at.getTime()}`), ...seenPeople.map((s) => `e|${s.employeeId}|${s.at.getTime()}`)]);
    for (const r of chunk) {
      const keys = [`p|${r.pin}|${r.at.getTime()}`, ...(r.employeeId ? [`e|${r.employeeId}|${r.at.getTime()}`] : [])];
      if (keys.some((k) => have.has(k))) continue;
      for (const k of keys) have.add(k);
      fresh.push(r);
    }
  }
  for (const r of fresh) keep(r._held ? 'HELD' : 'NEW', r._src.original, { id: r._src.id, pin: r.pin, localTime: r.localTime, ...(r._held ? { reason: 'Time ahead of the server: the reader’s clock may be wrong' } : {}) });
  await saveEvidence();
  if (!fresh.length) {
    await record(0, rows.length, parsed.length - rows.length);
    return 0;
  }
  await record(fresh.length, rows.length - fresh.length, parsed.length - rows.length);
  /* Shift days only for new punches: a reader resending its whole log costs one lookup per person-hour, not one per line. */
  const dayOf = new Map<string, string>();
  for (const r of fresh) {
    if (!r._emp || r._held) continue;
    const k = `${r._emp.id}|${r.localTime.slice(0, 13)}`;
    if (!dayOf.has(k)) dayOf.set(k, await shiftDayFor(device.orgId, r._emp.id, r.localTime));
    r.shiftDate = dayOf.get(k)!;
  }
  await peoplePrisma.devicePunch.createMany({ data: fresh.map(({ _emp, _src, _held, ...r }) => r), skipDuplicates: true });
  /* Held punches go nowhere yet: not to webhooks, not to a connected HR tool, not onto a day. */
  const counted = fresh.filter((r) => !r._held);
  if (counted.length) {
    emitWebhook(device.orgId, 'punch', {
      reader: device.serialNumber,
      punches: counted.map((r) => ({ readerId: r.pin, employeeId: r.employeeId, time: r.localTime, direction: r.kind, verifyMode: r.verifyMode })),
    });
    /* And to any HR tool the company connected (services/hr/sync.ts); never waits. */
    void enqueuePunches(device.orgId, counted.map((r) => ({ employeeId: r.employeeId, code: r._emp?.code || r._emp?.devicePin || null, readerId: r.pin, time: r.localTime, direction: r.kind, verifyMode: r.verifyMode })));
  }

  const days = new Map<string, { emp: any; date: string }>();
  for (const r of counted) if (r._emp && r.shiftDate) days.set(`${r._emp.id}|${r.shiftDate}`, { emp: r._emp, date: r.shiftDate });
  for (const { emp, date } of days.values()) {
    await recomputeDeviceDay(device.accountId, device.orgId, { id: emp.id, branchId: emp.branchId, areaId: emp.areaId }, date);
  }
  return fresh.length;
}

/**
 * A held punch (#11), decided by someone who looked at it. Count it: only once its time is no longer ahead
 * of the server's, then it gets its shift day and the day is worked out again, as if it had just arrived.
 * Discard it: it stays stored (a resend is still a repeat) as REJECTED, and changes nothing.
 */
export async function decideHeldPunch(orgId: string, id: string, action: 'release' | 'discard') {
  const p = await peoplePrisma.devicePunch.findFirst({ where: { id, orgId, reviewStatus: 'HELD' } });
  if (!p) return { status: 404 as const, error: 'No such held punch.' };
  if (action === 'discard') {
    await peoplePrisma.devicePunch.updateMany({ where: { id, orgId, reviewStatus: 'HELD' }, data: { reviewStatus: 'REJECTED' } });
    return { status: 200 as const, punch: { id, review: 'REJECTED' } };
  }
  if (p.at.getTime() > Date.now() + FUTURE_TOLERANCE_MS) return { status: 409 as const, error: 'This punch is still ahead of today. Set the reader’s clock right; the punches it makes from then on count.', code: 'STILL_IN_FUTURE' };
  if (!p.employeeId) return { status: 409 as const, error: 'This reader ID matches nobody yet. Map it under Employee ID mapping first.', code: 'NOT_MATCHED' };
  const emp = await peoplePrisma.employee.findFirst({ where: { id: p.employeeId, orgId }, select: { id: true, accountId: true, branchId: true, areaId: true } });
  if (!emp) return { status: 404 as const, error: 'No such held punch.' };
  const shiftDate = await shiftDayFor(orgId, emp.id, p.localTime);
  /* Taken once: a second click (or a colleague's) finds it no longer held. */
  const taken = await peoplePrisma.devicePunch.updateMany({ where: { id, orgId, reviewStatus: 'HELD' }, data: { reviewStatus: null, heldReason: null, shiftDate } });
  if (!taken.count) return { status: 404 as const, error: 'No such held punch.' };
  /* A closed month keeps its days: the punch counts from now on, but the day is not worked out again (recomputeDeviceDay). Say so. */
  const closed = (await closedMonths(orgId, [shiftDate.slice(0, 7)])).size > 0;
  if (!closed) await recomputeDeviceDay(emp.accountId, orgId, { id: emp.id, branchId: emp.branchId, areaId: emp.areaId }, shiftDate);
  return { status: 200 as const, punch: { id, review: null, shiftDate }, closedMonth: closed, message: closed ? CLOSED_MONTH_COUNTED : 'Counted. The day is worked out again.' };
}

export const CLOSED_MONTH_COUNTED = 'Counted. The day is in a closed month, so it was not changed — adjust in payroll.';

/** Which held punches a bulk decision takes: one reader's, optionally one month's (by the time on the punch), optionally only some people's. */
export type HeldFilter = { deviceId: string; month?: string | null; employeeIds?: string[] | null };
export const heldWhere = (orgId: string, f: HeldFilter) => ({
  orgId,
  reviewStatus: 'HELD',
  deviceId: f.deviceId,
  ...(f.month ? { localTime: { gte: `${f.month}-01 00:00:00`, lte: `${f.month}-31 23:59:59` } } : {}),
  ...(f.employeeIds ? { employeeId: { in: f.employeeIds } } : {}),
});

/** At most this many punches per bulk decision; the answer says how many are left. */
export const HELD_BULK_MAX = 5000;

/**
 * Count or discard every held punch from one reader at once (review of #144): a reader whose clock ran
 * ahead for weeks can leave thousands, and a month cannot close until each is decided. Count takes only
 * punches whose time has come and whose reader ID matches someone; the rest stay held and are counted
 * in the answer. Each punch is taken once (a colleague deciding the same ones at the same time gets the
 * rest), and each person's day is worked out once however many of its punches were counted.
 */
export async function decideHeldPunches(orgId: string, f: HeldFilter, action: 'release' | 'discard') {
  const where = heldWhere(orgId, f);
  if (action === 'discard') {
    const ids = (await peoplePrisma.devicePunch.findMany({ where, select: { id: true }, orderBy: { at: 'asc' }, take: HELD_BULK_MAX })).map((p) => p.id);
    const done = ids.length ? await peoplePrisma.devicePunch.updateMany({ where: { id: { in: ids }, orgId, reviewStatus: 'HELD' }, data: { reviewStatus: 'REJECTED' } }) : { count: 0 };
    const left = await peoplePrisma.devicePunch.count({ where });
    return { counted: 0, discarded: done.count, notYet: 0, notMatched: 0, closedDays: 0, left };
  }
  const due = new Date(Date.now() + FUTURE_TOLERANCE_MS);
  const [punches, notYet, notMatched] = await Promise.all([
    peoplePrisma.devicePunch.findMany({ where: { ...where, employeeId: { not: null, ...(f.employeeIds ? { in: f.employeeIds } : {}) }, at: { lte: due } }, select: { id: true, employeeId: true, localTime: true }, orderBy: { at: 'asc' }, take: HELD_BULK_MAX }),
    peoplePrisma.devicePunch.count({ where: { ...where, at: { gt: due } } }),
    /* A team role sees only its people's, so none of its punches are unmatched. */
    f.employeeIds ? Promise.resolve(0) : peoplePrisma.devicePunch.count({ where: { ...where, employeeId: null } }),
  ]);
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(punches.map((p) => p.employeeId!))] } }, select: { id: true, accountId: true, branchId: true, areaId: true } })).map((e) => [e.id, e]));
  /* The shift day of each, then one update per (person, day). */
  const groups = new Map<string, { employeeId: string; shiftDate: string; ids: string[] }>();
  for (const p of punches) {
    if (!people.has(p.employeeId!)) continue;
    const shiftDate = await shiftDayFor(orgId, p.employeeId!, p.localTime);
    const key = `${p.employeeId}|${shiftDate}`;
    const g = groups.get(key) || { employeeId: p.employeeId!, shiftDate, ids: [] };
    g.ids.push(p.id);
    groups.set(key, g);
  }
  const closed = await closedMonths(orgId, [...new Set([...groups.values()].map((g) => g.shiftDate.slice(0, 7)))]);
  let counted = 0;
  let closedDays = 0;
  for (const g of groups.values()) {
    const taken = await peoplePrisma.devicePunch.updateMany({ where: { id: { in: g.ids }, orgId, reviewStatus: 'HELD' }, data: { reviewStatus: null, heldReason: null, shiftDate: g.shiftDate } });
    if (!taken.count) continue;
    counted += taken.count;
    if (closed.has(g.shiftDate.slice(0, 7))) {
      closedDays += 1;
      continue;
    }
    const emp = people.get(g.employeeId)!;
    await recomputeDeviceDay(emp.accountId, orgId, { id: emp.id, branchId: emp.branchId, areaId: emp.areaId }, g.shiftDate);
  }
  const left = await peoplePrisma.devicePunch.count({ where });
  return { counted, discarded: 0, notYet, notMatched, closedDays, left };
}
