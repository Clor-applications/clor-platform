import React from 'react';
import ClorMark from './ClorMark.jsx';
import { C, L, O, R, DOT, WORD_WIDTH } from './clorPaths.js';

/**
 * The CLOR logo: the owner's wordmark (3 Nov 2026), drawn from its traced
 * outlines, always in capitals. One logo across the site and every app.
 *
 * `variant`: 'horizontal' (default) and 'wordmark' are the word itself (its C
 * is the mark), 'stacked' the mark above the word, 'mark' the C and its dot
 * alone. `size` is the logo's height in px (or sm/md/lg/xl). The letters take
 * --logo-mark (oxblood on light, white on dark) and the dot --logo-dot (marigold);
 * `color` and `dotColor` set them for one particular ground.
 */
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };
const MARK = 'rgb(var(--logo-mark, 92 10 22))';
const DOT_PAINT = 'rgb(var(--logo-dot, 245 166 35))';

function Word({ h, color, dotColor, className, title }) {
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
      <g fill={color || MARK}>
        <path d={C} />
        <path d={L} />
        <path d={O} />
        <path d={R} />
      </g>
      <path d={DOT} fill={dotColor || DOT_PAINT} />
    </svg>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, dotColor, className = '', title = 'CLOR' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;
  if (variant === 'mark') return <ClorMark size={h} color={color} dotColor={dotColor} className={className} title={title} />;
  if (variant !== 'stacked') return <Word h={h} color={color} dotColor={dotColor} className={className} title={title} />;
  return (
    <span
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(h / 3), verticalAlign: 'middle', flexShrink: 0 }}
    >
      <ClorMark size={h * 1.6} color={color} dotColor={dotColor} title="" />
      <Word h={h} color={color} dotColor={dotColor} title="" />
    </span>
  );
}
