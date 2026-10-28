import React from 'react';
import ClorMark from './ClorMark.jsx';

/**
 * The CLOR logo: the C-tick mark beside the wordmark, set in Bricolage
 * Grotesque ExtraBold capitals. One logo across the site and every app; the
 * wordmark is always "CLOR".
 *
 * `variant`: 'horizontal' (default) is mark + wordmark, 'wordmark' the word
 * alone, 'stacked' the mark above it, 'mark' the mark only. `size` is the
 * mark's height in px (or sm/md/lg/xl). `color` overrides the theme colour.
 */
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, className = '', title = 'CLOR' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;
  if (variant === 'mark') return <ClorMark size={h} color={color} className={className} title={title} />;
  const word = (
    <span
      className="ui-wordmark"
      aria-hidden="true"
      style={{ fontSize: Math.round(h * 0.92), color: color || undefined }}
    >
      CLOR
    </span>
  );
  const stacked = variant === 'stacked';
  return (
    <span
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={{
        display: 'inline-flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        gap: stacked ? Math.round(h / 3) : Math.round(h * 0.28),
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      {variant !== 'wordmark' && <ClorMark size={stacked ? h * 1.6 : h} color={color} title="" />}
      {word}
    </span>
  );
}
