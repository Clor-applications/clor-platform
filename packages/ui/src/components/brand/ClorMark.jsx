import React from 'react';

/**
 * The CLOR mark: one stroke, never lifted. It runs round the C and finishes
 * as a tick — the tick being the product's done state, so the mark and the
 * "Filed / Paid / Approved" chips are the same idea.
 *
 * Drawn inline so it follows the theme: indigo on cotton, marigold on the
 * dark indigo ground (`--logo-mark`). Same geometry as public/brand/clor-mark.svg.
 *
 * `color` overrides the theme colour for the rare surface that needs it.
 */
export const MARK_PATH = 'M61.74 29.19A28 28 0 1 0 51.65 76.63L85 24';

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
      <path
        d={MARK_PATH}
        fill="none"
        stroke={color || 'rgb(var(--logo-mark))'}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
