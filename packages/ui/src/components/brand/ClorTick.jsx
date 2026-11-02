import React from 'react';

/**
 * The CLOR mark (brand direction D, "Done, daily"; owner 29 Oct 2026): one
 * stroke, never lifted, runs round the C and finishes as a tick, with a
 * marigold dot inside the C. People wears it first; the other apps keep the
 * clor.in mark (ClorMark) until they move over.
 *
 * Indigo on light grounds (the theme's --logo-mark and --logo-word); `color` sets
 * the stroke and name for one particular ground. The dot stays marigold, except on a marigold ground,
 * where it would vanish: pass `dotColor` (cotton) there.
 *
 * `wordmark` sets CLOR beside it — always in capitals — close to the tick,
 * with its bottom on the bottom of the C (owner, 29 Oct 2026): one drawing,
 * so the two never drift apart at any size.
 */
export const INDIGO = '#232A66';
export const MARIGOLD = '#F5A623';
export const COTTON = '#FAF6EE';
export const TICK_PATH = 'M74.04 25.96 A34 34 0 1 0 50 84 L92 34';
/* The dot sits in the open bowl of the C, clear of both the curve and the tick. */
export const DOT = { cx: 46, cy: 50, r: 11 };
/* The lockup's drawing: the mark in 0..100, CLOR from x 106, its baseline on the C's lowest edge (y 90). */
const LOCKUP_WIDTH = 330;

/*
 * Unless a caller sets them, the paints follow the theme's logo tokens (--logo-mark, --logo-word, --logo-dot), so the
 * same drawing reads on a light ground and on People's indigo bar (2 Nov 2026). The fallbacks are the brand hexes.
 */
const MARK = 'rgb(var(--logo-mark, 35 42 102))';
const WORD = 'rgb(var(--logo-word, 35 42 102))';
const DOT_PAINT = 'rgb(var(--logo-dot, 245 166 35))';

export default function ClorTick({ size = 28, wordmark = false, color, dotColor, className = '', title = 'CLOR' }) {
  /* A small mark gets a heavier stroke and a slightly bigger dot so both still read at favicon size. */
  const small = size < 24;
  const mark = color || MARK;
  const word = color || WORD;
  const dot = dotColor || DOT_PAINT;
  const glyph = (
    <>
      <path d={TICK_PATH} fill="none" stroke={mark} strokeWidth={small ? 15 : 12} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={DOT.cx} cy={DOT.cy} r={small ? DOT.r + 1 : DOT.r} fill={dot} />
    </>
  );
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  if (!wordmark) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} {...a11y}>
        {glyph}
      </svg>
    );
  }
  return (
    <svg
      width={Math.round((size * LOCKUP_WIDTH) / 100)}
      height={size}
      viewBox={`0 0 ${LOCKUP_WIDTH} 100`}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, overflow: 'visible' }}
      {...a11y}
    >
      {glyph}
      <text x="106" y="90" fill={word} fontSize="80" fontWeight="800" letterSpacing="-1" style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque Variable'), 'Bricolage Grotesque Variable', 'Bricolage Grotesque', 'Inter Variable', ui-sans-serif, system-ui, sans-serif" }}>
        CLOR
      </text>
    </svg>
  );
}
