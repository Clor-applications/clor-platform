import React from 'react';
import { createRoot } from 'react-dom/client';

import ErrorBoundary from './packages/ui/src/components/ui/ErrorBoundary';
import './packages/ui/src/index.css';
import { SessionProvider } from './packages/shell/session';
import Shell from './packages/shell/Shell';

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
