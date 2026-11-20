/**
 * One sentence a person can act on, from whatever a failed call threw.
 *
 * Screens used to write `String(e?.message || 'Not saved.')`: the server's text when there was
 * one (sometimes a code, a field name or a library message), and otherwise two words with no
 * cause and no next step. `errorWords(e, 'save the shift')` keeps the server's sentence when it is
 * a plain sentence, and otherwise says what did not happen and what to do:
 * "Could not save the shift. Try again."
 *
 * `what` is the action in plain words, written to follow "Could not": "save the shift",
 * "approve the request", "load the pay runs".
 */

/* Codes the server sends beside its text, in words a person can act on. */
const CODE_WORDS = {
  APP_NOT_SUBSCRIBED: 'This app is not on your plan. An owner can add it under Admin center → Billing & seats.',
  SUBSCRIPTION_LAPSED: 'Your CLOR subscription has ended. An owner can renew it under Admin center → Billing & seats.',
  NO_ROLE_GRANT: 'Your role does not allow this. Ask an administrator of this company to change your role.',
  PERMISSION_DENIED: 'Your role does not allow this. Ask an administrator of this company to change your role.',
  MODULE_OFF: 'This feature is switched off for your company.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Write to support@clor.in.',
  STEP_UP_REQUIRED: 'Enter the code from your authenticator app to continue.',
};

/* Text that reads like a program talking, not a person: codes, field names, library errors. */
const DEVELOPER_TEXT = [
  /^[A-Z][A-Z0-9_]{3,}$/, // APP_NOT_SUBSCRIBED
  /\b[a-z]+[A-Z][a-zA-Z]*Id\b/, // employeeId, orgId
  /\borgId\b|\btenant\b|\bpayload\b|\btoken\b|\bJWT\b|\bPrisma\b|\bZod\b/i,
  /^Validation error/i,
  /Invalid input: expected/i,
  /\[object \w+\]/,
  /^(TypeError|SyntaxError|ReferenceError|Error):/,
  /Failed to fetch|NetworkError|Load failed/i,
  /Unexpected token|is not valid JSON/i,
  /^(Unauthorized|Forbidden|Bad request|Not found|Server error|Internal server error)\.?$/i,
  /^Request failed \(\d+\)/,
  /^[{[]/, // raw JSON
];

const looksHuman = (text) => {
  if (!text || text.length > 400) return false;
  if (DEVELOPER_TEXT.some((re) => re.test(text))) return false;
  return /[a-z]/.test(text) && /\s/.test(text);
};

const sentence = (text) => {
  const t = String(text).trim();
  if (!t) return t;
  const first = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(first) ? first : `${first}.`;
};

/** The sentence to show for a failed call. */
export function errorWords(e, what = 'do that') {
  if (e?.network) return 'CLOR could not be reached. Check your connection and try again. Anything you typed is still here.';
  if (e?.code && CODE_WORDS[e.code]) return CODE_WORDS[e.code];
  const text = typeof e === 'string' ? e : e?.message;
  if (looksHuman(String(text || '').trim())) return sentence(text);
  if (e?.status === 401) return 'You have been signed out. Sign in again.';
  if (e?.status === 403) return CODE_WORDS.PERMISSION_DENIED;
  if (e?.status === 404) return `Could not ${what}: it is no longer there. Reload the page.`;
  if (e?.status === 409) return `Could not ${what}: someone else changed it. Reload the page and try again.`;
  if (e?.status === 429) return 'Too many tries. Wait a minute and try again.';
  const ref = e?.requestId ? ` If it happens again, tell CLOR support the reference ${e.requestId}.` : '';
  return `Could not ${what}. Try again.${ref}`;
}

/* Statuses a subscription can be in, said as a sentence. */
const SUBSCRIPTION_SENTENCES = {
  ACTIVE: 'Your subscription is active.',
  TRIALING: 'You are on a free trial.',
  TRIAL: 'You are on a free trial.',
  PAST_DUE: 'Your payment is overdue. Pay the open invoice to keep your apps working.',
  UNPAID: 'Your payment is overdue. Pay the open invoice to keep your apps working.',
  OVERDUE: 'Your payment is overdue. Pay the open invoice to keep your apps working.',
  CANCELLED: 'Your subscription was cancelled.',
  CANCELED: 'Your subscription was cancelled.',
  PAUSED: 'Your subscription is paused.',
  EXPIRED: 'Your trial has ended.',
  ENDED: 'Your subscription has ended.',
  SUSPENDED: 'Your account is suspended.',
};
const SUBSCRIPTION_WORDS = {
  ACTIVE: 'Active', TRIALING: 'Free trial', TRIAL: 'Free trial', PAST_DUE: 'Payment overdue', UNPAID: 'Payment overdue',
  OVERDUE: 'Payment overdue', CANCELLED: 'Cancelled', CANCELED: 'Cancelled', PAUSED: 'Paused', EXPIRED: 'Trial ended',
  ENDED: 'Ended', SUSPENDED: 'Suspended',
};
const key = (s) => String(s || '').trim().toUpperCase();

/** "Your payment is overdue. …" for a subscription status such as `past_due`. */
export const subscriptionSentence = (status) => SUBSCRIPTION_SENTENCES[key(status)] || 'Your subscription needs attention. Open Billing & seats to see why.';
/** "Payment overdue" for a pill or a table cell. */
export const subscriptionWord = (status) => SUBSCRIPTION_WORDS[key(status)] || 'Needs attention';

/** Any UPPER_SNAKE value as words, for a status the screen has no label for: PENDING_APPROVAL → "Pending approval". */
export const enumWords = (value) => {
  const t = String(value ?? '').trim();
  if (!t) return '';
  const words = t.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
};

/** "14 Nov 2026" from an ISO date or timestamp; '' when empty. */
export const dayText = (iso, { year = true } = {}) => {
  if (!iso) return '';
  const s = String(iso);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(s);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: plain ? 'UTC' : 'Asia/Kolkata' });
};

/** "14 Nov 2026, 3:30 pm" from a timestamp, in India time. */
export const dayTimeText = (at) => {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase();
  return `${day}, ${time}`;
};

/** "November 2026" from "2026-11". */
export const monthText = (ym) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
  if (!m) return String(ym || '');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** "1 day", "3 days". */
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
