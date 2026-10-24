import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { type Actor, writeChangeLog } from './changeLog.js';

/**
 * Headcount and movements (docs/people/02-PRD.md HLTH-04), and snoozing a
 * Health check item (HLTH-03). Numbers come from the stints and the
 * employment history, so they agree with the change log: a joiner is a
 * stint that starts in the month, a leaver one that ends, a transfer an
 * establishment change recorded in history. Headcount "as of" a day counts
 * the stints open on that day.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const monthOf = (d: string) => d.slice(0, 7);

export class HeadcountError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Where each person worked on a day: the establishment then, from history rolled back from today's value. */
async function establishmentOn(orgId: string, people: Array<{ id: string; establishmentId: string | null }>, day: string) {
  const changes = await peoplePrisma.employmentEvent.findMany({ where: { orgId, field: 'establishmentId', effectiveDate: { gt: day }, employeeId: { in: people.map((p) => p.id) } }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }], select: { employeeId: true, fromId: true } });
  const at = new Map(people.map((p) => [p.id, p.establishmentId]));
  for (const c of changes) at.set(c.employeeId, c.fromId ?? null);
  return at;
}

export async function headcount(orgId: string, input: { asOf?: string; from?: string; to?: string }) {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const asOf = input.asOf && ISO.test(input.asOf) ? input.asOf : today;
  const to = input.to && ISO.test(input.to) ? input.to : today;
  const from = input.from && ISO.test(input.from) ? input.from : `${String(Number(to.slice(0, 4)) - 1)}${to.slice(4, 7)}-01`;
  if (from > to) throw new HeadcountError('The range starts after it ends.');
  const [episodes, people, ests, transfers] = await Promise.all([
    peoplePrisma.employmentEpisode.findMany({ where: { orgId }, select: { employeeId: true, startDate: true, endDate: true, endType: true } }),
    peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, establishmentId: true } }),
    peoplePrisma.establishment.findMany({ where: { orgId }, select: { id: true, name: true, state: true } }),
    peoplePrisma.employmentEvent.findMany({ where: { orgId, field: 'establishmentId', effectiveDate: { gte: from, lte: to } }, select: { employeeId: true, fromId: true, toId: true, effectiveDate: true } }),
  ]);
  const estName = new Map(ests.map((e) => [e.id, e.state ? `${e.name} (${e.state})` : e.name]));
  const label = (id: string | null) => (id ? estName.get(id) || 'Unknown' : 'No establishment');

  /* As of the day: open stints, by where each person worked that day. */
  const open = episodes.filter((e) => e.startDate <= asOf && (!e.endDate || e.endDate >= asOf));
  const placeAsOf = await establishmentOn(orgId, people, asOf);
  const byEst = new Map<string, number>();
  for (const e of open) {
    const k = label(placeAsOf.get(e.employeeId) ?? null);
    byEst.set(k, (byEst.get(k) || 0) + 1);
  }

  /* Movements month by month. */
  const months: string[] = [];
  for (let d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); monthOf(d.toISOString()) <= monthOf(to); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(monthOf(d.toISOString()));
  const placeNow = new Map(people.map((p) => [p.id, p.establishmentId]));
  const rows = months.map((m) => {
    const joined = episodes.filter((e) => monthOf(e.startDate) === m && e.startDate >= from && e.startDate <= to);
    const left = episodes.filter((e) => e.endDate && monthOf(e.endDate) === m && e.endDate >= from && e.endDate <= to);
    const moved = transfers.filter((t) => monthOf(t.effectiveDate) === m);
    const lastDay = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const end = lastDay > to ? to : lastDay;
    return {
      month: m,
      joiners: joined.length, leavers: left.length, transfers: moved.length,
      headcountAtEnd: episodes.filter((e) => e.startDate <= end && (!e.endDate || e.endDate >= end)).length,
      joinersByEstablishment: tally(joined.map((e) => label(placeNow.get(e.employeeId) ?? null))),
      leaversByEstablishment: tally(left.map((e) => label(placeNow.get(e.employeeId) ?? null))),
      transfersIn: tally(moved.map((t) => label(t.toId))),
      transfersOut: tally(moved.map((t) => label(t.fromId))),
    };
  });
  return { asOf, from, to, headcount: open.length, byEstablishment: Object.fromEntries([...byEst.entries()].sort()), months: rows };
}

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});

/** Put a Health check item aside until a date, with the reason; logged. */
export async function snooze(actor: Actor, checkId: string, input: { reason?: string; until?: string }) {
  const reason = String(input.reason || '').trim().slice(0, 500);
  const until = String(input.until || '').trim();
  if (!reason) throw new HeadcountError('Say why it can wait.');
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (!ISO.test(until) || until <= today) throw new HeadcountError('Give the date it comes back, after today.');
  const maxDay = new Date(Date.now() + 330 * 60_000 + 180 * 86_400_000).toISOString().slice(0, 10);
  if (until > maxDay) throw new HeadcountError('Six months at most; then look again.');
  const row = await peoplePrisma.$transaction(async (tx) => {
    await tx.healthSnooze.updateMany({ where: { orgId: actor.orgId, checkId, endedAt: null }, data: { endedAt: new Date() } });
    const created = await tx.healthSnooze.create({ data: { accountId: actor.accountId, orgId: actor.orgId, checkId, reason, until, byUserId: actor.userId } });
    await writeChangeLog(tx, actor, { kind: 'HealthCheck', id: checkId }, [{ field: 'snoozed', before: null, after: `until ${until}: ${reason}`, redacted: false }]);
    return created;
  });
  return { checkId: row.checkId, reason: row.reason, until: row.until };
}

export async function unsnooze(actor: Actor, checkId: string) {
  const r = await peoplePrisma.$transaction(async (tx) => {
    const n = await tx.healthSnooze.updateMany({ where: { orgId: actor.orgId, checkId, endedAt: null }, data: { endedAt: new Date() } });
    if (n.count) await writeChangeLog(tx, actor, { kind: 'HealthCheck', id: checkId }, [{ field: 'snoozed', before: 'snoozed', after: 'back on the list', redacted: false }]);
    return n.count;
  });
  return { ended: r };
}

export async function snoozeHistory(orgId: string, checkId?: string) {
  return peoplePrisma.healthSnooze.findMany({ where: { orgId, ...(checkId ? { checkId } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
}
