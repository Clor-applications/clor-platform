import React from 'react';
import ClorMark from './ClorMark.jsx';
import { WORD_D, BADGE_D, DOT, BOX_FULL, BOX_PLAIN } from './logoPaths.js';

/**
 * The CLOR logo (13 Nov 2026): CLOR in outlined Baloo 2 ExtraBold in dark
 * blue, with a blaze orange dot in the mouth of the C and the A for
 * Applications on a blaze orange disc at the foot of the R. The A is cut out
 * of the disc, so the ground shows through it and it stays readable when the
 * logo is small.
 * variant: 'horizontal' (default) | 'mark' (the C and its dot) | 'wordmark' (no badge) | 'stacked'
 */

const ORANGE = 'rgb(var(--logo-mark-orange, 255 84 0))';
const SLATE = 'rgb(var(--logo-mark-slate, 15 23 42))';
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };
/* `size` means the cap height, as it did when the word was live text; the drawn
   box carries a little air above and below, so it stands about 8% taller. */
const AIR = 1.08;

function Word({ h, color, className, title, badge = true }) {
  const box = badge ? BOX_FULL : BOX_PLAIN;
  const height = Math.round(h * AIR);
  const width = Math.round((height * box.w) / box.h);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const paint = color || SLATE;
  const badgeInk = color || ORANGE;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      fill="none"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      <path d={WORD_D} fill={paint} />
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill={badgeInk} />
      {badge ? <path d={BADGE_D} fill={badgeInk} /> : null}
    </svg>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, className = '', title = 'CLOR', badge = true }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;

  if (variant === 'mark') return <ClorMark size={h} color={color} className={className} title={title} />;
  if (variant === 'wordmark') return <Word h={h} color={color} className={className} title={title} badge={false} />;

  if (variant === 'stacked') {
    return (
      <span
        role="img"
        aria-label={title || undefined}
        aria-hidden={title ? undefined : 'true'}
        className={className}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(h / 4), verticalAlign: 'middle', flexShrink: 0 }}
      >
        <ClorMark size={Math.round(h * 1.4)} color={color} title="" />
        <Word h={h} color={color} title="" badge={badge} />
      </span>
    );
  }

  return <Word h={h} color={color} className={className} title={title} badge={badge} />;
}
