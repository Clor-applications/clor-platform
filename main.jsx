import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import ErrorBoundary from './packages/ui/src/components/ui/ErrorBoundary';
import './packages/ui/src/index.css';
import './packages/ui/src/people.css';
/* R&D brand (14 Nov 2026), last so it wins: clor-rnd/README.md. */
import './packages/ui/src/rnd.css';
/* The owner's style picks (17 Nov 2026), after everything; never in Books. */
import './packages/ui/src/picks.css';
/* Legibility (19 Nov 2026): shell and Workspace text sizes and weights, after the picks so it wins. */
import './packages/ui/src/legibility.css';
/* UI polish (21 Nov 2026): icon strokes, optical button padding, photo edges, overlay scroll; never in Books. */
import './packages/ui/src/polish.css';
/* The Motion kit (DESIGN.md, 24 Nov 2026), switched on app by app; last so it wins. People first. */
import './packages/ui/src/motion.css';
import { SessionProvider } from './packages/shell/session';
import Shell from './packages/shell/Shell';
import TipLayer from './packages/ui/src/components/ui/TipLayer';
import { OldBrowserPage, browserIsTooOld } from './packages/ui/src/components/ui/OldBrowser';
import { installStrayDropGuard } from './packages/ui/src/components/ui/FileDrop';

/*
 * Personal data an earlier version left in this browser.
 *
 * Older builds kept the signed-in person's email address in localStorage under
 * `userEmail`; nothing writes it any more, but a value written then stayed,
 * readable by any script on the page and left behind after sign-out. Removed
 * on every start so it does not outlive the version that needed it.
 */
/*
 * Focus rings for keyboard users only (owner, 19 Nov 2026: "remove selection border").
 * Browsers also draw the ring when focus is handed back after a mouse click, such as a menu closing or
 * the side panel after a page change, so a dark box stayed round whatever was clicked. The last kind of
 * input is kept on <html>; legibility.css hides the ring after a pointer and shows it again on a key.
 */
if (typeof document !== 'undefined') {
  const root = document.documentElement;
  const mark = (kind) => () => { if (root.dataset.input !== kind) root.dataset.input = kind; };
  document.addEventListener('pointerdown', mark('pointer'), true);
  /* Escape only closes a panel or menu; the focus it hands back is not keyboard travel. */
  const toKeyboard = mark('keyboard');
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') toKeyboard(); }, true);
}

/* A file let go outside a file field must not open in the tab and lose the form (FileDrop.jsx). */
installStrayDropGuard();

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

/* A browser too old to run CLOR well gets one page naming the browsers that do (round 27); never on Books' own host. */
const tooOld = (() => {
  try {
    return !shareToken && window.location.hostname.split('.')[0] !== 'books' && browserIsTooOld(window);
  } catch {
    return false;
  }
})();

/*
 * One boundary above everything.
 *
 * Each app already renders inside its own ScreenBoundary, so a screen that
 * throws loses its screen and nothing else. This is the one below that: a
 * failure in the shell itself — the session, the switcher, the theme — would
 * otherwise unmount the page and leave a white rectangle with no way back.
 *
 * The root is kept on its container: when this module runs a second time in the
 * same page (the dev server re-optimising a dependency a screen just imported),
 * a second createRoot on the same element warns and fights the first.
 */
const container = document.getElementById('root');
const appRoot = container.__clorRoot || (container.__clorRoot = createRoot(container));
appRoot.render(
  <React.StrictMode>
    <ErrorBoundary>
      {tooOld ? (
        <OldBrowserPage />
      ) : shareToken ? (
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
      {/* White tooltips and the letter count on long text, everywhere but Books (owner's picks, 17 Nov 2026). */}
      {shareToken || tooOld ? null : <TipLayer />}
    </ErrorBoundary>
  </React.StrictMode>
);
