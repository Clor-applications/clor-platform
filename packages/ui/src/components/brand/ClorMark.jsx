import React from 'react';

/**
 * The Clor mark: the "C" with its orange dot, the same file clor.in uses
 * (public/brand/clor-mark.png). One mark across the site and every app.
 *
 * `color` is accepted for older callers and ignored: the mark has its own
 * colours, and the app is light-only.
 */
// eslint-disable-next-line no-unused-vars
export default function ClorMark({ size = 28, color, className = '', title = 'Clor' }) {
  return (
    <img
      src="/brand/clor-mark.png"
      width={size}
      height={size}
      alt={title || ''}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      draggable={false}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, objectFit: 'contain' }}
    />
  );
}
