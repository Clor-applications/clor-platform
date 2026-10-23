import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { emit as emitWebhook } from './webhooks.js';
import { writeDay, employeeIn } from './days.js';

/**
 * Attendance corrections: the reasons a correction may give, and what approving or rejecting one does to the day. Moved out of routes/attendance.ts so the portal and insights routes share a service, not a route; behaviour unchanged.
 */
/** Categories for a correction's reason; the free-text reason stays required. */
export const REASON_CODES = ['FORGOT_PUNCH', 'READER_DOWN', 'ON_DUTY', 'WRONG_SHIFT', 'OTHER'] as const;

/**
 * The decision on a correction request: approving writes the day, both ways
 * record who decided and when. HR decides from Corrections; a manager decides
 * from the employee portal's Approvals (routes/portal.ts) — one function, so
 * the two never drift.
 */
export async function reviewCorrection(accountId: string, orgId: string, r: any, approve: boolean, userId: string, note: string | null) {
  if (approve) {
    const employee = await employeeIn(orgId, accountId, r.employeeId);
    await writeDay({ accountId, orgId, userId, employee, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, source: 'REQUEST', reason: `Correction approved: ${r.reason}` });
  }
  const updated = await peoplePrisma.attendanceRequest.update({
    where: { id: r.id },
    data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note },
  });
  if (approve) emitWebhook(orgId, 'correction.approved', { id: updated.id, employeeId: updated.employeeId, date: updated.date, checkIn: updated.checkIn, checkOut: updated.checkOut, reason: (updated as any).reason ?? null, reviewNote: updated.reviewNote });
  return updated;
}
