import React from 'react';
import ClorMark from './ClorMark.jsx';
import { C, L, O, R, DOT, WORD_WIDTH } from './clorPaths.js';

/**
 * The CLOR logo (6 Nov 2026): C-mark icon + CLOR wordmark.
 * Wordmark: C=slate, L=slate, O=orange, R=slate (only O carries the brand colour).
 * `variant`: 'horizontal' (default) = mark icon + word side-by-side;
 *            'wordmark' = word only; 'mark' = icon only; 'stacked' = icon above word.
 */
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };
/* Only O is orange. C/L/R are slate. `color` override applies to all for one-colour contexts. */
const ORANGE    = 'rgb(var(--logo-mark-orange, 255 84 0))';
const SLATE     = 'rgb(var(--logo-mark-slate,  15 23 42))';
const DOT_PAINT = 'rgb(var(--logo-dot, 255 84 0))';

function Word({ h, color, dotColor, className, title }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const co = color || ORANGE;
  const sl = color || SLATE;
  return (
    <svg
      width={Math.round((h * WORD_WIDTH) / 100)}
      height={h}
      viewBox={`0 0 ${WORD_WIDTH} 100`}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      <path d={C} fill={sl} />
      <path d={L} fill={sl} />
      <path d={O} fill={co} />
      <path d={R} fill={sl} />
      <path d={DOT} fill={dotColor || DOT_PAINT} />
    </svg>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, dotColor, className = '', title = 'CLOR' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;
  if (variant === 'mark')     return <ClorMark size={h} color={color} className={className} title={title} />;
  if (variant === 'wordmark') return <Word h={h} color={color} dotColor={dotColor} className={className} title={title} />;
  if (variant === 'stacked') {
    return (
      <span
        role="img"
        aria-label={title || undefined}
        aria-hidden={title ? undefined : 'true'}
        className={className}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(h / 3), verticalAlign: 'middle', flexShrink: 0 }}
      >
        <ClorMark size={Math.round(h * 1.4)} color={color} title="" />
        <Word h={h} color={color} dotColor={dotColor} title="" />
      </span>
    );
  }
  /* horizontal (default): C-mark icon + CLOR word side by side */
  return (
    <span
      role="img"
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(h * 0.35), verticalAlign: 'middle', flexShrink: 0 }}
    >
      <ClorMark size={h} color={color} title="" />
      <Word h={h} color={color} dotColor={dotColor} title="" />
    </span>
  );
}
