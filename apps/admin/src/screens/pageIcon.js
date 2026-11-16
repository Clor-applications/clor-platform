import { createContext } from 'react';

/**
 * The colour icon a Workspace page shows beside its title when it names none itself: its own menu
 * item's. The manifest wraps every screen in a provider of this, so no page has to repeat its
 * icon (owner, 17 Nov 2026). A file of its own, so the manifest (loaded with the shell) does not
 * pull the Workspace's kit in with it.
 */
export const PageIconContext = createContext(null);
