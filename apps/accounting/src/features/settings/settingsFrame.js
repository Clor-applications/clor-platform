import { createContext } from 'react';

/**
 * Where a framed settings screen's actions go, and how it knows it is framed.
 *
 * Kept apart from the component that uses them so that file exports components
 * and nothing else, which is what Fast Refresh needs to swap it cleanly.
 * See `SettingsPageActions.jsx` for why the hoist exists at all.
 */

export const SETTINGS_ACTIONS_SLOT_ID = 'settings-page-actions';

/** True only inside `SettingsWorkspace`, which prints the heading itself. */
export const SettingsFrameContext = createContext(false);
