import React from 'react';

/**
 * The CLOR mark (brand direction D, "Done, daily"; owner 29 Oct 2026): one
 * stroke, never lifted, runs round the C and finishes as a tick. People wears
 * it first; the other apps keep the clor.in mark (ClorMark) until they move
 * over.
 *
 * Indigo on light grounds; `color` sets it for a dark or coloured ground.
 * `wordmark` sets CLOR beside it — always in capitals.
 */
export const INDIGO = '#232A66';
export const MARIGOLD = '#F5A623';
export const TICK_PATH = 'M74.04 25.96 A34 34 0 1 0 50 84 L92 34';

export default function ClorTick({ size = 28, wordmark = false, color = INDIGO, className = '', title = 'CLOR' }) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title && !wordmark ? 'img' : undefined}
      aria-label={title && !wordmark ? title : undefined}
      aria-hidden={title && !wordmark ? undefined : 'true'}
      className={wordmark ? '' : className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      {/* A small mark gets a heavier stroke so the tick still reads at favicon size. */}
      <path d={TICK_PATH} fill="none" stroke={color} strokeWidth={size < 24 ? 15 : 12} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (!wordmark) return mark;
  return (
    <span
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.3), flexShrink: 0 }}
    >
      {mark}
      <span aria-hidden="true" style={{ color, fontWeight: 800, fontSize: Math.round(size * 0.78), letterSpacing: '-0.01em', lineHeight: 1 }}>CLOR</span>
    </span>
  );
}
