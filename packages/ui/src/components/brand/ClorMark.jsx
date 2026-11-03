import React from 'react';
import { C, DOT, MARK_VIEWBOX } from './clorPaths.js';

/**
 * The CLOR mark: the C of the owner's wordmark (3 Nov 2026) with the marigold
 * dot inside it. The app icon, the favicon and the phone bar wear it;
 * ClorLogo sets the whole word.
 *
 * Paints follow the theme: the C takes --logo-mark (oxblood on light grounds,
 * white on dark), the dot --logo-dot (marigold). `color` sets the C for one
 * particular ground; on a marigold ground pass `dotColor` too, or the dot
 * vanishes.
 */
const MARK = 'rgb(var(--logo-mark, 92 10 22))';
const DOT_PAINT = 'rgb(var(--logo-dot, 245 166 35))';

export default function ClorMark({ size = 28, color, dotColor, className = '', title = 'CLOR' }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} {...a11y}>
      <path d={C} fill={color || MARK} />
      <path d={DOT} fill={dotColor || DOT_PAINT} />
    </svg>
  );
}
