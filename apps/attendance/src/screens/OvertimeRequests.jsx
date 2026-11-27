import { useReviewSelection, SelectionBar } from '@ui/components/ui/ReviewTable';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings2, Timer } from '@ui/components/ui/lineIcons';
import { RequestQueue, RequestDetails, DecisionButtons, duration as hours } from '../components/OvertimeReview';
import './overtime-review.css';

import { useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import { FilterTabs } from '@ui/components/list/ListHeader';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { overCapQuestion } from '@ui/picks/round28';
import { decideOvertimeRequest, getOvertimeRules, listOvertimeRequests, saveOvertimeRules } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import OvertimeRuleFields from '../components/OvertimeRuleFields';
import { errorWords, dayText } from '@ui/utils/errorWords';

/**
 * Overtime and comp-off asked for from the employee app, and the company's
 * rules for them. Approved overtime is marked approved on the day (and so is
 * paid); approved comp-off adds its days to the chosen leave type.
 */
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
  { key: 'rate', label: 'Rate', value: (r) => (r.rate ? `${r.rate}×` : '') },
  { key: 'overCap', label: 'Over the cap', value: (r) => (r.overCapMinutes ? hours(r.overCapMinutes) : '') },
  { key: 'days', label: 'Comp-off days', value: (r) => (r.kind === 'COMP_OFF' ? r.days : '') },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
];
export default function OvertimeRequests({ peopleTimePage = false, params, updateParams } = {}) {
  const [localStatus, setLocalStatus] = useState('PENDING');
  const status = updateParams ? TABS.find(tab => tab.value === params?.status)?.value || 'PENDING' : localStatus;
  const [byStatus, setByStatus] = useState(null);
  const [rules, setRules] = useState(null);
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});
  const [showRules, setShowRules] = useState(false);
  const [localId, setLocalId] = useState(null);
  const activeId = updateParams ? params?.drawer : localId;
  const setActiveId = (id) => {
    if (updateParams) updateParams({ drawer: id }, { push: Boolean(id && !activeId) });
    else setLocalId(id);
  };
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1050px)').matches);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1050px)');
    const resize = () => setNarrow(media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  /* The server answers one status at a time; the tabs count all four, so all four are asked for together. */
  const load = useCallback(() => {
    const version = ++loadVersion.current;
    return Promise.all(TABS.map((t) => listOvertimeRequests(t.value)))
      .then((list) => { if (version !== loadVersion.current) return; setByStatus(Object.fromEntries(TABS.map((t, i) => [t.value, list[i]?.requests || []]))); setError(''); })
      .catch((e) => { if (version === loadVersion.current) setError(errorWords(e, 'load requests')); });
  }, []);
  useEffect(() => { load(); return () => { loadVersion.current++; }; }, [load]);
  useEffect(() => {
    getOvertimeRules().then((r) => { setRules(r.rules); setTypes(r.leaveTypes || []); }).catch(() => null);
  }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, byStatus?.[t.value]?.length || 0])), [byStatus]);
  const inTab = useMemo(() => byStatus?.[status] || [], [byStatus, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'date', 'reason']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  const selection = useReviewSelection(pageRows);
  const visibleRows = peopleTimePage && selection.focused ? selection.selectedRows : pageRows;
  useResetPage(setPage, [status, search.query]);
  const figures = useMemo(() => {
    const waiting = byStatus?.PENDING || [];
    return {
      overtimeMinutes: waiting.filter((r) => r.kind !== 'COMP_OFF').reduce((a, r) => a + Number(r.minutes || 0), 0),
      compOffDays: waiting.filter((r) => r.kind === 'COMP_OFF').reduce((a, r) => a + Number(r.days || 0), 0),
    };
  }, [byStatus]);

  const decide = async (r, approve) => {
    /* Round 28 "otlimit" B: past the cap, ask at the moment of approving. */
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const ask = approve ? overCapQuestion(r) : null;
      if (ask && !(await confirmDialog(ask))) return;
      await decideOvertimeRequest(r.id, approve, notes[r.id] || null);
      notify.success(approve ? (r.kind === 'COMP_OFF' ? `${r.days} comp-off day${r.days === 1 ? '' : 's'} added for ${r.employeeName}.` : `${r.employeeName}'s overtime on ${dayText(r.date, { year: false })} is approved.`) : `${r.employeeName}'s request was declined.`);
      setByStatus(prev => ({ ...prev, PENDING: prev.PENDING.filter(row => row.id !== r.id) }));
      setActiveId(null);
      setNotes(prev => { const next = { ...prev }; delete next[r.id]; return next; });
      await load();
    } catch (e) {
      notify.error(errorWords(e, 'do that'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const save = async (next) => {
    try {
      const r = await saveOvertimeRules(next);
      setRules(r.rules);
      notify.success('Rules saved.');
    } catch (e) {
      notify.error(errorWords(e, 'save the changes'));
    }
  };

  const active = visibleRows.find(r => String(r.id) === String(activeId)) || (!narrow ? visibleRows[0] : null);
  const inspect = (row) => setActiveId(row.id);
  const switchTab = (value) => {
    if (updateParams) updateParams({ status: value === 'PENDING' ? null : value, drawer: null });
    else { setLocalStatus(value); setLocalId(null); }
  };
  const exportRequests = (format, records) => runListExport({ format, title: 'Overtime & comp-off', fileName: 'Overtime and comp-off', label: 'request/requests', columns: EXPORT_COLUMNS, rows: records });
  const details = active && <RequestDetails request={active} status={status} note={notes[active.id] || ''} busy={busy}
    onNote={value => setNotes(prev => ({ ...prev, [active.id]: value }))} />;
  const actions = active && status === 'PENDING' && !active.waitingOnManager
    ? <DecisionButtons request={active} busy={busy} decide={decide} /> : null;
  const summary = status === 'PENDING' && [
    figures.overtimeMinutes > 0 && `${hours(figures.overtimeMinutes)} overtime`,
    figures.compOffDays > 0 && `${figures.compOffDays} comp-off ${figures.compOffDays === 1 ? 'day' : 'days'}`,
  ].filter(Boolean).join(' · ');
  const statusTabs = <FilterTabs appearance="underline" label="Request status"
          tabs={TABS.map(({ value, label }) => ({ key: value, label, count: counts[value] }))} value={status} onChange={switchTab} />;
  return (
    <DocumentListShell
      timeRegister={peopleTimePage}
      entity="overtime" className="ot-register" surface="plain"
      title="Overtime & comp-off"
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search requests…', label: 'Search overtime and comp-off requests' }}
      moreItems={[exportMenuItem('Export'), ...(rules ? [{ key: 'rules', label: 'Rules', Icon: Settings2 }] : [])]}
      onMoreSelect={(k) => {
        if (k === 'rules') return setShowRules(true);
        const format = exportFormatFromKey(k);
        if (format) exportRequests(format, rows);
      }}
      countLine={peopleTimePage && summary ? <span className="ot-summary">{summary} pending</span> : null}
      registerViews={peopleTimePage && statusTabs}
      above={!peopleTimePage && <div className="ot-toolbar">{statusTabs}{summary && <span className="ot-summary">{summary} pending</span>}</div>}
    >
      <LoadFailed message={error} onRetry={load} />
      {peopleTimePage && <SelectionBar selection={selection} onExport={records => exportRequests('csv', records)} />}
      {!byStatus ? (error ? null : <SkeletonCard lines={5} />) : <>
        <div className={`ot-workbench${active && !narrow ? ' has-detail' : ''}`}>
          <div className="ot-records">
            {(visibleRows.length > 0 || filters.hasActiveFilters) && <RequestQueue rows={visibleRows} active={active}
              inspect={inspect} filters={filters} selection={selection} selectable={peopleTimePage} narrow={narrow} />}
            {!rows.length && <EmptyState icon={Timer}
              title={inTab.length ? 'No matching requests' : { PENDING: 'No requests waiting', APPROVED: 'No approved requests', REJECTED: 'No declined requests', CANCELLED: 'No withdrawn requests' }[status]}
              kind={inTab.length ? 'filtered' : 'new'} totalCount={inTab.length}
              onClearFilters={() => { search.setQuery(''); filters.clearAll(); }} />}
            {!selection.focused && pageCount > 1 && <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={n => { setPerPage(n); setPage(1); }} noun="requests" />}
          </div>
          {!narrow && active && <aside aria-label="Request details" className="ot-inspector"><h2>Request details</h2>{details}{actions}</aside>}
        </div>
        {narrow && active && <Drawer open title="Request details" onClose={() => setActiveId(null)} busy={busy} footer={actions}>{details}</Drawer>}
      </>}
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
