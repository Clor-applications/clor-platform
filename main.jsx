import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import ErrorBoundary from './packages/ui/src/components/ui/ErrorBoundary';
import './packages/ui/src/index.css';
import './packages/ui/src/people.css';
/* R&D brand (14 Nov 2026), last so it wins: clor-rnd/README.md. */
import './packages/ui/src/rnd.css';
import { SessionProvider } from './packages/shell/session';
import Shell from './packages/shell/Shell';

/*
 * Personal data an earlier version left in this browser.
 *
 * Older builds kept the signed-in person's email address in localStorage under
 * `userEmail`; nothing writes it any more, but a value written then stayed,
 * readable by any script on the page and left behind after sign-out. Removed
 * on every start so it does not outlive the version that needed it.
 */
try {
  localStorage.removeItem('userEmail');
} catch {
  /* storage unavailable: nothing to remove */
}

/*
 * A new release while this tab was open.
 *
 * Every deploy renames the code files, and the old ones are gone from the
 * server. A tab opened before the deploy still asks for an old name when it
 * opens a screen it has not loaded yet, and fails with "error loading
 * dynamically imported module". Reloading fetches the new release. Once a
 * minute at most, so a file that is truly missing cannot loop the page.
 */
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('clor:staleReloadAt')) || 0;
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('clor:staleReloadAt', String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway, the browser keeps its own guard */
  }
  event.preventDefault();
  window.location.reload();
});

/*
 * A customer following an invoice link (`/?share=<token>`, A-32).
 *
 * They have no account here and never will, so the page is the invoice and
 * nothing else — no session, no sign-in, no app. It used to be decided inside
 * the Accounting app, which only loads for someone signed in, so a customer
 * saw the public home page and a signed-in colleague saw their own books.
 */
const shareToken = (() => {
  try {
    return String(new URLSearchParams(window.location.search).get('share') || '').trim();
  } catch {
    return '';
  }
})();
const SharedInvoice = lazy(() => import('./apps/accounting/src/features/sales/SharedInvoice'));

/*
 * The Clor operator console (W-8.2): ops.clor.in, or /ops on any Clor host.
 * Not part of the customer shell — an operator is outside every account — so
 * it is its own root, loaded only here.
 */
const isOps = (() => {
  try {
    return window.location.hostname.split('.')[0] === 'ops' || /^\/ops(\/|$)/.test(window.location.pathname);
  } catch {
    return false;
  }
})();
const OpsConsole = lazy(() => import('./packages/ops/OpsConsole'));

/*
 * One boundary above everything.
 *
 * Each app already renders inside its own ScreenBoundary, so a screen that
 * throws loses its screen and nothing else. This is the one below that: a
 * failure in the shell itself — the session, the switcher, the theme — would
 * otherwise unmount the page and leave a white rectangle with no way back.
 */
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {shareToken ? (
        <Suspense fallback={null}>
          <SharedInvoice token={shareToken} />
        </Suspense>
      ) : (
        <SessionProvider>
          {isOps ? (
            <Suspense fallback={null}>
              <OpsConsole />
            </Suspense>
          ) : (
            <Shell />
          )}
        </SessionProvider>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
