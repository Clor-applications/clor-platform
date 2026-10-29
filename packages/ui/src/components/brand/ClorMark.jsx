import React from 'react';
import { TICK_PATH } from './ClorTick.jsx';

/**
 * The CLOR mark: one stroke, never lifted. It runs round the C and finishes
 * as a tick — the tick being the product's done state, so the mark and the
 * "Filed / Paid / Approved" chips are the same idea.
 *
 * Drawn inline so it follows the theme: indigo on cotton, marigold on the
 * dark indigo ground (`--logo-mark`). The path is ClorTick's, so People and
 * every other app draw the same mark; public/brand/clor-mark.svg matches it.
 *
 * `color` overrides the theme colour for the rare surface that needs it.
 */
export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      {/* A small mark gets a heavier stroke so the tick still reads at favicon size. */}
      <path
        d={TICK_PATH}
        fill="none"
        stroke={color || 'rgb(var(--logo-mark))'}
        strokeWidth={size < 24 ? 15 : 12}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
