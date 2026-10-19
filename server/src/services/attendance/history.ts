import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { istTime } from './compute.js';

/**
 * The history of an attendance day.
 *
 * Days are overwritten in place (one row per person per date), so without
 * this a corrected day carries no trace of what it said before or who
 * changed it. Every write path in Attendance records here: marking, imports,
 * corrections, reader punches, leave, validation, overtime approval and
 * deletion. A write that changes nothing (a reader recomputing the same day)
 * is not recorded.
 */

type Rec = {
  id?: string;
  status: string;
  source: string;
  shiftId: string | null;
  checkIn: Date | null;
  checkOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  overtimeMinutes: number;
  overtimeApproved: boolean;
  validated: boolean;
  leaveRequestId: string | null;
  note: string | null;
};

/** The parts of a day a person reads: what changed is said in these terms. */
export const daySnapshot = (r: Partial<Rec> | null | undefined) =>
  r
    ? {
        status: r.status ?? null,
        source: r.source ?? null,
        shiftId: r.shiftId ?? null,
        checkIn: r.checkIn ? new Date(r.checkIn).toISOString() : null,
        checkOut: r.checkOut ? new Date(r.checkOut).toISOString() : null,
        in: r.checkIn ? istTime(new Date(r.checkIn)) : null,
        out: r.checkOut ? istTime(new Date(r.checkOut)) : null,
        workedMinutes: r.workedMinutes ?? 0,
        lateMinutes: r.lateMinutes ?? 0,
        earlyOutMinutes: r.earlyOutMinutes ?? 0,
        overtimeMinutes: r.overtimeMinutes ?? 0,
        overtimeApproved: Boolean(r.overtimeApproved),
        validated: Boolean(r.validated),
        leaveRequestId: r.leaveRequestId ?? null,
        note: r.note ?? null,
      }
    : null;

export type DaySnapshot = ReturnType<typeof daySnapshot>;

/** Field by field, what differs between two snapshots (for a "before → after" view). */
export function dayDiff(before: DaySnapshot, after: DaySnapshot) {
  const keys = ['status', 'in', 'out', 'workedMinutes', 'lateMinutes', 'earlyOutMinutes', 'overtimeMinutes', 'overtimeApproved', 'validated', 'source', 'note'] as const;
  const out: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const k of keys) {
    const b = before ? (before as any)[k] : null;
    const a = after ? (after as any)[k] : null;
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field: k, before: b, after: a });
  }
  return out;
}

export async function logDayChange(opts: {
  accountId: string;
  orgId: string;
  employeeId: string;
  date: string;
  recordId?: string | null;
  action: 'WRITE' | 'DELETE' | 'VALIDATE' | 'OVERTIME' | 'LEAVE_CANCELLED' | 'BULK';
  before: Partial<Rec> | null;
  after: Partial<Rec> | null;
  userId: string;
  reason?: string | null;
}) {
  const before = daySnapshot(opts.before);
  const after = daySnapshot(opts.after);
  if (opts.action === 'WRITE' && before && after && dayDiff(before, after).length === 0) return null;
  try {
    return await peoplePrisma.attendanceRecordHistory.create({
      data: {
        accountId: opts.accountId,
        orgId: opts.orgId,
        employeeId: opts.employeeId,
        date: opts.date,
        recordId: opts.recordId ?? null,
        action: opts.action,
        source: after?.source ?? before?.source ?? null,
        beforeJson: before ? JSON.stringify(before) : null,
        afterJson: after ? JSON.stringify(after) : null,
        userId: opts.userId || 'system',
        reason: opts.reason ? String(opts.reason).slice(0, 500) : null,
      },
    });
  } catch (e) {
    /* The day is already written; a lost history row is logged, never a failed save. */
    console.error('[attendance-history]', e instanceof Error ? e.message : e);
    return null;
  }
}

/** A day's history, newest first, each entry with its field-by-field change. */
export async function dayHistory(orgId: string, employeeId: string, date: string) {
  const rows = await peoplePrisma.attendanceRecordHistory.findMany({
    where: { orgId, employeeId, date },
    orderBy: { at: 'desc' },
    take: 200,
  });
  return rows.map((h) => {
    const before = h.beforeJson ? JSON.parse(h.beforeJson) : null;
    const after = h.afterJson ? JSON.parse(h.afterJson) : null;
    return { id: h.id, at: h.at, action: h.action, source: h.source, userId: h.userId, reason: h.reason, before, after, changes: dayDiff(before, after) };
  });
}
