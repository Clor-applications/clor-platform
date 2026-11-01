import React from 'react';

/* Employee statuses as the server stores them (ACTIVE, ON_NOTICE, SUSPENDED, LEFT); the UI adds "Joining" for a date still to come. */
export const STATUS = {
  ACTIVE: { label: 'Active', pill: 'ui-pill-pos' },
  ON_NOTICE: { label: 'On notice', pill: 'ui-pill-warn' },
  SUSPENDED: { label: 'Suspended', pill: 'ui-pill-neg' },
  LEFT: { label: 'Left', pill: 'ui-pill-neutral' },
};

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * The status in words, never colour alone (WF-02 StatusPill). `quiet`, in a
 * list where nearly everyone is Active: Active is plain grey words, so the
 * pills that remain are the people who need a look.
 */
export function StatusBadge({ employee, quiet = false }) {
  /* Joining soon only stands in for Active: a suspended or departed joiner shows that instead. */
  const joining = employee?.status === 'ACTIVE' && employee?.dateOfJoining && String(employee.dateOfJoining).slice(0, 10) > todayIst();
  const s = joining ? { label: 'Joining soon', pill: 'ui-pill-outline' } : STATUS[employee?.status] || { label: employee?.status || 'Unknown', pill: 'ui-pill-neutral' };
  if (quiet && !joining && employee?.status === 'ACTIVE') return <span className="ui-muted">{s.label}</span>;
  return <span className={`ui-pill ${s.pill}`}>{s.label}</span>;
}

export { can } from '@ui/permissions/can';
