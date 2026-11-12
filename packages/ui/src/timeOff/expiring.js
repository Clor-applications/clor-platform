/**
 * A balance's days that expire, in words, for the employee's own leave view:
 * "1 day expires on 12 Dec 2026", and with more than one date
 * "1 day expires on 12 Dec 2026, then 0.5 on 3 Jan 2027". The server sends
 * them soonest first (comp-off under a validity; services/attendance/compOff.ts).
 * Two dates are named; any after that are counted.
 */
export function expiringWords(expiring, formatDate) {
  const list = Array.isArray(expiring) ? expiring.filter((e) => e && Number(e.days) > 0 && e.expiresOn) : [];
  if (!list.length) return '';
  const [first, second, ...rest] = list;
  const days = (n) => `${n} ${Number(n) === 1 ? 'day' : 'days'}`;
  let out = `${days(first.days)} ${Number(first.days) === 1 ? 'expires' : 'expire'} on ${formatDate(first.expiresOn)}`;
  if (second) out += `, then ${second.days} on ${formatDate(second.expiresOn)}`;
  if (rest.length) out += `, and ${days(Math.round(rest.reduce((a, e) => a + Number(e.days), 0) * 100) / 100)} later`;
  return out;
}
