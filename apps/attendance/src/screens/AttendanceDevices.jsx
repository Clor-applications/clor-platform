import React from 'react';
import { Cpu } from 'lucide-react';

import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { NotConnected } from '@ui/components/ui/NotConnected';

/** The biometric readers reporting to this company's attendance instance. */
export default function AttendanceDevices() {
  return (
    <div className="space-y-6">
      <PageHeader title="Readers" description="The biometric readers reporting punches to this company." />
      <NotConnected what="Attendance">
        The readers, their last heartbeat and approval state live on the company's
        attendance instance. They appear here once single sign-on connects it.
      </NotConnected>
      <EmptyState
        icon={Cpu}
        title="No readers connected"
        description="ZKTeco and eSSL readers push their punches to the attendance instance over the network. Approved readers and their status will list here."
      />
    </div>
  );
}
