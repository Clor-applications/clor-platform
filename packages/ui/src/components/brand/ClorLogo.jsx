import React from 'react';
import ClorMark from './ClorMark.jsx';
import { WORD_D, DESC_D, DOT, BOX_PLAIN, BOX_STACK } from './logoPaths.js';

/**
 * The CLOR logo (14 Nov 2026): CLOR in outlined Baloo 2 ExtraBold in dark blue
 * with a blaze orange dot in the mouth of the C.
 *
 * The company is CLOR Applications, and the full lockup says so: APPLICATIONS
 * sits under the name, left aligned and tracked out to the exact width of the
 * wordmark, the way a sub-brand descriptor is set. It is only legible from
 * about 40px of cap height, so app chrome draws the name alone.
 *
 * variant: 'horizontal' (default, the name) | 'stacked' (the name with the
 * descriptor under it) | 'mark' (the C and its dot). 'wordmark' is the old name
 * for 'horizontal' and still works.
 */

const ORANGE = 'rgb(var(--logo-mark-orange, 255 84 0))';
const SLATE = 'rgb(var(--logo-mark-slate, 15 23 42))';
const HEIGHTS = { sm: 20, md: 28, lg: 40, xl: 56 };
/* `size` means the cap height of CLOR, as it did when the word was live text.
   Every box is measured against that cap height, so the name is drawn the same
   size whether or not the descriptor is under it. */
const CAP = 625;

function Word({ h, color, descriptorColor, className, title, descriptor = false }) {
  const box = descriptor ? BOX_STACK : BOX_PLAIN;
  const height = Math.round((h * box.h) / CAP);
  const width = Math.round((height * box.w) / box.h);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const paint = color || SLATE;
  const accent = color || ORANGE;
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
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill={accent} />
      {descriptor ? <path d={DESC_D} fill={descriptorColor || accent} /> : null}
    </svg>
  );
}

export default function ClorLogo({ variant = 'horizontal', size = 'md', color, descriptorColor, className = '', title = 'CLOR' }) {
  const h = typeof size === 'number' ? size : HEIGHTS[size] || HEIGHTS.md;

  if (variant === 'mark') return <ClorMark size={h} color={color} className={className} title={title} />;
  if (variant === 'stacked') {
    return (
      <Word
        h={h}
        color={color}
        descriptorColor={descriptorColor}
        className={className}
        title={title === 'CLOR' ? 'CLOR Applications' : title}
        descriptor
      />
    );
  }
  return <Word h={h} color={color} className={className} title={title} />;
}
