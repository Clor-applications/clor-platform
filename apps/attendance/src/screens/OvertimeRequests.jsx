import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, Clock, Settings2, Timer, UserRound, X } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { decideOvertimeRequest, getOvertimeRules, listOvertimeRequests, saveOvertimeRules } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import OvertimeRuleFields from '../components/OvertimeRuleFields';

/**
 * Overtime and comp-off asked for from the employee app, and the company's
 * rules for them. Approved overtime is marked approved on the day (and so is
 * paid); approved comp-off adds its days to the chosen leave type.
 */
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


/* What Export writes: the rows on screen, as shown (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'employeeCode', label: 'Employee ID' },
  { key: 'employeeName', label: 'Employee' },
  { key: 'date', label: 'Day' },
  { key: 'kind', label: 'Asks for', value: (r) => (r.kind === 'COMP_OFF' ? 'Comp-off' : 'Overtime') },
  { key: 'minutes', label: 'Worked over', value: (r) => hours(r.minutes || 0) },
  { key: 'days', label: 'Comp-off days', value: (r) => (r.kind === 'COMP_OFF' ? r.days : '') },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
];
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
      moreItems={[exportMenuItem('Export'), ...(rules ? [{ key: 'rules', label: 'Rules', Icon: Settings2 }] : [])]}
      onMoreSelect={(k) => {
        if (k === 'rules') return setShowRules(true);
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Overtime & comp-off', fileName: 'Overtime and comp-off', label: 'request/requests', columns: EXPORT_COLUMNS, rows: rows });
      }}
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
            <OvertimeRuleFields rules={rules} types={types} save={save} />
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
