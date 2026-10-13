/**
 * App-wide notifications, as a tiny event bus.
 *
 * Why a bus and not context: the callers are 180+ existing handlers spread
 * across every module, many outside any provider. A module-scope singleton
 * lets `notify.error('…')` be a drop-in replacement for `alert('…')` with a
 * one-line import, and the single <Toaster /> mounted at the app root is the
 * only subscriber.
 */

const toastListeners = new Set();
const confirmListeners = new Set();
let nextId = 0;

const push = (kind, message) => {
  const text = String(message ?? '').trim();
  if (!text) return;
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
export const confirmDialog = ({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', tone = 'danger' } = {}) =>
  new Promise((resolve) => {
    const request = { id: ++nextId, title, message, confirmLabel, tone, resolve };
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
