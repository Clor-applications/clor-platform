import { todayIst as istToday } from '@ui/utils/dates';
export { istToday };
/* Small words and dates shared by the attendance-rules screens. */
const pad = (n) => String(n).padStart(2, '0');
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
/** A cut of any size: half days as half() writes them, else two places ("0.14 day"), since a time-missed cut is minutes. */
export const dayAmount = (d) => {
  const n = Math.round(Number(d || 0) * 100) / 100;
  if (!n) return '—';
  if (Math.abs(n * 2 - Math.round(n * 2)) < 1e-9) return half(n);
  return `${n.toFixed(2)} ${n <= 1 ? 'day' : 'days'}`;
};
/** 65 → "1 h 5 min", 40 → "40 min". */
export const minutesText = (m) => {
  const n = Math.max(0, Math.round(Number(m || 0)));
  if (n < 60) return `${n} min`;
  return `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}`;
};
export const dayText = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
export const shortDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
