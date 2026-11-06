import React from 'react';
import ClorMark from './ClorMark.jsx';

/**
 * The CLOR logo (6 Nov 2026): C-mark icon + CLOR wordmark.
 * Wordmark: Plus Jakarta Sans 800 — C/L/R slate, O orange. Plain text, NOT clorPaths.js.
 * `variant`: 'horizontal' (default) = mark + word side-by-side;
 *            'wordmark' = word only; 'mark' = icon only; 'stacked' = icon above word.
 */

const ORANGE = 'rgb(var(--logo-mark-orange, 255 84 0))';
const SLATE  = 'rgb(var(--logo-mark-slate,  15 23 42))';

const FONT = "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', ui-sans-serif, sans-serif";

function Word({ h, color, className, title }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const co = color || ORANGE;
  const sl = color || SLATE;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: h,
        lineHeight: 1,
        letterSpacing: '-0.03em',
        userSelect: 'none',
        flexShrink: 0,
      }}
      {...a11y}
    >
      <span style={{ color: sl }}>CL</span>
      <span style={{ color: co }}>O</span>
      <span style={{ color: sl }}>R</span>
    </span>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, className = '', title = 'CLOR' }) {
  const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;

  if (variant === 'mark')     return <ClorMark size={h} color={color} className={className} title={title} />;
  if (variant === 'wordmark') return <Word h={h} color={color} className={className} title={title} />;

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
        <Word h={h} color={color} title="" />
      </span>
    );
  }

  /* horizontal (default) */
  return (
    <span
      role="img"
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(h * 0.2), verticalAlign: 'middle', flexShrink: 0 }}
    >
      <ClorMark size={h} color={color} title="" />
      <Word h={h} color={color} title="" />
    </span>
  );
}
