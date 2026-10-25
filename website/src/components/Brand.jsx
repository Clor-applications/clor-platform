import React from 'react';
import { BookOpen, Briefcase, CalendarClock, Fingerprint, UserRound, Wallet } from 'lucide-react';
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
 * Product marks: the same icons the apps use for themselves (lucide, as in each
 * app's manifest), on a tile in the product's own tint — one family, and each
 * accent stays on its own product.
 */
const ICONS = { books: BookOpen, people: UserRound, payroll: Wallet, attendance: Fingerprint, projects: Briefcase, timesheet: CalendarClock };

export function Mark({ product, size = 36 }) {
  const Icon = ICONS[product.slug];
  return (
    <span className="mark" aria-hidden="true" style={{ '--mark': `${size}px`, '--mark-bg': `${product.accent}14`, '--mark-fg': product.accent, '--mark-line': `${product.accent}33` }}>
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} absoluteStrokeWidth />
    </span>
  );
}

export function Status({ product }) {
  return product.status === 'available' ? <span className="status">Available</span> : <span className="status status--soon">Coming soon</span>;
}
