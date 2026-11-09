import { createContext, useContext } from 'react';

/**
 * Which icon set an app draws in: 'line' (the platform's Lucide outlines, Accounting's) or 'duo' (Phosphor's
 * two-tone marks, every other app since 9 Nov 2026; see duoIcon.jsx and colorSwap.jsx).
 *
 * An app names `iconSet` in its manifest and the shell provides it here; the shell's own pages (sign-in, company
 * setup) draw in 'duo'. Shared components that draw a content mark ask this context; an app without it renders
 * exactly as before.
 */
export const IconSetContext = createContext('line');
/** Which line icons the open app draws: 'lucide' (the default, Accounting) or 'fluent' (Fluent Regular). See lineIcons.js. */
export const LineSetContext = createContext('lucide');
export const useIconSet = () => useContext(IconSetContext);
