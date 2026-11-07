/**
 * Which app sends each email a company can switch off, by the template key's
 * first word (server/src/constants/emailTemplates.ts). Workspace lists them
 * under the app that sends them, and only for the apps the company has on.
 * A key no app claims goes under "Every app", so a new email is never hidden.
 */
export const EMAIL_APPS = [
  { id: 'accounting', label: 'Accounting', prefixes: ['invoice.', 'approval.'] },
  { id: 'people', label: 'People', prefixes: ['people.'] },
  { id: 'attendance', label: 'Attendance', prefixes: ['attendance.', 'reports.'] },
  { id: 'payroll', label: 'Payroll', prefixes: ['payroll.'] },
];

const OTHER = { id: 'other', label: 'Every app' };

export const appOfEmail = (key = '') =>
  EMAIL_APPS.find((a) => a.prefixes.some((p) => String(key).startsWith(p)))?.id || OTHER.id;

/**
 * The emails in groups, one per app. With `subscriptions` (the company's app
 * ids) only the apps it has on appear, each even when it has nothing to switch
 * off, so a Payroll-only company is told so rather than shown an empty page.
 * Without it, every app that sends a switchable email appears.
 */
export function emailGroups(events = [], subscriptions = null) {
  const on = Array.isArray(subscriptions) ? new Set(subscriptions) : null;
  const groups = EMAIL_APPS.filter((a) => (on ? on.has(a.id) : true)).map((a) => ({
    id: a.id,
    label: a.label,
    events: events.filter((e) => appOfEmail(e.key) === a.id),
  }));
  const other = events.filter((e) => appOfEmail(e.key) === OTHER.id);
  const shown = on ? groups : groups.filter((g) => g.events.length);
  return other.length ? [...shown, { ...OTHER, events: other }] : shown;
}

/** The PUT body: each listed email with its switch. */
export const switchesBody = (events = []) => events.map((e) => ({ eventKey: e.key, enabled: Boolean(e.enabled) }));

/** Flip one email's switch in a list held in state. */
export const toggleEmail = (events, key, enabled) => events.map((x) => (x.key === key ? { ...x, enabled } : x));
