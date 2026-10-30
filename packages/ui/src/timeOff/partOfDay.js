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
