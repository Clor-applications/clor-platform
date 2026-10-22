import React, { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
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
        <p className="ui-caption">
          {t?.checkInTime ? `In ${t.checkInTime}` : `Shift ${me.shift?.startTime || ''}–${me.shift?.endTime || ''}`}
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
  const [me, load] = useMyDays();
  return (
    <div className="space-y-3 pb-8">
      <PageHeader entity="attendance" title="My Attendance" description="Check in and out, and your last month of days." />
      {me === undefined ? <SkeletonCard lines={5} /> : me === null ? (
        <p className="ui-card p-4 text-sm">Your sign-in is not linked to an employee file, so there is nothing to check in to. Ask HR to link it.</p>
      ) : (
        <>
          <CheckInCard me={me} onChanged={load} />
          <div className="ui-card ui-table-scroll">
            <table className="ui-table w-full">
              <thead><tr><th scope="col">Date</th><th scope="col">Day</th><th scope="col">In</th><th scope="col">Out</th></tr></thead>
              <tbody className="ui-rows">
                {(me.records || []).map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-meta">{r.date}</td>
                    <td><span className={`ui-pill ${DAY_PILL[r.status] || ''}`}>{DAY_LABEL[r.status] || r.status}</span></td>
                    <td className="ui-col-meta">{r.checkInTime || '—'}</td>
                    <td className="ui-col-meta">{r.checkOutTime || '—'}</td>
                  </tr>
                ))}
                {!me.records?.length ? <tr><td colSpan={4} className="ui-caption p-4">No days yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
