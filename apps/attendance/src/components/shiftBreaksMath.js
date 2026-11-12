/**
 * The arithmetic of a shift's breaks as the shift form shows it, the same as
 * the server's (services/attendance/breaks.ts): a break with a start and an
 * end is as long as they say (past midnight on a night shift), otherwise its
 * minutes; the unpaid ones are what comes off a day.
 */
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export const breakLength = (b) => {
  const a = toMin(b.startTime);
  const z = toMin(b.endTime);
  if (a !== null && z !== null) return z - a > 0 ? z - a : z - a + 24 * 60;
  return Math.max(0, Math.round(Number(b.minutes) || 0));
};

export const unpaidTotal = (breaks) => (breaks || []).filter((b) => !b.paid).reduce((a, b) => a + breakLength(b), 0);

/** What is wrong with the breaks as typed, or ''. The server checks the rest (inside the shift, no overlap). */
export const breaksProblem = (breaks) => {
  for (const [i, b] of (breaks || []).entries()) {
    const label = String(b.name || '').trim() || `Break ${i + 1}`;
    if (!String(b.name || '').trim()) return `Break ${i + 1}: give it a name.`;
    if (Boolean(b.startTime) !== Boolean(b.endTime)) return `${label}: give both a start and an end, or only the minutes.`;
    if (breakLength(b) <= 0) return `${label}: give a start and an end, or the minutes.`;
  }
  return '';
};

/** The breaks as the API takes them. */
export const breaksBody = (breaks) =>
  (breaks || []).map((b) => ({ name: String(b.name).trim(), startTime: b.startTime || null, endTime: b.endTime || null, minutes: breakLength(b), paid: Boolean(b.paid) }));
