/**
 * Round 52 (FNFCLOCK a): a countdown on each unpaid settlement, in working
 * days (Monday to Saturday, as most Indian offices count them), from today
 * in India to the due date. Overdue rows keep their Overdue pill instead.
 */
const IST = 330 * 60_000;
const dayOf = (v) => {
  if (!v) return null;
  const s = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(new Date(v).getTime() + IST).toISOString().slice(0, 10);
  return new Date(`${s}T00:00:00Z`);
};

export function workingDaysUntil(due, now = new Date()) {
  const end = dayOf(due);
  const start = dayOf(now);
  if (!end || !start || Number.isNaN(end.getTime())) return null;
  if (end < start) return -1;
  let n = 0;
  const d = new Date(start);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) n += 1;
  }
  return n;
}

export function settlementClock(s, now = new Date()) {
  if (!s || s.status === 'PAID' || s.status === 'CANCELLED' || s.overdue) return '';
  const n = workingDaysUntil(s.dueDate, now);
  if (n == null || n < 0) return '';
  if (n === 0) return 'Due today';
  return `Due in ${n} working day${n === 1 ? '' : 's'}`;
}
