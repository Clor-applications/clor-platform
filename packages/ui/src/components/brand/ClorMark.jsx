import React from 'react';

/**
 * The CLOR symbol from the brand kit (v1.0, "Slant"): two 20° blocks, ink over
 * orange. The ink block takes `currentColor`, so on a dark surface the mark is
 * the kit's reversed version (white + orange) without a second asset. The
 * orange is fixed — the guidelines allow no recolouring of the accent.
 */
export default function ClorMark({ size = 24, className = '', title = 'Clor' }) {
  const height = size;
  const width = Math.round((size * 165.74) / 160);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 165.74 160"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title || undefined}
      focusable="false"
      style={{ display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" d="M30.74 0 L165.74 0 L142.08 65 L7.08 65 Z" />
      <path fill="#FF6B00" d="M23.66 95 L158.66 95 L135 160 L0 160 Z" />
    </svg>
  );
}
