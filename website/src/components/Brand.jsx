import React from 'react';
import { Link } from '../router.jsx';

/** The approved wordmark (placeholder file until the final logo arrives: public/brand/clor-logo.png). */
export function Logo({ height = 22 }) {
  return (
    <Link href="/" className="logo" aria-label="Clor home" translate="no">
      <img src="/brand/clor-logo.png" alt="Clor" height={height} width={Math.round(height * 3.56)} />
    </Link>
  );
}

/*
 * Product marks: one geometric family — a rounded square in the product's own
 * tint carrying a two-stroke glyph — so the set reads as one company, and the
 * accents stay on their own products.
 */
const GLYPHS = {
  books: (
    <>
      <path d="M5 5.5h6.5a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2H5z" />
      <path d="M19 5.5h-2.5" />
      <path d="M14 8a2.5 2.5 0 0 1 2.5-2.5H19v11.5h-5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 6a3 3 0 0 1 0 5.5" />
      <path d="M17.5 14.2a5.5 5.5 0 0 1 3 4.8" />
    </>
  ),
  payroll: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6.5 9.5v5M17.5 9.5v5" />
    </>
  ),
  attendance: (
    <>
      <circle cx="12" cy="12.5" r="7.5" />
      <path d="M12 8.5v4.2l2.8 1.8" />
      <path d="M9.5 3.5h5" />
    </>
  ),
  projects: (
    <>
      <path d="M4 7h7M4 12h11M4 17h5" />
      <circle cx="18" cy="7" r="1.6" />
      <circle cx="13" cy="17" r="1.6" />
    </>
  ),
  timesheet: (
    <>
      <rect x="4" y="4.5" width="16" height="16" rx="2" />
      <path d="M4 9h16M9 3v3M15 3v3" />
      <path d="M8 13h3M8 16.5h6" />
    </>
  ),
};

export function Mark({ product, size = 36 }) {
  const glyph = GLYPHS[product.slug];
  return (
    <span
      className="mark"
      aria-hidden="true"
      style={{ '--mark': `${size}px`, '--mark-bg': `${product.accent}1A`, '--mark-fg': product.accent }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {glyph}
      </svg>
    </span>
  );
}

export function Status({ product }) {
  return product.status === 'available' ? <span className="status">Available</span> : <span className="status status--soon">Coming soon</span>;
}
