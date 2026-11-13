import { includedIn, shownApps } from '@platform/includedApps';

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

/**
 * Emails more than one app sends, in the order they are listed under. The
 * Monday summary goes out when People or Attendance is on
 * (services/people/weeklySummary.ts), so an Attendance-only company must be
 * able to stop it too.
 */
const SENT_BY = {
  'people.weekly_summary': ['people', 'attendance'],
};

/**
 * Templates the server lists but nothing sends yet: an invoice by email and
 * the overdue reminder. A switch for mail that never goes would only mislead;
 * they appear once a sender exists and comes off this list.
 */
export const NOT_SENT_YET = new Set(['invoice.sent', 'invoice.payment_reminder']);

const OTHER = { id: 'other', label: 'Every app' };

/** Every app that sends this email, first one first. */
export const appsOfEmail = (key = '') => {
  if (SENT_BY[key]) return SENT_BY[key];
  const app = EMAIL_APPS.find((a) => a.prefixes.some((p) => String(key).startsWith(p)));
  return [app ? app.id : OTHER.id];
};

/** The app an email is filed under when every app is shown. */
export const appOfEmail = (key = '') => appsOfEmail(key)[0];

/**
 * The emails in groups, one per app. With `subscriptions` (the company's app
 * ids) only the apps it has on appear, each even when it has nothing to switch
 * off, so a Payroll-only company is told so rather than shown an empty page.
 * An email two apps send is listed once, under the first of them that is on.
 * Without `subscriptions`, every app that sends a switchable email appears.
 * A company on People has Attendance inside it, so Attendance's emails are
 * listed under People and there is no Attendance group.
 */
export function emailGroups(events = [], subscriptions = null) {
  /* An app the company has inside another (Attendance, on People) has no group of its own: its emails are listed under that app. */
  const on = Array.isArray(subscriptions) ? new Set(shownApps(subscriptions)) : null;
  const sent = events.filter((e) => !NOT_SENT_YET.has(e.key));
  const home = (e) => {
    const apps = appsOfEmail(e.key);
    if (apps[0] === OTHER.id) return OTHER.id;
    if (!on) return apps[0];
    return apps.find((a) => on.has(a)) || apps.map((a) => includedIn(a, subscriptions)).find((a) => a && on.has(a)) || null;
  };
  const groups = EMAIL_APPS.filter((a) => (on ? on.has(a.id) : true)).map((a) => ({
    id: a.id,
    label: a.label,
    events: sent.filter((e) => home(e) === a.id),
  }));
  const other = sent.filter((e) => home(e) === OTHER.id);
  const shown = on ? groups : groups.filter((g) => g.events.length);
  return other.length ? [...shown, { ...OTHER, events: other }] : shown;
}

/** The PUT body: each listed email with its switch. */
export const switchesBody = (events = []) => events.map((e) => ({ eventKey: e.key, enabled: Boolean(e.enabled) }));

/** Flip one email's switch in a list held in state. */
export const toggleEmail = (events, key, enabled) => events.map((x) => (x.key === key ? { ...x, enabled } : x));
