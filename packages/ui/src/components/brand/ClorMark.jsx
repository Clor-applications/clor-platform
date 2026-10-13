import React, { useId } from 'react';

/**
 * The Clor mark: a C drawn as a folded ribbon.
 *
 * The colour travels round the arc — blue where it begins at the top, through
 * teal down the left, into violet and magenta at the foot, out to amber at the
 * lower tip. Both ends are rounded, so the letter reads as a ribbon rather than
 * a stroke that stopped.
 *
 * Two things about how it is built, both so it survives being small — it is
 * drawn at 18px in a header far more often than at 160px on a page.
 *
 * **One shape, two gradients laid over it.** An SVG linear gradient runs in a
 * straight line, and this colour has to go round a corner. Rather than split
 * the letter into two paths, which leaves a visible seam where they meet, the
 * C is a clip and the colour is two full-bleed rectangles inside it: the first
 * carries blue to teal, the second fades in from transparent at the teal and
 * carries on to amber. The blend happens in the alpha, so there is no join to
 * see.
 *
 * **Gradient ids are per instance.** Two marks on one page sharing an id would
 * have the second silently adopt the first's gradient — the kind of bug that
 * only appears once a header and a footer both use the logo.
 */

/*
 * R 78 outer, r 36 inner, ends capped with a 21 radius — half the ribbon's
 * width, which is what makes a cap read as round rather than as a bulge. The
 * gap faces right, between -52° and +52°.
 */
const RING =
  'M148 38.5 A78 78 0 1 0 148 161.5 A21 21 0 0 0 122.1 128.1 A36 36 0 1 1 122.1 71.9 A21 21 0 0 0 148 38.5 Z';

export default function ClorMark({ size = 24, className = '', title = '' }) {
  const raw = useId().replace(/:/g, '');
  const clip = `clor-clip-${raw}`;
  const arc = `clor-arc-${raw}`;
  const foot = `clor-foot-${raw}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title || undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}

      <defs>
        <clipPath id={clip}>
          <path d={RING} />
        </clipPath>

        {/* Top tip, over the crown, down to the left edge. */}
        <linearGradient id={arc} x1="150" y1="30" x2="30" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1668F0" />
          <stop offset="0.35" stopColor="#2B8CF7" />
          <stop offset="0.72" stopColor="#33C6CB" />
          <stop offset="1" stopColor="#41DCBA" />
        </linearGradient>

        {/* The foot, fading in from nothing so the two never meet at an edge. */}
        <linearGradient id={foot} x1="40" y1="78" x2="150" y2="170" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#41DCBA" stopOpacity="0" />
          <stop offset="0.18" stopColor="#4E63E2" stopOpacity="0.75" />
          <stop offset="0.42" stopColor="#8B3FDB" />
          <stop offset="0.64" stopColor="#C8419B" />
          <stop offset="0.85" stopColor="#F26A28" />
          <stop offset="1" stopColor="#FCAC17" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${clip})`}>
        <rect width="200" height="200" fill={`url(#${arc})`} />
        <rect width="200" height="200" fill={`url(#${foot})`} />
      </g>
    </svg>
  );
}
