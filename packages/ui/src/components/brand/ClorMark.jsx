import React from 'react';
import { SYMBOL_ARC_D, SYMBOL_BRACKET_D, SYMBOL_BOX } from './logoPaths.js';

/* The CLOR icon: the open CL frame from the brand pack — a round-cornered arc
   in the ink and a square bracket in blaze orange. Drawn on its own 100 grid,
   with a little air so it does not touch the edge of its box. */
const PAD = 6;
const BOX = `${-PAD} ${-PAD} ${SYMBOL_BOX.w + 2 * PAD} ${SYMBOL_BOX.h + 2 * PAD}`;
const ORANGE = 'rgb(var(--logo-mark-orange, 255 84 0))';
const INK = 'rgb(var(--logo-mark-slate, 32 35 41))';

export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const ink = color || INK;
  const accent = color || ORANGE;
  return (
    <svg
      width={size}
      height={size}
      viewBox={BOX}
      fill="none"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      <path d={SYMBOL_ARC_D} fill={ink} />
      <path d={SYMBOL_BRACKET_D} fill={accent} />
    </svg>
  );
}
