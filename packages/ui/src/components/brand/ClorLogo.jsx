import React from 'react';
import ClorMark from './ClorMark.jsx';

/**
 * The Clor logo: the wordmark clor.in uses (public/brand/clor-logo.png), or the
 * mark alone. One logo across the site and every app.
 *
 * `variant`: 'horizontal' (default) and 'wordmark' show the wordmark,
 * 'stacked' the mark above it, 'mark' the mark only. `color` is accepted for
 * older callers and ignored.
 */
const RATIO = 669 / 188;
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };

// eslint-disable-next-line no-unused-vars
export default function ClorLogo({ variant = 'horizontal', size = 'md', color, className = '', title = 'Clor' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;
  if (variant === 'mark') return <ClorMark size={h} className={className} title={title} />;
  const word = (
    <img
      src="/brand/clor-logo.png"
      height={h}
      width={Math.round(h * RATIO)}
      alt={title || ''}
      aria-hidden={title ? undefined : 'true'}
      className={variant === 'stacked' ? '' : className}
      draggable={false}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    />
  );
  if (variant !== 'stacked') return word;
  return (
    <span className={className} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(h / 3) }}>
      <ClorMark size={h * 1.6} title="" />
      {word}
    </span>
  );
}
