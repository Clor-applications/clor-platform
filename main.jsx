import React from 'react';
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
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
