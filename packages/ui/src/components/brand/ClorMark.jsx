import React from 'react';
import ClorTick from './ClorTick.jsx';

/**
 * The CLOR mark: one stroke, never lifted. It runs round the C and finishes
 * as a tick — the tick being the product's done state, so the mark and the
 * "Filed / Paid / Approved" chips are the same idea — with the marigold dot
 * inside the C.
 *
 * Every app draws ClorTick's mark now (owner, 3 Nov 2026: Payroll, Attendance
 * and the sign-in page still showed the mark without its dot). It follows the
 * theme's --logo-mark / --logo-dot; public/brand/clor-mark.svg matches it.
 *
 * `color` overrides the theme colour for the rare surface that needs it.
 */
export default function ClorMark({ size = 28, color, className = '', title = 'CLOR' }) {
  return <ClorTick size={size} color={color} className={className} title={title} />;
}
