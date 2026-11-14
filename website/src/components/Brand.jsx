import React from 'react';
import { BookOpen } from 'lucide-react';
import { Briefcase, CalendarDots, Fingerprint, UsersThree, Wallet } from '@phosphor-icons/react';
import { Link } from '../router.jsx';

/** The CLOR logo, as the apps draw it (packages/ui ClorLogo): the open CL
 *  frame in graphite with the blaze orange bracket, then CLOR in the brand
 *  pack's own letters, the O carrying the same orange in its lower-left
 *  quarter (public/brand/clor-logo-b1.png, 800 x 163). On a dark header the
 *  ink turns soft white and the orange stays orange (-light).
 *  The file name carries a version suffix, not a date: the logo was redrawn
 *  several times under the same dated name and browsers kept serving the old
 *  picture, so bump b1 -> b2 whenever the artwork changes. */
/** The header's copy loads first; the footer's (lazy) waits until it is near. */
export function Logo({ height = 22, lazy = false, light = false }) {
  return (
    <Link href="/" className="logo" aria-label="CLOR home" translate="no">
      <img src={light ? '/brand/clor-logo-b1-light.png' : '/brand/clor-logo-b1.png'} alt="CLOR" height={height} width={Math.round((height * 800) / 163)} loading={lazy ? 'lazy' : undefined} fetchPriority={lazy ? undefined : 'high'} />
    </Link>
  );
}

/*
 * Product marks: the same icons the apps use for themselves, on a tile in the
 * product's own tint. People, Payroll, Attendance and the apps to come draw
 * People's two-tone Phosphor marks (owner, 9 Nov 2026: "use same icons which is
 * used in people everywhere except books"); Books keeps its Lucide book.
 */
const DUO = { people: UsersThree, payroll: Wallet, attendance: Fingerprint, projects: Briefcase, timesheet: CalendarDots };

export function Mark({ product, size = 36 }) {
  const Duo = DUO[product.slug];
  const iconSize = Math.round(size * 0.5);
  return (
    <span className="mark" data-p={product.slug} aria-hidden="true" style={{ '--mark': `${size}px`, '--mark-bg': `${product.accent}14`, '--mark-fg': product.accent, '--mark-line': `${product.accent}33` }}>
      {Duo ? <Duo size={iconSize} weight="duotone" /> : <BookOpen size={iconSize} strokeWidth={1.75} absoluteStrokeWidth />}
    </span>
  );
}

/** A product's name, kept whole on one line and out of the browser's page translation. */
export function ProductName({ name }) {
  return <span translate="no">CLOR&nbsp;{name}</span>;
}

export function Status({ product }) {
  return product.status === 'available' ? <span className="status">Available</span> : <span className="status status--soon">Coming soon</span>;
}
