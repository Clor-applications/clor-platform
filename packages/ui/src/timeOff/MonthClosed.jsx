import React from 'react';

import { usePermissions } from '@ui/permissions/usePermissions';

import { can } from './shared';

/** Reopening a month is Month close's own right (POST /attendance/months/:month/reopen). */
export const REOPEN_RIGHT = 'ATTENDANCE::Attendance Records::APPROVE';
export const MONTH_CLOSED = 'ATTENDANCE_MONTH_CLOSED';

/**
 * A refusal because the dates are in a closed Attendance month (closure audit
 * O-09): the server's words, and for someone who may reopen months, the way
 * to Attendance → Month close. Everyone else is told by the words to ask HR.
 */
export function MonthClosedNote({ message, month }) {
  const perms = usePermissions();
  const reopen = can(perms, REOPEN_RIGHT);
  return (
    <p className="text-sm ui-text-neg" role="alert">
      {message}
      {reopen ? <> <a className="ui-link" href={`?app=attendance&open=monthClose${month ? `&month=${encodeURIComponent(month)}` : ''}`}>Open Month close</a></> : null}
    </p>
  );
}
