import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Upload } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import { downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import { importEmployees } from '@ui/personnel/api';
import { importAssignments, importHolidays, importRecords } from '../api/attendance';

/**
 * ClorTime's Import Wizard: pick what the file holds, take the template,
 * drop the file, read the verdict. Each kind posts to a bulk endpoint that
 * judges row by row, so a file with a few bad lines still lands the rest and
 * says exactly which lines to fix. Punches as a reader sends them are not
 * here — they come in through Readers → add a file import, which keeps them
 * as punches rather than days.
 */
const KINDS = [
  {
    id: 'records',
    label: 'Attendance days',
    blurb: 'One row per person per day: in and out times, or a status.',
    columns: [
      { key: 'employeeCode', label: 'Employee code' },
      { key: 'date', label: 'Date (YYYY-MM-DD)' },
      { key: 'checkIn', label: 'In (HH:MM)' },
      { key: 'checkOut', label: 'Out (HH:MM)' },
      { key: 'status', label: 'Status (blank, PRESENT, HALF_DAY, ABSENT, ON_LEAVE)' },
      { key: 'note', label: 'Note' },
    ],
    sample: { employeeCode: 'E-001', date: '2026-10-01', checkIn: '09:05', checkOut: '18:10', status: '', note: '' },
    run: importRecords,
    unit: 'days',
  },
  {
    id: 'employees',
    label: 'Employees',
    blurb: 'New people, with their department and position created as needed.',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Employee code' },
      { key: 'department', label: 'Department' },
      { key: 'jobPosition', label: 'Position' },
      { key: 'dateOfJoining', label: 'Joined (YYYY-MM-DD)' },
      { key: 'gender', label: 'Gender (MALE / FEMALE / OTHER)' },
      { key: 'workEmail', label: 'Work e-mail' },
      { key: 'workPhone', label: 'Phone' },
    ],
    sample: { name: 'Asha Rao', code: 'E-001', department: 'Finance', jobPosition: 'Accountant', dateOfJoining: '2026-04-01', gender: 'FEMALE', workEmail: '', workPhone: '' },
    run: (rows) => importEmployees(rows).then((r) => ({ imported: (r.results || []).filter((x) => x.ok).length, failed: (r.results || []).filter((x) => !x.ok).length, results: (r.results || []).filter((x) => !x.ok) })),
    unit: 'people',
  },
  {
    id: 'holidays',
    label: 'Holidays',
    blurb: 'The year’s calendar. A date already on it with the same name is skipped.',
    columns: [
      { key: 'date', label: 'Date (YYYY-MM-DD)' },
      { key: 'name', label: 'Name' },
      { key: 'optional', label: 'Optional (yes / no)' },
      { key: 'area', label: 'Area (blank = everyone)' },
    ],
    sample: { date: '2026-10-02', name: 'Gandhi Jayanti', optional: 'no', area: '' },
    run: importHolidays,
    unit: 'holidays',
  },
  {
    id: 'assignments',
    label: 'Shift assignments',
    blurb: 'Who works which shift from when. The shift is named as in Shifts.',
    columns: [
      { key: 'employeeCode', label: 'Employee code' },
      { key: 'shift', label: 'Shift name' },
      { key: 'from', label: 'From (YYYY-MM-DD)' },
      { key: 'to', label: 'To (YYYY-MM-DD, blank = open)' },
    ],
    sample: { employeeCode: 'E-001', shift: 'General', from: '2026-10-01', to: '' },
    run: importAssignments,
    unit: 'assignments',
  },
];

export default function DataImport() {
  const [kindId, setKindId] = useState('records');
  const kind = useMemo(() => KINDS.find((k) => k.id === kindId), [kindId]);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const input = useRef(null);

  const pick = async (f) => {
    setProblem('');
    setResult(null);
    setRows(null);
    setFile(f || null);
    if (!f) return;
    try {
      const text = await readFileText(f);
      const parsed = parseCsv(text);
      const wanted = new Set(kind.columns.map((c) => c.key));
      const known = parsed.headers.filter((h) => wanted.has(h));
      if (!known.length) throw new Error(`None of the columns match the template. Expected: ${kind.columns.map((c) => c.key).join(', ')}.`);
      setRows(parsed.rows);
    } catch (e) {
      setProblem(String(e?.message || 'That file could not be read.'));
    }
  };
  const go = async () => {
    if (!rows?.length) return;
    setBusy(true);
    setProblem('');
    try {
      setResult(await kind.run(rows));
    } catch (e) {
      setProblem(String(e?.message || 'Not imported.'));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => { setFile(null); setRows(null); setResult(null); setProblem(''); };

  return (
    <div className="space-y-6">
      <PageHeader entity="attendance" title="Import" description="Bring a spreadsheet in: pick what it holds, use the template, drop the file." />
      <ol className="grid gap-4 lg:grid-cols-3">
        <li className="ui-card p-5 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">1</span>What the file holds</h2>
          <div className="space-y-1">
            {KINDS.map((k) => (
              <label key={k.id} className="flex items-start gap-2 rounded-lg p-2 ui-hover-sunken cursor-pointer" style={kindId === k.id ? { backgroundColor: 'rgb(var(--surface-sunken))' } : undefined}>
                <input type="radio" name="kind" className="mt-1" checked={kindId === k.id} onChange={() => { setKindId(k.id); reset(); }} />
                <span><span className="block text-sm font-medium">{k.label}</span><span className="ui-caption">{k.blurb}</span></span>
              </label>
            ))}
          </div>
          <p className="ui-caption">Punches straight from a reader’s export go in under Readers → add a reader → File import.</p>
        </li>
        <li className="ui-card p-5 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">2</span>The template</h2>
          <p className="ui-caption">Columns, in any order; extra columns are ignored.</p>
          <ul className="text-sm space-y-0.5">
            {kind.columns.map((c) => <li key={c.key}><code className="ui-mono text-xs">{c.key}</code> <span className="ui-caption">— {c.label}</span></li>)}
          </ul>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => downloadCsvTemplate({ fileName: `${kind.label} import template`, columns: kind.columns.map((c) => ({ key: c.key, label: c.key })), sample: kind.sample })}>
            <Download size={16} aria-hidden="true" /> Download template
          </button>
        </li>
        <li className="ui-card p-5 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">3</span>The file</h2>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={() => input.current?.click()}>
            <Upload size={16} aria-hidden="true" /> {file ? file.name : 'Choose a CSV file'}
          </button>
          {problem ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{problem}</p> : null}
          {rows && !result ? (
            <>
              <p className="text-sm">{rows.length.toLocaleString('en-IN')} row{rows.length === 1 ? '' : 's'} read. First: <span className="ui-mono text-xs">{JSON.stringify(rows[0]).slice(0, 120)}</span></p>
              <button type="button" className="ui-btn ui-btn-primary w-full" disabled={busy} onClick={go}>{busy ? 'Importing…' : `Import ${rows.length.toLocaleString('en-IN')} ${kind.unit}`}</button>
            </>
          ) : null}
          {result ? (
            <div className="space-y-2" role="status">
              <p className="flex items-center gap-2 text-sm font-medium" style={{ color: 'rgb(var(--pos))' }}><CheckCircle2 size={16} aria-hidden="true" /> {result.imported.toLocaleString('en-IN')} imported{result.skipped ? `, ${result.skipped} already there` : ''}{result.failed ? `, ${result.failed} not` : ''}.</p>
              {result.results?.length ? (
                <ul className="text-sm space-y-0.5 max-h-56 overflow-y-auto">
                  {result.results.map((x) => <li key={x.row}><span className="ui-mono text-xs">row {x.row}</span> <span className="ui-caption">{x.error}</span></li>)}
                </ul>
              ) : null}
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={reset}>Import another file</button>
            </div>
          ) : null}
        </li>
      </ol>
    </div>
  );
}
