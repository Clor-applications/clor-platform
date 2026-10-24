import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import ErrorBoundary from './packages/ui/src/components/ui/ErrorBoundary';
import './packages/ui/src/index.css';
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
          <Shell />
        </SessionProvider>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
