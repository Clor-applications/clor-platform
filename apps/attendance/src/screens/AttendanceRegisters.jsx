import React from 'react';
import { FileText } from 'lucide-react';

import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { NotConnected } from '@ui/components/ui/NotConnected';

/** Statutory registers and the month's payroll input from attendance. */
export default function AttendanceRegisters() {
  return (
    <div className="space-y-6">
      <PageHeader title="Registers & payroll input" description="Muster roll, overtime and leave registers, and the payable days that feed Payroll." />
      <NotConnected what="Attendance">
        Registers are produced by the company's attendance instance from its
        punches. When Payroll and Attendance share one login, the month's payable
        days, loss of pay and overtime flow straight into a pay run.
      </NotConnected>
      <EmptyState
        icon={FileText}
        title="Registers appear once attendance is connected"
        description="The muster roll, overtime register and leave register for any period will be available here, matching the figures Payroll uses."
      />
    </div>
  );
}
