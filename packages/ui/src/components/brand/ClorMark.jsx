import React from 'react';

/* CLOR C-mark icon — ribbon arc + central nexus dot (locked vector, 6 Nov 2026).
   viewBox "10 0 60 60" matches favicon spec exactly. Do NOT use clorPaths.js C/DOT here —
   those are wordmark letter outlines, not the icon mark. */
export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' };
  const paint = color || 'rgb(var(--logo-mark-orange, 255 84 0))';
  return (
    <svg
      width={size}
      height={size}
      viewBox="10 0 60 60"
      fill="none"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      {...a11y}
    >
      <path
        d="M48 14C33.5 14 20 25 20 38C20 51 33.5 62 48 62C55.5 62 61 59 64 53.5L51.5 44C49.5 46 47 47.5 44 47.5C36 47.5 30.5 41.5 30.5 35C30.5 28.5 36 22.5 44 22.5C47 22.5 49.5 24 51.5 26L64 16.5C61 11 55.5 8 48 8"
        transform="translate(-4, -6)"
        fill={paint}
      />
      <circle cx="39" cy="30" r="5.5" fill={paint} />
    </svg>
  );
}
