import React from 'react';

/**
 * CLOR C-mark icon (6 Nov 2026): custom orange arc, NOT the font-traced letter C.
 * Thick rounded stroke, opens right. Favicon, app-icon, browser tab, phone bar.
 * Pass `color` to override the orange for a specific ground.
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
      {/* Arc from top-right to bottom-right, long way round (the C shape opens right) */}
      <path
        d="M 73 17 A 40 40 0 1 0 73 83"
        fill="none"
        stroke={paint}
        strokeWidth="22"
        strokeLinecap="round"
      />
    </svg>
  );
}
