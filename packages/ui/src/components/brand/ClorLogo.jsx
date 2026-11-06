import React from 'react';
import ClorMark from './ClorMark.jsx';
import { GLYPH, DOT, C, L, O, R, WORD_WIDTH } from './clorPaths.js';

/**
 * The CLOR logo (owner's master, 5 Nov 2026): the ribbon mark, then CLOR in
 * outlined letters, always capitals. One logo across the site and every app.
 *
 * `variant`: 'horizontal' (default) is mark and word, 'stacked' the mark above
 * them, 'mark' the ribbon alone. `size` is the logo's height in px (or
 * sm/md/lg/xl). The ribbon, dot and O take --logo-accent (Blaze orange), the
 * other letters --logo-ink (slate on light, white on dark); `color` and
 * `accentColor` set them for one particular ground.
 */
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };
const INK = 'rgb(var(--logo-ink, 15 23 42))';
const ACCENT = 'rgb(var(--logo-accent, 255 84 0))';

function Word({ h, color, accentColor, className, title }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  return (
    <svg
      width={Math.round((h * WORD_WIDTH) / 100)}
      height={h}
      viewBox={`0 0 ${WORD_WIDTH} 100`}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      <g fill={accentColor || ACCENT}>
        <path d={GLYPH} />
        <path d={DOT} />
        <path d={O} />
      </g>
      <g fill={color || INK}>
        <path d={C} />
        <path d={L} />
        <path d={R} />
      </g>
    </svg>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, accentColor, className = '', title = 'CLOR' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;
  if (variant === 'mark') return <ClorMark size={h} color={accentColor} className={className} title={title} />;
  if (variant !== 'stacked') return <Word h={h} color={color} accentColor={accentColor} className={className} title={title} />;
  return (
    <span
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(h / 3), verticalAlign: 'middle', flexShrink: 0 }}
    >
      <ClorMark size={h * 1.6} color={accentColor} title="" />
      <Word h={h} color={color} accentColor={accentColor} title="" />
    </span>
  );
}
