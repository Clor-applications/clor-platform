import React from 'react';
import { GLYPH, DOT, MARK_VIEWBOX } from './clorPaths.js';

/**
 * The CLOR mark: the ribbon C with its centre dot (owner's master, 5 Nov 2026).
 * The favicon, the app icon and the phone bar wear it; ClorLogo sets the word.
 * It paints in --logo-accent (Blaze orange); `color` overrides it for one ground.
 */
const ACCENT = 'rgb(var(--logo-accent, 255 84 0))';

export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} {...a11y}>
      <g fill={color || ACCENT}>
        <path d={GLYPH} />
        <path d={DOT} />
      </g>
    </svg>
  );
}
