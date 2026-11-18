/*
 * Two punches a minute apart (owner's pick, round 27: count the first, grey
 * out the second).
 *
 * The day already reads first in and last out, so a second tap seconds after
 * the first never doubles anything; this only marks it on the list so nobody
 * thinks it did. Same person (or same reader ID when not matched yet), within
 * 60 seconds of their previous punch.
 */
const WINDOW_MS = 60_000;

const at = (t) => {
  const ms = Date.parse(String(t.localTime || '').replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
};

export function repeatPunchIds(list = []) {
  const byWho = new Map();
  for (const t of list) {
    const who = t.employeeId || (t.pin != null ? `pin:${t.pin}` : null);
    const ms = at(t);
    if (!who || ms == null) continue;
    if (!byWho.has(who)) byWho.set(who, []);
    byWho.get(who).push({ id: t.id, ms });
  }
  const repeats = new Set();
  for (const punches of byWho.values()) {
    punches.sort((a, b) => a.ms - b.ms);
    for (let i = 1; i < punches.length; i += 1) {
      if (punches[i].ms - punches[i - 1].ms <= WINDOW_MS) repeats.add(punches[i].id);
    }
  }
  return repeats;
}
