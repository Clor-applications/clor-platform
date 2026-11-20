/**
 * App-wide notifications, as a tiny event bus.
 *
 * Why a bus and not context: the callers are 180+ existing handlers spread
 * across every module, many outside any provider. A module-scope singleton
 * lets `notify.error('…')` be a drop-in replacement for `alert('…')` with a
 * one-line import, and the single <Toaster /> mounted at the app root is the
 * only subscriber.
 */

/** What the server says when an Explore session (the read-only sample company) tries a change. */
export const EXPLORE_READ_ONLY_TEXT = 'This is a sample company, so changes are off.';

const toastListeners = new Set();
const confirmListeners = new Set();
let nextId = 0;

const push = (kind, message) => {
  let text = String(message ?? '').trim();
  if (!text) return;
  /* Explore: whatever a screen wraps the refusal in ("Saved on this device only — the server
     refused it: …"), the visitor reads the one sentence, once, as a note rather than an error. */
  if (text.includes(EXPLORE_READ_ONLY_TEXT)) {
    text = EXPLORE_READ_ONLY_TEXT;
    kind = 'info';
  }
  const toast = { id: ++nextId, kind, message: text };
  toastListeners.forEach((l) => l(toast));
};

/*
 * Sonner renders the toasts now; this bus still carries them.
 *
 * The 180+ handlers that call `notify.error(…)` do not know or care what draws
 * the result, which is exactly why the bus was built — so the renderer could
 * be replaced without touching them. What the library brings that the
 * hand-rolled stack did not: swipe to dismiss, hover to pause, promise
 * toasts, and a stack that reflows properly when one is taken from the middle.
 */

export const notify = {
  success: (m) => push('success', m),
  error: (m) => push('error', m),
  info: (m) => push('info', m),
};

export const subscribeToasts = (fn) => {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
};

/**
 * Styled replacement for window.confirm. Returns a promise so call sites read
 * `if (!(await confirmDialog({...}))) return;` — the same guard shape as the
 * native call, one `await` added.
 */
/* `cancelLabel` names the way out; `stayFirst` makes it the main button (round 61 "unsavedleave" A:
   "Leave without saving?" with Stay as the main button, so a stray click never loses work). */
/* Every call should name the action in the title and on the button ("Delete 3 files?" / "Delete files").
   The defaults below only keep an unnamed call working; in development it says which call needs words. */
export const confirmDialog = ({ title, message = '', confirmLabel, tone = 'danger', cancelLabel = 'Cancel', stayFirst = false } = {}) =>
  new Promise((resolve) => {
    if ((!title || !confirmLabel) && import.meta.env?.DEV) {
      console.warn('confirm-dialog-unnamed', { title, confirmLabel }); // give it a title and a confirmLabel that name the action
    }
    title = title || 'Continue with this?';
    confirmLabel = confirmLabel || 'Continue';
    const request = { id: ++nextId, title, message, confirmLabel, tone, cancelLabel, stayFirst, resolve };
    confirmListeners.forEach((l) => l(request));
    // No subscriber mounted (tests, early boot): fall back to the native
    // dialog rather than silently resolving false and eating the action.
    if (confirmListeners.size === 0) {
      resolve(typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false);
    }
  });

export const subscribeConfirms = (fn) => {
  confirmListeners.add(fn);
  return () => confirmListeners.delete(fn);
};
