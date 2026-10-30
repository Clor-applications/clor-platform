/* Plain helpers for hourly leave (LeaveShape.jsx and the forms that use it; kept apart so LeaveShape.jsx holds components only). */

/** Quarter-hour times for hourly leave, 06:00 to 23:45. */
export const QUARTERS = Array.from({ length: 72 }, (_, i) => {
  const m = 360 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

/** An hourly type: hours on one day, no half days. */
export const isHourly = (type) => type?.unit === 'HOUR';

/** What a form sends for hourly leave: the one day and its hours. Nothing for a type taken in days. */
export function hoursBody(form, type) {
  if (!isHourly(type)) return {};
  return { toDate: form.fromDate, halfDay: null, fromTime: form.fromTime || null, toTime: form.toTime || null };
}

/** Whether the form holds all an hourly type needs before it is worked out: both times. */
export const hoursReady = (form, type) => !isHourly(type) || Boolean(form.fromTime && form.toTime);

/** Words for a request's hours beside its dates in a list, or null. */
export const hoursText = (r) => (r?.fromTime && r?.toTime ? `${r.fromTime} to ${r.toTime}` : null);

/** An hourly type's day, in hours (LeaveType.hoursPerDay; 8 when not set). */
export const hoursPerDayOf = (type) => Number(type?.hoursPerDay) || 8;

/** Hours in words: "2 hours", "1 hour", "1.5 hours". */
export const hoursWords = (h) => {
  const n = Math.round(Number(h || 0) * 100) / 100;
  return `${n} ${n === 1 ? 'hour' : 'hours'}`;
};

/**
 * An amount of leave in this type's own words (FEATURE-UI-AUDIT gap 23): an
 * hourly type in hours ("2 hours"), any other in days ("1.5 days"). Balances
 * are kept in days; an hour is 1/hoursPerDay of one.
 */
export function amountWords(days, type) {
  if (days == null || days === '') return '';
  if (isHourly(type)) return hoursWords(Number(days) * hoursPerDayOf(type));
  const n = Math.round(Number(days) * 100) / 100;
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** The bare figure for a balance tile: hours for an hourly type, days otherwise. */
export const amountFigure = (days, type) => (days == null ? days : isHourly(type) ? Math.round(Number(days) * hoursPerDayOf(type) * 100) / 100 : days);

/** A request's hours from its times (the inbox and lists, which carry no type). */
export function hoursBetween(fromTime, toTime) {
  if (!fromTime || !toTime) return null;
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  /* A night shift's hours run past midnight: the end is the next morning. */
  const d = m(toTime) - m(fromTime);
  return (d <= 0 ? d + 1440 : d) / 60;
}
