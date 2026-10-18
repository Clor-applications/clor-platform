import React, { useState } from 'react';
import { Download } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import { downloadCsv } from '@ui/utils/csv';
import { listEmployees, listHolidays, listLeaveRequests, listRecords, listShifts, listTransactions, todayIst } from '../api/attendance';

/**
 * ClorTime's Export Center: what, for when, in which shape. Everything comes
 * from the same endpoints the screens read, so the file says what the screen
 * said. CSV for a spreadsheet; JSON for another system.
 */
const first = (ym) => `${ym}-01`;
const last = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shiftMonth = (ym, by) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7); };
const d = (days) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

const PRESETS = [
  { id: 'this-month', label: 'This month', range: () => [first(todayIst().slice(0, 7)), todayIst()] },
  { id: 'last-month', label: 'Last month', range: () => { const m = shiftMonth(todayIst().slice(0, 7), -1); return [first(m), last(m)]; } },
  { id: 'last-7', label: 'Last 7 days', range: () => [d(-6), todayIst()] },
  { id: 'today', label: 'Today', range: () => [todayIst(), todayIst()] },
];

const DATASETS = [
  { id: 'records', label: 'Attendance days', blurb: 'Each person’s day: in, out, worked, late, status.', period: true,
    load: ({ from, to }) => listRecords({ from, to }).then((r) => r?.records || []),
    columns: [['date', 'Date'], ['employeeCode', 'Employee code'], ['employeeName', 'Name'], ['checkInTime', 'In'], ['checkOutTime', 'Out'], ['workedMinutes', 'Worked (min)'], ['lateMinutes', 'Late (min)'], ['earlyOutMinutes', 'Early out (min)'], ['overtimeMinutes', 'Overtime (min)'], ['status', 'Status'], ['validated', 'Validated']] },
  { id: 'punches', label: 'Punches', blurb: 'Every punch as the readers and phones sent it.', period: true,
    load: ({ from, to }) => listTransactions({ from, to }).then((r) => r?.transactions || []),
    columns: [['localTime', 'Time'], ['employeeCode', 'Employee code'], ['employeeName', 'Name'], ['pin', 'Reader ID'], ['kind', 'Direction'], ['verify', 'Verified by'], ['workCode', 'Work code'], ['deviceName', 'Reader'], ['shiftDate', 'Counted on'], ['siteName', 'Site']] },
  { id: 'employees', label: 'Employees', blurb: 'The staff list with codes, departments and positions.', period: false,
    load: () => listEmployees(),
    columns: [['code', 'Code'], ['name', 'Name'], ['department', 'Department'], ['jobPosition', 'Position'], ['status', 'Status'], ['dateOfJoining', 'Joined'], ['workEmail', 'Work e-mail'], ['workPhone', 'Phone'], ['devicePin', 'Reader ID']] },
  { id: 'holidays', label: 'Holidays', blurb: 'This year’s calendar.', period: false,
    load: () => listHolidays(Number(todayIst().slice(0, 4))),
    columns: [['date', 'Date'], ['name', 'Name'], ['isOptional', 'Optional'], ['areaName', 'Area']] },
  { id: 'leave', label: 'Leave requests', blurb: 'Applications with their status.', period: false,
    load: () => listLeaveRequests().then((r) => r?.requests || r || []),
    columns: [['employeeCode', 'Employee code'], ['employeeName', 'Name'], ['leaveTypeName', 'Type'], ['fromDate', 'From'], ['toDate', 'To'], ['days', 'Days'], ['status', 'Status'], ['reason', 'Reason']] },
  { id: 'shifts', label: 'Shifts', blurb: 'The shift definitions.', period: false,
    load: () => listShifts().then((r) => r?.shifts || r || []),
    columns: [['name', 'Name'], ['startTime', 'Start'], ['endTime', 'End'], ['graceMinutes', 'Grace (min)'], ['weeklyOffDays', 'Weekly off']] },
];

export default function DataExport() {
  const [datasetId, setDatasetId] = useState('records');
  const [preset, setPreset] = useState('this-month');
  const [from, setFrom] = useState(PRESETS[0].range()[0]);
  const [to, setTo] = useState(PRESETS[0].range()[1]);
  const [format, setFormat] = useState('csv');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const dataset = DATASETS.find((x) => x.id === datasetId);

  const applyPreset = (id) => { setPreset(id); const p = PRESETS.find((x) => x.id === id); if (p) { const [a, b] = p.range(); setFrom(a); setTo(b); } };
  const go = async () => {
    setBusy(true);
    setNote('');
    try {
      const rows = await dataset.load({ from, to });
      const stem = `${dataset.label}${dataset.period ? ` ${from} to ${to}` : ''}`;
      if (format === 'json') {
        const blob = new Blob([JSON.stringify({ dataset: dataset.id, from: dataset.period ? from : undefined, to: dataset.period ? to : undefined, takenAt: new Date().toISOString(), rows }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${stem}.json`; a.click(); URL.revokeObjectURL(a.href);
      } else {
        downloadCsv({ fileName: stem, columns: dataset.columns.map(([key, label]) => ({ key, label })), rows: rows.map((r) => Object.fromEntries(dataset.columns.map(([key]) => [key, Array.isArray(r[key]) ? r[key].join(' ') : r[key] ?? '']))) });
      }
      setNote(`${rows.length.toLocaleString('en-IN')} row${rows.length === 1 ? '' : 's'} exported.${rows.length >= 2000 && dataset.period ? ' That is the most one export carries — narrow the dates for the rest.' : ''}`);
    } catch (e) {
      setNote(String(e?.message || 'Not exported.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Export" description="Take data out: what, for when, as a spreadsheet or for another system." />
      <ol className="grid gap-4 lg:grid-cols-3">
        <li className="ui-card p-4 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">1</span>What to export</h2>
          <div className="space-y-1">
            {DATASETS.map((x) => (
              <label key={x.id} className="flex items-start gap-2 rounded-lg p-2 ui-hover-sunken cursor-pointer" style={datasetId === x.id ? { backgroundColor: 'rgb(var(--surface-sunken))' } : undefined}>
                <input type="radio" name="dataset" className="mt-1" checked={datasetId === x.id} onChange={() => setDatasetId(x.id)} />
                <span><span className="block text-sm font-medium">{x.label}</span><span className="ui-caption">{x.blurb}</span></span>
              </label>
            ))}
          </div>
        </li>
        <li className="ui-card p-4 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">2</span>Period</h2>
          {dataset.period ? (
            <>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => <button key={p.id} type="button" className={`ui-btn ui-btn-sm ${preset === p.id ? 'ui-btn-primary' : 'ui-btn-secondary'}`} onClick={() => applyPreset(p.id)}>{p.label}</button>)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" className="ui-input" style={{ width: 'auto' }} value={from} onChange={(e) => { setFrom(e.target.value); setPreset(''); }} aria-label="From" />
                <span className="ui-caption">to</span>
                <input type="date" className="ui-input" style={{ width: 'auto' }} value={to} onChange={(e) => { setTo(e.target.value); setPreset(''); }} aria-label="To" />
              </div>
            </>
          ) : <p className="ui-caption">{dataset.id === 'holidays' ? 'This year.' : 'Everything on file.'}</p>}
        </li>
        <li className="ui-card p-4 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">3</span>Shape</h2>
          <div className="space-y-1">
            {[['csv', 'CSV', 'Opens in Excel or Google Sheets'], ['json', 'JSON', 'For importing into another system']].map(([id, label, hint]) => (
              <label key={id} className="flex items-start gap-2 rounded-lg p-2 ui-hover-sunken cursor-pointer" style={format === id ? { backgroundColor: 'rgb(var(--surface-sunken))' } : undefined}>
                <input type="radio" name="format" className="mt-1" checked={format === id} onChange={() => setFormat(id)} />
                <span><span className="block text-sm font-medium">{label}</span><span className="ui-caption">{hint}</span></span>
              </label>
            ))}
          </div>
          <button type="button" className="ui-btn ui-btn-primary w-full" disabled={busy} onClick={go}><Download size={16} aria-hidden="true" /> {busy ? 'Preparing…' : 'Export'}</button>
          {note ? <p className="ui-caption" role="status">{note}</p> : null}
          <p className="ui-caption">The whole company — every table, for backup or moving away — is under your profile → Export company data.</p>
        </li>
      </ol>
    </div>
  );
}
