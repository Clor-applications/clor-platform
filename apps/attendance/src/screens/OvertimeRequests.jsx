import React, { useCallback, useEffect, useState } from 'react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { decideOvertimeRequest, getOvertimeRules, listOvertimeRequests, saveOvertimeRules } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Overtime and comp-off asked for from the employee app, and the company's
 * rules for them. Approved overtime is marked approved on the day (and so is
 * paid); approved comp-off adds its days to the chosen leave type.
 */
const CHAINS = {
  HR: 'HR decides',
  MANAGER: 'The manager decides (HR can still step in)',
  MANAGER_THEN_HR: 'The manager, then HR',
};
const hours = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export default function OvertimeRequests() {
  const [status, setStatus] = useState('PENDING');
  const [data, setData] = useState(null);
  const [rules, setRules] = useState(null);
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});
  const load = useCallback(() => {
    listOvertimeRequests(status).then((d) => { setData(d); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load requests.')));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    getOvertimeRules().then((r) => { setRules(r.rules); setTypes(r.leaveTypes || []); }).catch(() => null);
  }, []);

  const decide = async (r, approve) => {
    try {
      await decideOvertimeRequest(r.id, approve, notes[r.id] || null);
      notify.success(approve ? (r.kind === 'COMP_OFF' ? `${r.days} comp-off day${r.days === 1 ? '' : 's'} added for ${r.employeeName}.` : `${r.employeeName}'s overtime on ${r.date} is approved.`) : `${r.employeeName}'s request was declined.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    }
  };
  const save = async (next) => {
    try {
      const r = await saveOvertimeRules(next);
      setRules(r.rules);
      notify.success('Rules saved.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Overtime & comp-off"
        description="Requests from the employee app, and who decides them."
        actions={
          <select className="ui-input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
            <option value="PENDING">Waiting</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Declined</option>
            <option value="CANCELLED">Withdrawn</option>
          </select>
        }
      />
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        <SkeletonCard />
      ) : data.requests.length === 0 ? (
        <EmptyState title={status === 'PENDING' ? 'Nothing waiting' : 'None'} description="Employees ask for overtime or comp-off from the app, from the days their extra work is recorded on." />
      ) : (
        <div className="ui-card overflow-x-auto">
          <table className="ui-table w-full">
            <thead>
              <tr><th>Employee</th><th>Day</th><th>Asks for</th><th>Reason</th><th>{status === 'PENDING' ? 'Decide' : 'Note'}</th></tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.employeeName}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</td>
                  <td>{r.date}</td>
                  <td>{r.kind === 'COMP_OFF' ? `Comp-off, ${r.days} day${r.days === 1 ? '' : 's'} (worked ${hours(r.minutes)})` : `Overtime ${hours(r.minutes)}`}</td>
                  <td className="max-w-xs">{r.reason}</td>
                  <td>
                    {status !== 'PENDING' ? (
                      r.reviewNote || '—'
                    ) : r.waitingOnManager ? (
                      <span className="ui-caption">With the manager first</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <input className="ui-input !w-40" placeholder="Note (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} aria-label="Note" />
                        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => decide(r, true)}>Approve</button>
                        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => decide(r, false)}>Decline</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rules ? (
        <div className="ui-card space-y-3 p-4">
          <h2 className="ui-h3">Rules</h2>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rules.overtimeRequests} onChange={(e) => save({ ...rules, overtimeRequests: e.target.checked })} />
            Employees can ask for their overtime to be approved
          </label>
          <label className="block">
            <span className="ui-label">Who decides overtime and comp-off</span>
            <select className="ui-input" value={rules.overtimeApproval} onChange={(e) => save({ ...rules, overtimeApproval: e.target.value })}>
              {Object.entries(CHAINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rules.compOffEnabled} disabled={!rules.compOffLeaveTypeId} onChange={(e) => save({ ...rules, compOffEnabled: e.target.checked })} />
            Give comp-off for work on a weekly off or holiday
          </label>
          <label className="block">
            <span className="ui-label">Comp-off days are added to</span>
            <select className="ui-input" value={rules.compOffLeaveTypeId || ''} onChange={(e) => save({ ...rules, compOffLeaveTypeId: e.target.value || null, compOffEnabled: e.target.value ? rules.compOffEnabled : false })}>
              <option value="">Choose a leave type</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span className="ui-caption">Use a leave type with no yearly days of its own (for example “Comp-off”), so its balance is only what was earned. A full day worked earns 1 day; a half day earns ½.</span>
          </label>
          <label className="block">
            <span className="ui-label">Employees confirm their month by this day of the next month</span>
            <input type="number" min={1} max={28} className="ui-input !w-24" value={rules.confirmCutoffDay} onChange={(e) => setRules({ ...rules, confirmCutoffDay: Number(e.target.value) })} onBlur={() => save(rules)} />
          </label>
        </div>
      ) : null}
    </div>
  );
}
