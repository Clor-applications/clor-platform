import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { todayIst } from '../../utils/istDate.js';

/**
 * Employment stints (docs/people/02-PRD.md FND-06; platform review R-03).
 *
 * One employee id for a person's whole time with a company, and one row per
 * stint: joined, left, rejoined. A rehire used to overwrite the joining date,
 * which lost the service history gratuity and the timeline depend on. Now:
 *
 *   firstJoiningDate   the first day they ever joined; never moved
 *   dateOfJoining      the current stint's start, which Attendance and leave
 *                      proration keep reading as they always have
 *   currentEpisodeSeq  which stint they are on
 *
 * Written next to the change that causes it, inside the same transaction
 * where the caller has one.
 */

type Who = { accountId: string; orgId: string };
type Tx = Pick<typeof peoplePrisma, 'employmentEpisode' | 'employee'>;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : '';
  return ISO_DAY.test(s) ? s : null;
};

/** A person's first stint, from what is on file. Idempotent: an existing first stint is left alone. */
export async function ensureFirstEpisode(who: Who, employee: { id: string; dateOfJoining?: string | null; createdAt?: Date | null }, tx: Tx = peoplePrisma) {
  const startDate = day(employee.dateOfJoining) || day(employee.createdAt) || new Date().toISOString().slice(0, 10);
  return tx.employmentEpisode.upsert({
    where: { employeeId_seq: { employeeId: employee.id, seq: 1 } },
    create: { accountId: who.accountId, orgId: who.orgId, employeeId: employee.id, seq: 1, startDate },
    update: {},
  });
}

/** The current stint ends: last working day, how, and why. */
export async function closeEpisode(who: Who, employee: { id: string; currentEpisodeSeq?: number | null; dateOfJoining?: string | null; createdAt?: Date | null }, end: { endDate: string; endType: string; endReason?: string | null }, tx: Tx = peoplePrisma) {
  const seq = employee.currentEpisodeSeq || 1;
  await ensureFirstEpisode(who, employee, tx);
  return tx.employmentEpisode.update({
    where: { employeeId_seq: { employeeId: employee.id, seq } },
    data: { endDate: end.endDate, endType: end.endType, endReason: end.endReason ?? null },
  });
}

/** Back again: the next stint opens on the rejoin date; earlier stints stay as they were. */
export async function openNextEpisode(who: Who, employee: { id: string; currentEpisodeSeq?: number | null; dateOfJoining?: string | null; createdAt?: Date | null }, startDate: string, tx: Tx = peoplePrisma) {
  await ensureFirstEpisode(who, employee, tx);
  const seq = (employee.currentEpisodeSeq || 1) + 1;
  const row = await tx.employmentEpisode.create({ data: { accountId: who.accountId, orgId: who.orgId, employeeId: employee.id, seq, startDate } });
  return row;
}

export type EpisodeRow = { seq: number; startDate: string; endDate: string | null; endType: string | null; endReason: string | null; current: boolean; days: number | null };

/** Every stint, first to last, with its length in days (to the end date, or today while it runs). */
export async function episodesOf(orgId: string, employee: { id: string; currentEpisodeSeq?: number | null; status?: string | null }): Promise<EpisodeRow[]> {
  const rows = await peoplePrisma.employmentEpisode.findMany({ where: { orgId, employeeId: employee.id }, orderBy: { seq: 'asc' } });
  const today = todayIst();
  const current = employee.currentEpisodeSeq || 1;
  return rows.map((r) => {
    const to = r.endDate || today;
    const days = Math.round((Date.parse(to) - Date.parse(r.startDate)) / 86_400_000);
    return { seq: r.seq, startDate: r.startDate, endDate: r.endDate, endType: r.endType, endReason: r.endReason, current: r.seq === current && employee.status !== 'LEFT', days: Number.isFinite(days) ? Math.max(0, days) : null };
  });
}
