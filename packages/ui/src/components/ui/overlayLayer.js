import { createContext, useContext } from 'react';

/**
 * Which layer the thing you are inside of occupies.
 *
 * A popover has to sit above the surface that owns it and below everything
 * that outranks that surface — and those are different answers for the same
 * component. A select opened inside a dialog belongs above the dialog; the
 * menu still open on the page behind it does not, and a row-action menu that
 * paints over an open dialog is the bug this exists to prevent.
 *
 * The DOM cannot answer it: every overlay portals to `body`, so a popover's
 * ancestors say nothing about what opened it. React context can, because it
 * follows the render tree rather than the document.
 */
export const OverlayLayerContext = createContext('page');

/** `'page'` unless a dialog (`'modal'`) or a side panel (`'drawer'`) has claimed the subtree. */
export const useOverlayLayer = () => useContext(OverlayLayerContext);

/**
 * The z-index a floating panel should take, as a CSS variable reference so
 * the numbers stay in one place — `--z-*` in `index.css`.
 */
export const popoverZIndex = (layer) => {
  if (layer === 'modal') return 'var(--z-modal-popover)';
  if (layer === 'drawer') return 'var(--z-drawer-popover)';
  return 'var(--z-popover)';
};
