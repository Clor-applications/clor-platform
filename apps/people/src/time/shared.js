/* Small words and dates shared by the attendance-rules screens. */
const pad = (n) => String(n).padStart(2, '0');
export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
export const lastMonth = () => shiftMonth(istToday().slice(0, 7), -1);
export const monthTitle = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** 0.5 → "½ day", 1 → "1 day", 2.5 → "2½ days", 0 → "—". */
export const half = (d) => {
  const n = Math.round(Number(d || 0) * 2) / 2;
  if (!n) return '—';
  const whole = Math.floor(n);
  const text = `${whole || ''}${n % 1 ? '½' : ''}`;
  return `${text} ${n <= 1 ? 'day' : 'days'}`;
};
export const dayText = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
export const shortDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
