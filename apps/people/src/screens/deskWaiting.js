/**
 * Round 52 (CASESLA b): no promise is shown to the employee; HR sees how long
 * a case has waited on HR. Only while the case is with HR (open or reopened);
 * counted from the reopen when there was one, else from when it was asked.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function waitingWords(r, now = Date.now()) {
  if (!r || !['OPEN', 'REOPENED'].includes(r.status)) return '';
  const since = new Date(r.reopenedAt || r.createdAt).getTime();
  if (!Number.isFinite(since)) return '';
  const ms = Math.max(0, now - since);
  if (ms < HOUR) return 'Waiting under an hour';
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    return `Waiting ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.floor(ms / DAY);
  return `Waiting ${d} day${d === 1 ? '' : 's'}`;
}
