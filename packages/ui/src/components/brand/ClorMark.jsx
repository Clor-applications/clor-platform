import React from 'react';
import { C_D, DOT } from './logoPaths.js';

/* CLOR icon: the C of the wordmark in dark blue with the blaze orange dot in
   its mouth (14 Nov 2026). Letters are outlined Baloo 2 ExtraBold, so no font
   is needed to draw them. The C spans 0..508 across and 0..643 down; this box
   centres it in a square. The browser tab and app icon put the same C, in
   orange with a white dot, on a blue disc (public/icon.svg). */
const BOX = '-81.5 -13.5 671 671';
const ORANGE = 'rgb(var(--logo-mark-orange, 255 84 0))';
const SLATE = 'rgb(var(--logo-mark-slate, 15 23 42))';

export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const letter = color || SLATE;
  const dot = color || ORANGE;
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
      <path d={C_D} fill={letter} />
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill={dot} />
    </svg>
  );
}
