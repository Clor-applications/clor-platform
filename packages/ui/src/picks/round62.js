/*
 * Round 62 picks (an employee's record), the parts that are plain logic and need no screen.
 */

/* searchtotab A: a search that matched a contact or an identifier opens the record on the tab that holds it. */
export function tabForQuery(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  if (s.includes('@')) return 'personal';
  if (/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(s)) return 'personal';
  const digits = s.replace(/[\s+()-]/g, '');
  if (/^\d{6,}$/.test(digits)) return 'personal';
  return null;
}

/* nextprevrecord A: the list the person came from, kept for this tab only, and where this record sits in it. */
export const RECORD_LIST_KEY = 'people.workforce.lastIds';

export function saveRecordList(ids) {
  try { sessionStorage.setItem(RECORD_LIST_KEY, JSON.stringify((ids || []).filter(Boolean).slice(0, 500))); } catch { /* convenience only */ }
}

export function neighbours(id, ids) {
  const list = Array.isArray(ids) ? ids : [];
  const i = list.indexOf(id);
  if (i < 0 || list.length < 2) return null;
  return { index: i, total: list.length, prev: i > 0 ? list[i - 1] : null, next: i < list.length - 1 ? list[i + 1] : null };
}

export function readRecordList() {
  try { const v = JSON.parse(sessionStorage.getItem(RECORD_LIST_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/* timetab A: this month so far in one line, from the person's own day records. */
export function monthLine(records) {
  const n = { present: 0, half: 0, absent: 0, leave: 0, late: 0 };
  for (const r of records || []) {
    if (r.status === 'PRESENT') n.present += 1;
    else if (r.status === 'HALF_DAY') n.half += 1;
    else if (r.status === 'ABSENT') n.absent += 1;
    else if (r.status === 'ON_LEAVE') n.leave += 1;
    if (Number(r.lateMinutes) > 0) n.late += 1;
  }
  const word = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [`${n.present} present`];
  if (n.half) parts.push(`${n.half} half ${n.half === 1 ? 'day' : 'days'}`);
  if (n.leave) parts.push(`${n.leave} on leave`);
  if (n.absent) parts.push(`${n.absent} absent`);
  if (n.late) parts.push(word(n.late, 'late day'));
  return { counts: n, text: parts.join(' · ') };
}

/* statusbadge A: approved leave that covers today, and the day they are back. */
export function leaveToday(requests, today) {
  const r = (requests || []).find((x) => x.status === 'APPROVED' && String(x.fromDate).slice(0, 10) <= today && String(x.toDate).slice(0, 10) >= today);
  if (!r) return null;
  return { type: r.leaveTypeName || 'Leave', until: String(r.toDate).slice(0, 10) };
}
