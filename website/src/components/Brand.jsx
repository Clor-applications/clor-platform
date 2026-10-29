import React from 'react';
import { BookOpen, Briefcase, CalendarClock, Fingerprint, UserRound, Wallet } from 'lucide-react';
import { Link } from '../router.jsx';

/** The CLOR logo: C-tick mark and wordmark (public/brand/clor-logo.png, 752 x 188). */
export function Logo({ height = 22 }) {
  return (
    <Link href="/" className="logo" aria-label="CLOR home" translate="no">
      <img src="/brand/clor-logo.png" alt="CLOR" height={height} width={Math.round((height * 752) / 188)} />
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
