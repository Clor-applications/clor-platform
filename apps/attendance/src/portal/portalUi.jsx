import React from 'react';
import { LoadingRegion, SkeletonCard } from '@ui/components/ui/Primitives';
import ExceptionTag from '@ui/components/ui/ExceptionTag';

/**
 * While a part of the employee portal loads: the shared loading block (DESIGN.md "Loading"),
 * its words ("Loading your leave…") read out once to a screen reader.
 */
export const PortalLoading = ({ label, lines = 3 }) => (
  <LoadingRegion label={label}>
    <SkeletonCard lines={lines} />
  </LoadingRegion>
);

/**
 * A row's state in a portal list (DESIGN.md "Status tags": tags only on exceptions).
 * kind 'exception': waiting on someone, not approved, needs you: a tag, in the row's own pill colour.
 * kind 'normal': the expected state (approved, paid, done): no tag; a screen reader still hears it.
 * kind 'quiet': a settled state worth seeing but not flagging (cancelled, withdrawn): a plain word.
 */
export function RowState({ label, kind = 'normal', pill, tone }) {
  if (!label) return null;
  if (kind === 'exception') return <ExceptionTag label={label} pill={pill} tone={tone} />;
  if (kind === 'quiet') return <span className="ui-caption shrink-0">{label}</span>;
  return <ExceptionTag normal={label} />;
}

/** The kind for a pill class from a screen's own status map: warn and neg are exceptions, pos is expected, the rest quiet. */
export const kindOfPill = (pill = '') => (/ui-pill-(warn|neg)\b/.test(pill) ? 'exception' : /ui-pill-pos\b/.test(pill) ? 'normal' : 'quiet');

export default PortalLoading;
