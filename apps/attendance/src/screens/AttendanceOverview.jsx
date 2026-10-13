import React from 'react';
import { ArrowUpRight, Activity } from 'lucide-react';

import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { NotConnected } from '@ui/components/ui/NotConnected';
import { configured, instanceUrl } from '../api/attendanceApi';

/**
 * Where attendance stands today — once the company's attendance instance is
 * connected. The shape is here so the integration (single sign-on, then
 * per-company routing) has a page to land in; it does not pretend to have data
 * it cannot yet reach.
 */
export default function AttendanceOverview() {
  const url = instanceUrl();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Live attendance, registers and the month's payroll input, from your biometric readers."
        actions={url ? (
          <a className="ui-btn ui-btn-primary" href={url} target="_blank" rel="noreferrer">
            Open attendance <ArrowUpRight size={16} />
          </a>
        ) : null}
      />
      <NotConnected what="Attendance">
        Attendance runs on its own Clor instance for each company, with its own
        database and your biometric readers. Connecting it to this company needs
        single sign-on, which is the next step on the platform plan. Until then,
        open the attendance instance directly.
      </NotConnected>
      {!configured() && (
        <EmptyState
          icon={Activity}
          title="No attendance instance for this company yet"
          description="Once your company's attendance instance is set up, today's presence, late arrivals and offline readers appear here, and the month's payable days flow into Payroll."
        />
      )}
    </div>
  );
}
