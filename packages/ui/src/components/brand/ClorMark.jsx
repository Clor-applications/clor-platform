import React from 'react';
import { C, DOT, MARK_VIEWBOX } from './clorPaths.js';

/* CLOR C-mark icon — owner's traced artwork (clorPaths.js MARK_VIEWBOX). */
export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const paint = color || 'rgb(var(--logo-mark-orange, 255 84 0))';
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      fill="none"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      <path d={C} fill={paint} />
      <path d={DOT} fill={paint} />
    </svg>
  );
}
