import React from 'react';

/**
 * The Clor mark — the brand swirl icon (public/brand/clor-icon.svg), the same
 * artwork used on the attendance app and the marketing site. Rendered as an
 * <img> so the one file keeps every surface in sync; replaces the earlier
 * hand-drawn ribbon "C" so the platform matches the rest of the brand.
 */
export default function ClorMark({ size = 24, className = '', title = 'Clor' }) {
  return (
    <img
      src="/brand/clor-icon.svg"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ height: 'auto', display: 'block' }}
    />
  );
}
