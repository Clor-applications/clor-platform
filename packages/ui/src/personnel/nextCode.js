/**
 * The next employee code, read from the codes already in use (round 24: "prefix and next
 * number with a preview"). The prefix most codes share wins; the number after the highest
 * one keeps the same width: KT-0142 and KT-0139 give KT-0143. Null when no pattern shows.
 */
export function nextEmployeeCode(codes) {
  const series = new Map();
  for (const raw of codes || []) {
    const m = /^(.*?)(\d+)$/.exec(String(raw || '').trim());
    if (!m) continue;
    const [, prefix, digits] = m;
    const s = series.get(prefix) || { count: 0, max: -1, width: 0 };
    s.count += 1;
    if (Number(digits) > s.max) s.max = Number(digits);
    s.width = Math.max(s.width, digits.length);
    series.set(prefix, s);
  }
  let best = null;
  for (const [prefix, s] of series) {
    if (!best || s.count > best.s.count) best = { prefix, s };
  }
  if (!best || best.s.count < 2) return null;
  return best.prefix + String(best.s.max + 1).padStart(best.s.width, '0');
}
