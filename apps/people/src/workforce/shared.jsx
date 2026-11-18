import React from 'react';
import { todayIst } from '@ui/utils/dates';

/* Employee statuses as the server stores them (ACTIVE, ON_NOTICE, SUSPENDED, LEFT); the UI adds "Joining" for a date still to come. */
export const STATUS = {
  ACTIVE: { label: 'Active', pill: 'ui-pill-pos' },
  ON_NOTICE: { label: 'On notice', pill: 'ui-pill-warn' },
  SUSPENDED: { label: 'Suspended', pill: 'ui-pill-neg' },
  LEFT: { label: 'Left', pill: 'ui-pill-neutral' },
};


/**
 * The status in words, never colour alone (WF-02 StatusPill): a soft tag with a
 * dot, green for Active (owner, 19 Nov 2026: no plain-text statuses), blue for
 * a joiner still to come. `quiet` is kept for callers and no longer changes it.
 */
// eslint-disable-next-line no-unused-vars
export function StatusBadge({ employee, quiet = false }) {
  /* Joining soon only stands in for Active: a suspended or departed joiner shows that instead. */
  const joining = employee?.status === 'ACTIVE' && employee?.dateOfJoining && String(employee.dateOfJoining).slice(0, 10) > todayIst();
  const s = joining ? { label: 'Joining soon', pill: 'ui-pill-info' } : STATUS[employee?.status] || { label: employee?.status || 'Unknown', pill: 'ui-pill-neutral' };
  return <span className={`ui-pill ${s.pill}`}>{s.label}</span>;
}

export { can } from '@ui/permissions/can';
