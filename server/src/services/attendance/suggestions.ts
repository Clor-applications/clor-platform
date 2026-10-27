import { peoplePrisma } from '../../utils/peoplePrisma.js';

/**
 * Time & Leave field suggestions: the company's own words for a leave reason,
 * a request reason or an on-duty place. Served to People (`/people/suggestions`)
 * and to Attendance (`/attendance/suggestions`) from one place, so a company
 * with only Attendance gets the same suggestions as one with People.
 *
 * Shared vocabulary only: a reason counts once two or more people have used it
 * (a place counts at once, it is not personal), and a private leave type's
 * reasons are never offered.
 */
export const TIME_LEAVE_SUGGESTION_FIELDS = ['leaveReason', 'requestReason', 'place'] as const;
export type TimeLeaveSuggestionField = (typeof TIME_LEAVE_SUGGESTION_FIELDS)[number];

export const isTimeLeaveSuggestionField = (field: string): field is TimeLeaveSuggestionField => (TIME_LEAVE_SUGGESTION_FIELDS as readonly string[]).includes(field);

export async function timeLeaveSuggestions(orgId: string, field: TimeLeaveSuggestionField): Promise<Array<{ value: string; count: number }>> {
  const counts = new Map<string, Set<string>>();
  if (field === 'leaveReason') {
    const privateIds = (await peoplePrisma.leaveType.findMany({ where: { orgId, isPrivate: true }, select: { id: true } })).map((t) => t.id);
    for (const r of await peoplePrisma.leaveRequest.findMany({ where: { orgId, ...(privateIds.length ? { leaveTypeId: { notIn: privateIds } } : {}) }, select: { reason: true, employeeId: true }, orderBy: { createdAt: 'desc' }, take: 3000 })) {
      const text = r.reason.trim();
      if (text.length >= 3 && text.length <= 60) counts.set(text, (counts.get(text) || new Set()).add(r.employeeId));
    }
  } else {
    for (const r of await peoplePrisma.attendanceRequest.findMany({ where: { orgId, ...(field === 'place' ? { place: { not: null } } : {}) }, select: { reason: true, place: true, employeeId: true }, orderBy: { createdAt: 'desc' }, take: 3000 })) {
      const text = String((field === 'place' ? r.place : r.reason) || '').trim();
      if (text.length >= 3 && text.length <= 60) counts.set(text, (counts.get(text) || new Set()).add(r.employeeId));
    }
  }
  const values: Array<{ value: string; count: number }> = [];
  for (const [value, ids] of [...counts].sort((x, y) => y[1].size - x[1].size)) if (ids.size >= 2 || field === 'place') values.push({ value, count: ids.size });
  return values;
}
