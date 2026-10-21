import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, Clock, Settings2, Timer, UserRound, X } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
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

const TABS = [
  { value: 'PENDING', label: 'Waiting', tone: 'partial' },
  { value: 'APPROVED', label: 'Approved', tone: 'paid' },
  { value: 'REJECTED', label: 'Declined', tone: 'overdue' },
  { value: 'CANCELLED', label: 'Withdrawn', tone: 'cancelled' },
];
const COLUMNS = {
  employee: (r) => r.employeeName,
  date: (r) => r.date,
  kind: (r) => (r.kind === 'COMP_OFF' ? 'Comp-off' : 'Overtime'),
  reason: (r) => r.reason,
};

export default function OvertimeRequests() {
  const [status, setStatus] = useState('PENDING');
  const [byStatus, setByStatus] = useState(null);
  const [rules, setRules] = useState(null);
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});
  const [showRules, setShowRules] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  /* The server answers one status at a time; the tabs count all four, so all four are asked for together. */
  const load = useCallback(() => {
    Promise.all(TABS.map((t) => listOvertimeRequests(t.value)))
      .then((list) => { setByStatus(Object.fromEntries(TABS.map((t, i) => [t.value, list[i]?.requests || []]))); setError(''); })
      .catch((e) => setError(String(e?.message || 'Could not load requests.')));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    getOvertimeRules().then((r) => { setRules(r.rules); setTypes(r.leaveTypes || []); }).catch(() => null);
  }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, byStatus?.[t.value]?.length || 0])), [byStatus]);
  const inTab = useMemo(() => byStatus?.[status] || [], [byStatus, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'date', 'reason']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useResetPage(setPage, [status, search.query]);
  const figures = useMemo(() => {
    const waiting = byStatus?.PENDING || [];
    return {
      withManager: waiting.filter((r) => r.waitingOnManager).length,
      overtimeMinutes: waiting.filter((r) => r.kind !== 'COMP_OFF').reduce((a, r) => a + Number(r.minutes || 0), 0),
      compOffDays: waiting.filter((r) => r.kind === 'COMP_OFF').reduce((a, r) => a + Number(r.days || 0), 0),
    };
  }, [byStatus]);

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
    <DocumentListShell
      entity="overtime"
      title="Overtime & comp-off"
      description="Requests from the employee app, and who decides them."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search requests…', label: 'Search overtime and comp-off requests' }}
      moreItems={rules ? [{ key: 'rules', label: 'Rules', Icon: Settings2 }] : null}
      onMoreSelect={(k) => { if (k === 'rules') setShowRules(true); }}
      cards={[
        { label: 'Waiting', value: counts.PENDING, count: true, tone: 'partial', Icon: Clock, onSelect: () => setStatus('PENDING') },
        { label: 'With the manager', value: figures.withManager, count: true, tone: 'sent', Icon: UserRound },
        { label: 'Overtime waiting', value: hours(figures.overtimeMinutes), count: true, tone: 'outstanding', Icon: Timer },
        { label: 'Comp-off days', value: figures.compOffDays, count: true, tone: 'draft', Icon: CalendarPlus },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Request status"
    >
      <LoadFailed message={error} onRetry={load} />
      {!byStatus ? (
        error ? null : <SkeletonCard lines={5} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="employee" state={filters} />
                  <ColumnHeader label="Day" col="date" state={filters} type="date" />
                  <ColumnHeader label="Asks for" col="kind" state={filters} />
                  <ColumnHeader label="Reason" col="reason" state={filters}  className="ui-col-grow" />
                  <th scope="col">{status === 'PENDING' ? <span className="sr-only">Decide</span> : 'Note'}</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={5}>
                      {inTab.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length} title="No requests match" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={Timer}
                          title={status === 'PENDING' ? 'Nothing waiting' : 'None'}
                          description="Employees ask for overtime or comp-off from the app, from the days their extra work is recorded on. Approved overtime is paid; approved comp-off adds its days to the chosen leave type."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="ui-col-entity">{r.employeeName}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</td>
                      <td className="ui-col-date whitespace-nowrap">{r.date}</td>
                      <td>{r.kind === 'COMP_OFF' ? `Comp-off, ${r.days} day${r.days === 1 ? '' : 's'} (worked ${hours(r.minutes)})` : `Overtime ${hours(r.minutes)}`}</td>
                      <td className="ui-col-grow whitespace-normal min-w-[10rem]">{r.reason}</td>
                      <td className="ui-col-meta">
                        {status !== 'PENDING' ? (
                          r.reviewNote || '—'
                        ) : r.waitingOnManager ? (
                          <span className="ui-caption">With the manager first</span>
                        ) : (
                          <span className="flex items-center justify-end gap-1">
                            <input className="ui-input ui-ctl-compact !w-40" placeholder="Note (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} aria-label="Note" />
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => decide(r, true)}><Check size={14} aria-hidden="true" /> Approve</button>
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => decide(r, false)}><X size={14} aria-hidden="true" /> Decline</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="requests" />
        </>
      )}

      {rules ? (
        <Drawer
          open={showRules}
          onClose={() => setShowRules(false)}
          title="Rules"
          description="Who decides overtime and comp-off. Each change saves as you make it."
          widthClass="w-[min(36rem,96vw)]"
          actions={<button type="button" className="ui-btn ui-btn-secondary" onClick={() => setShowRules(false)}>Done</button>}
        >
          <div className="space-y-3">
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
        </Drawer>
      ) : null}
    </DocumentListShell>
  );
}
