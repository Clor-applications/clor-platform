import React from 'react';

/**
 * CLOR C-mark icon (6 Nov 2026): filled donut-arc ring, NOT the font-traced letter C.
 * Outer r=42, inner r=17, gap ±37° from right horizontal (74° total).
 * Tips are naturally pointed from the radial connection lines.
 * White center dot is visible on dark grounds; blends on white.
 */
export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const paint = color || 'rgb(var(--logo-mark-orange, 255 84 0))';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      {/*
        C ring compound path:
        - Outer arc (r=42) counterclockwise from (83.5,24.7) to (83.5,75.3) — large arc
        - Straight line to inner arc end (63.6,60.2)
        - Inner arc (r=17) clockwise from (63.6,60.2) to (63.6,39.8) — large arc
        - Close Z (straight line back to outer start)
        cos37°=0.7986, sin37°=0.6018
      */}
      <path
        d="M 83.5 24.7 A 42 42 0 1 0 83.5 75.3 L 63.6 60.2 A 17 17 0 1 1 63.6 39.8 Z"
        fill={paint}
      />
      <circle cx="50" cy="50" r="5" fill="white" fillOpacity="0.9" />
    </svg>
  );
}
