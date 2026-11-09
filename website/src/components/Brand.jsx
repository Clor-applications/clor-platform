import React from 'react';
import { BookOpen } from 'lucide-react';
import { Briefcase, Buildings, CalendarDots, Fingerprint, UsersThree, Wallet } from '@phosphor-icons/react';
import { Link } from '../router.jsx';

/** The CLOR logo, as the apps draw it (packages/ui ClorLogo): orange C-mark and O, slate L and R (public/brand/clor-logo.png, 434 x 147). */
/** The header's copy loads first; the footer's (lazy) waits until it is near. */
export function Logo({ height = 22, lazy = false }) {
  return (
    <Link href="/" className="logo" aria-label="CLOR home" translate="no">
      <img src="/brand/clor-logo.png" alt="CLOR" height={height} width={Math.round((height * 434) / 147)} loading={lazy ? 'lazy' : undefined} fetchPriority={lazy ? undefined : 'high'} />
    </Link>
  );
}

/*
 * Product marks: the same icons the apps use for themselves, on a tile in the
 * product's own tint. People, Payroll, Attendance and the apps to come draw
 * People's two-tone Phosphor marks (owner, 9 Nov 2026: "use same icons which is
 * used in people everywhere except books"); Books keeps its Lucide book.
 */
const DUO = { people: UsersThree, payroll: Wallet, attendance: Fingerprint, workspace: Buildings, projects: Briefcase, timesheet: CalendarDots };

export function Mark({ product, size = 36 }) {
  const Duo = DUO[product.slug];
  const iconSize = Math.round(size * 0.5);
  return (
    <span className="mark" aria-hidden="true" style={{ '--mark': `${size}px`, '--mark-bg': `${product.accent}14`, '--mark-fg': product.accent, '--mark-line': `${product.accent}33` }}>
      {Duo ? <Duo size={iconSize} weight="duotone" /> : <BookOpen size={iconSize} strokeWidth={1.75} absoluteStrokeWidth />}
    </span>
  );
}

export function Status({ product }) {
  return product.status === 'available' ? <span className="status">Available</span> : <span className="status status--soon">Coming soon</span>;
}
