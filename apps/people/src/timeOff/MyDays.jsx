import React, { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import { formatDate } from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { DAY_LABEL, DAY_PILL, clock, getMyDays } from './api';

/**
 * The basic check-in in HR (founder, 22 Oct 2026): one button for someone
 * with an employee file, writing the same day record a reader or the phone
 * would, so Attendance (if the company has it) counts it like any punch.
 */
function useMyDays() {
  const [me, setMe] = useState(undefined);
  const load = useCallback(() => {
    getMyDays().then(setMe).catch(() => setMe(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  return [me, load];
}

export function CheckInCard({ me, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const t = me.todayRecord;
  const press = async () => {
    setBusy(true);
    try {
      await clock(me.clockedIn ? 'OUT' : 'IN');
      notify.success(me.clockedIn ? 'Checked out.' : 'Checked in.');
      onChanged();
    } catch (e) {
      notify.error(String(e?.message || 'Not recorded.'));
    } finally {
      setBusy(false);
    }
  };
  const closed = t?.checkIn && t?.checkOut && !me.clockedIn;
  return (
    <section className="ui-card p-4 flex flex-wrap items-center justify-between gap-3" aria-label="Check in">
      <div>
        <h2 className="ui-t-sec">{me.clockedIn ? 'You are checked in' : closed ? 'Done for today' : 'Not checked in today'}</h2>
        <p className="ui-caption tabular-nums">
          {t?.checkInTime ? `In ${t.checkInTime}` : me.shift?.startTime ? `Shift ${me.shift.startTime}–${me.shift.endTime || ''}` : ''}
          {t?.checkOutTime ? `, out ${t.checkOutTime}` : ''}
        </p>
      </div>
      {closed ? null : (
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={press}>
          {me.clockedIn ? <LogOut size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />} {me.clockedIn ? 'Check out' : 'Check in'}
        </button>
      )}
    </section>
  );
}

/** On People → Home: the check-in, when the person signed in has an employee file. */
export function HomeCheckIn() {
  const [me, load] = useMyDays();
  return me ? <CheckInCard me={me} onChanged={load} /> : null;
}

export default function MyDays() {
  const req = useRequest(() => getMyDays(), []);
  const me = req.data;
  /* No employee file behind this sign-in is a fact about the person, not a failure to retry. */
  const unlinked = req.error?.code === 'NO_EMPLOYEE_LINK' || req.error?.status === 404;
  const columns = [
    { key: 'date', label: 'Date', always: true, render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.date)}</span> },
    { key: 'status', label: 'Day', render: (r) => <span className={`ui-pill ${DAY_PILL[r.status] || 'ui-pill-neutral'}`}>{DAY_LABEL[r.status] || r.status}</span> },
    { key: 'in', label: 'In', align: 'right', render: (r) => <span className="tabular-nums">{r.checkInTime || '—'}</span> },
    { key: 'out', label: 'Out', align: 'right', render: (r) => <span className="tabular-nums">{r.checkOutTime || '—'}</span> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Time & Leave' }]} title="My days" />
      {unlinked ? (
        <EmptyState title="Your sign-in is not linked to an employee file" description="Ask HR to put your email on your employee file." />
      ) : req.error && !me ? (
        <ErrorState error={req.error} onRetry={req.reload} />
      ) : !me ? (
        <SkeletonCard lines={5} />
      ) : (
        <>
          <CheckInCard me={me} onChanged={req.reload} />
          <DataTable
            label="My days"
            columns={columns}
            rows={me.records || []}
            total={(me.records || []).length}
            noun="days"
            refreshing={req.refreshing}
            empty={<EmptyState title="No days in the last month" />}
          />
        </>
      )}
    </div>
  );
}
