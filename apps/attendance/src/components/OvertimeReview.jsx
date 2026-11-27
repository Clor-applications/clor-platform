import TimeRegisterTable from '@ui/components/list/TimeRegisterTable';
import React, { useRef } from 'react';
import { ArrowRight, Check, SlidersHorizontal } from 'lucide-react';
import { ColumnHeader } from '@ui/components/ColumnFilters';
import { PageCheckbox, RowCheckbox } from '@ui/components/ui/ReviewTable';
import { dateWords } from '@ui/utils/dates';

export const duration = (minutes) => {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '—';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
const requestType = (r) => r.kind === 'COMP_OFF' ? 'Comp-off' : 'Overtime';
const requested = (r) => r.kind === 'COMP_OFF' ? `${r.days ?? '—'} ${Number(r.days) === 1 ? 'day' : 'days'}` : duration(r.minutes);
const dayNames = { working: 'Working day', weeklyOff: 'Weekly off', holiday: 'Holiday' };

export function RequestQueue({ rows, active, inspect, filters, selection, selectable, narrow }) {
  const table = useRef(null);
  const anchor = useRef(null);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const move = (e, index) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    if (selectable && e.key === ' ') {
      e.preventDefault();
      const id = rows[index].id;
      const chosen = new Set(selection.selected);
      const start = rows.findIndex(row => row.id === anchor.current);
      if (e.shiftKey && start >= 0) {
        rows.slice(Math.min(start, index), Math.max(start, index) + 1).forEach(row => chosen.add(row.id));
      } else {
        if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
        anchor.current = id;
      }
      selection.setSelected(chosen);
      return;
    }
    if (e.shiftKey) return;
    const step = { ArrowUp: -1, k: -1, ArrowDown: 1, j: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(rows.length - 1, index + step));
    table.current?.querySelectorAll('.ot-open')[next]?.focus();
    if (!narrow) inspect(rows[next]);
  };
  return <section ref={table} className="ot-queue" aria-label="Request queue">
    <div className="ot-phone-tools">
      {selectable && rows.length > 0 && <label><PageCheckbox rows={rows} selection={selection} />Select page</label>}
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}><SlidersHorizontal size={15} />Filters</button>
    </div>
    <TimeRegisterTable enabled={selectable} register="OvertimeRequests" required={['Employee', 'Request']} className="ot-table" aria-label="Overtime and comp-off requests" data-filters={filterOpen || undefined}>
      <thead><tr>
        {selectable && <th className="ot-check" scope="col"><PageCheckbox rows={rows} selection={selection} /></th>}
        <ColumnHeader label="Employee" col="employee" state={filters} />
        <ColumnHeader label="Work date" col="date" type="date" state={filters} />
        <ColumnHeader label="Request" col="kind" state={filters} />
        <ColumnHeader label="Reason" col="reason" state={filters} />
      </tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id} data-current={!narrow && active?.id === r.id || undefined} data-chosen={selection.selected.has(r.id) || undefined}
        onClick={(e) => { if (!e.target.closest('button,input,label')) inspect(r); }}>
        {selectable && <RowCheckbox row={r} selection={selection} />}
        <td className="ot-person"><button className="ot-open" type="button" onClick={() => inspect(r)} onKeyDown={e => move(e,i)}
          aria-current={!narrow && active?.id === r.id ? "true" : undefined} aria-label={`Review ${requestType(r).toLowerCase()} for ${r.employeeName}`}><strong>{r.employeeName}</strong><ArrowRight size={14} aria-hidden="true" /></button>
          <small>{r.employeeCode}</small></td>
        <td className="ot-date">{dateWords(r.date)}</td>
        <td className="ot-amount"><strong>{requested(r)}</strong><small>{requestType(r)}</small></td>
        <td className="ot-reason">{r.reason || '—'}</td>
      </tr>)}</tbody>
    </TimeRegisterTable>
  </section>;
}

export function DecisionButtons({ request, busy, decide }) {
  return <div className="ot-decisions">
    <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => decide(request, true)}><Check size={16} />Approve {requestType(request).toLowerCase()}</button>
    <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => decide(request, false)}>Decline</button>
  </div>;
}

export function RequestDetails({ request: r, status, note, onNote, busy }) {
  const pending = status === 'PENDING';
  const state = { APPROVED: 'Approved', REJECTED: 'Declined', CANCELLED: 'Withdrawn' }[status] || (r.waitingOnManager ? 'With manager' : 'Waiting');
  return <div className="ot-details">
    <div className="ot-detail-top"><div><h3>{r.employeeName}</h3><small>{r.employeeCode}</small></div>
      <span className={`ui-pill ui-pill-${pending ? 'warn' : status === 'APPROVED' ? 'pos' : 'neutral'}`}>{state}</span></div>
    <dl className="ot-facts">
      <div><dt>{requestType(r)} requested</dt><dd>{requested(r)}</dd></div>
      <div><dt>Work date</dt><dd>{dateWords(r.date)}</dd></div>
      {r.kind === 'COMP_OFF' && <div><dt>Extra time worked</dt><dd>{duration(r.minutes)}</dd></div>}
      {r.kind !== 'COMP_OFF' && r.rate != null && <div><dt>Pay rate</dt><dd>{r.rate}×</dd></div>}
      {dayNames[r.dayType] && <div><dt>Day type</dt><dd>{dayNames[r.dayType]}</dd></div>}
    </dl>
    {r.overCap && <p className="ot-warning">{r.overCap}</p>}
    <div className="ot-detail-text"><h4>Reason</h4><p>{r.reason || 'No reason provided'}</p></div>
    {pending && !r.waitingOnManager
      ? <label className="ot-note"><span>Decision note <small>(optional)</small></span><textarea className="ui-input" rows={2} disabled={busy} value={note} onChange={e=>onNote(e.target.value)} /></label>
      : r.reviewNote && <div className="ot-detail-text"><h4>Decision note</h4><p>{r.reviewNote}</p></div>}
  </div>;
}
