import React from 'react';

/* Employee statuses as the server stores them (ACTIVE, ON_NOTICE, SUSPENDED, LEFT); the UI adds "Joining" for a date still to come. */
export const STATUS = {
  ACTIVE: { label: 'Active', pill: 'ui-pill-pos' },
  ON_NOTICE: { label: 'On notice', pill: 'ui-pill-warn' },
  SUSPENDED: { label: 'Suspended', pill: 'ui-pill-neg' },
  LEFT: { label: 'Left', pill: 'ui-pill-neutral' },
};

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** The status in words, never colour alone (WF-02 StatusPill). */
export function StatusBadge({ employee }) {
  const joining = employee?.status !== 'LEFT' && employee?.dateOfJoining && String(employee.dateOfJoining).slice(0, 10) > todayIst();
  const s = joining ? { label: 'Joining soon', pill: 'ui-pill-info' } : STATUS[employee?.status] || { label: employee?.status || 'Unknown', pill: 'ui-pill-neutral' };
  return <span className={`ui-pill ${s.pill}`}>{s.label}</span>;
}

/** A grant the signed-in user holds (admins hold all). The server checks again; this only hides what would be refused. */
export const can = (perms, key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
