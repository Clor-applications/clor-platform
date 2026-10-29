import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Upload } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import { downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import { normaliseDateColumns, toIsoDate } from '@ui/utils/importDates';
import { matchColumns, normaliseTimeColumns, rowsByColumn, toStatus } from '@ui/utils/importColumns';
import { readXlsx } from '@ui/utils/xlsx';
import { importContractors, importEmployees } from '@ui/personnel/api';
import { importAssignments, importHolidays, importLeaveBalances, importLeaveHistory, importRecords } from '../api/attendance';

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
      { key: 'date', label: 'Date (15/10/2026 or 2026-10-15)', date: true, aliases: ['Day', 'Attendance date'] },
      { key: 'checkIn', label: 'In (09:05, 9:05 am)', time: true, aliases: ['In time', 'Check in', 'First in', 'Punch in', 'Time in', 'Entry'] },
      { key: 'checkOut', label: 'Out (18:10, 6:10 pm)', time: true, aliases: ['Out time', 'Check out', 'Last out', 'Punch out', 'Time out', 'Exit'] },
      { key: 'status', label: 'Status (blank, P, A, HD, Leave, or PRESENT, HALF_DAY, ABSENT, ON_LEAVE)', status: true, aliases: ['Attendance'] },
      { key: 'note', label: 'Note', aliases: ['Remarks', 'Remark', 'Comment'] },
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
      { key: 'dateOfJoining', label: 'Joined (15/10/2026 or 2026-10-15)', date: true },
      { key: 'gender', label: 'Gender (MALE / FEMALE / OTHER)' },
      { key: 'workEmail', label: 'Work e-mail' },
      { key: 'workPhone', label: 'Phone' },
    ],
    sample: { name: 'Asha Rao', code: 'E-001', department: 'Finance', jobPosition: 'Accountant', dateOfJoining: '2026-04-01', gender: 'FEMALE', workEmail: '', workPhone: '' },
    run: (rows, dryRun) => importEmployees(rows, dryRun).then((r) => ({ imported: (r.results || []).filter((x) => x.ok).length, failed: (r.results || []).filter((x) => !x.ok).length, results: (r.results || []).filter((x) => !x.ok) })),
    unit: 'people',
  },
  {
    id: 'holidays',
    label: 'Holidays',
    blurb: 'The year’s calendar. A date already on it with the same name is skipped.',
    columns: [
      { key: 'date', label: 'Date (15/10/2026 or 2026-10-15)', date: true },
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
      { key: 'from', label: 'From (15/10/2026 or 2026-10-15)', date: true },
      { key: 'to', label: 'To (a date, blank = open)', date: true },
    ],
    sample: { employeeCode: 'E-001', shift: 'General', from: '2026-10-01', to: '' },
    run: importAssignments,
    unit: 'assignments',
  },
  {
    id: 'leaveBalances',
    label: 'Leave balances',
    blurb: 'Each person’s days for the year, per paid leave type: for a company moving to CLOR mid-year. Replaces the type’s own days for that person.',
    columns: [
      { key: 'employeeCode', label: 'Employee code' },
      { key: 'leaveType', label: 'Leave type (as in Leave Policy)' },
      { key: 'year', label: 'Year (blank = this year)' },
      { key: 'days', label: 'Days for the year' },
      { key: 'note', label: 'Note' },
    ],
    sample: { employeeCode: 'E-001', leaveType: 'Casual', year: '2026', days: '12', note: 'Carried from the old system' },
    run: importLeaveBalances,
    unit: 'balances',
  },
  {
    id: 'leaveHistory',
    label: 'Leave already taken',
    blurb: 'Past leave: each row is recorded as approved, its days marked on leave, and counted in the balance.',
    columns: [
      { key: 'employeeCode', label: 'Employee code' },
      { key: 'leaveType', label: 'Leave type (as in Leave Policy)' },
      { key: 'from', label: 'From (15/10/2026 or 2026-10-15)', date: true },
      { key: 'to', label: 'To (blank = one day)', date: true },
      { key: 'halfDay', label: 'Half day (FIRST, SECOND or blank)' },
      { key: 'reason', label: 'Reason' },
    ],
    sample: { employeeCode: 'E-001', leaveType: 'Casual', from: '2026-09-15', to: '2026-09-16', halfDay: '', reason: 'Family function' },
    run: importLeaveHistory,
    unit: 'leave rows',
  },
  {
    id: 'contractors',
    label: 'Contractors',
    blurb: 'Labour contractors with their licence. A name already on the list is updated.',
    columns: [
      { key: 'name', label: 'Contractor name' },
      { key: 'code', label: 'Code' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'E-mail' },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'licenceNo', label: 'Licence number' },
      { key: 'licenceValidTo', label: 'Licence valid to (15/10/2027 or 2027-10-15)', date: true },
      { key: 'address', label: 'Address' },
    ],
    sample: { name: 'Sri Ganesh Labour Services', code: 'C-01', contactPerson: 'Ramesh', phone: '9800000000', email: '', gstin: '', licenceNo: 'CLRA/123/2026', licenceValidTo: '2027-03-31', address: '' },
    run: importContractors,
    unit: 'contractors',
  },
];

/* Other names a sheet uses for the person's code, whatever the file holds. */
const CODE_NAMES = ['Emp code', 'Employee ID', 'Emp ID', 'Emp no', 'Employee no', 'Staff ID', 'Code'];
const columnsOf = (kind) => kind.columns.map((c) => (c.key === 'employeeCode' ? { ...c, aliases: [...(c.aliases || []), ...CODE_NAMES] } : c));

/** A file's rows, keyed by the import's columns: CSV, or the first sheet of an Excel workbook. */
async function readRows(f, kind) {
  const name = f.name.toLowerCase();
  if (name.endsWith('.xls')) throw new Error('That is an old Excel file (.xls). In Excel, save it as .xlsx or CSV, then choose it again.');
  let headers;
  let rows;
  if (name.endsWith('.xlsx')) ({ headers, rows } = await readXlsx(f));
  else ({ headers, rows } = parseCsv(await readFileText(f)));
  const columns = columnsOf(kind);
  const mapping = matchColumns(headers, columns);
  if (!mapping.size) throw new Error(`None of the columns match the template. Expected: ${kind.columns.map((c) => c.label.replace(/\s*\(.*\)$/, '')).join(', ')}.`);
  let out = rowsByColumn(headers, rows, mapping).filter((r) => Object.values(r).some((v) => v !== ''));
  /* Day-first dates (15/10/2026, 15-Oct-2026, an Excel day number), times as people type them, and P / A / HD are read here; what cannot be read goes as typed and the check names the row. */
  out = normaliseDateColumns(out, kind.columns.filter((c) => c.date).map((c) => c.key));
  out = normaliseTimeColumns(out, kind.columns.filter((c) => c.time).map((c) => c.key));
  const statusKeys = kind.columns.filter((c) => c.status).map((c) => c.key);
  if (statusKeys.length) out = out.map((r) => ({ ...r, ...Object.fromEntries(statusKeys.map((k) => [k, toStatus(r[k])])) }));
  const found = new Set(mapping.values());
  return { rows: out, matched: [...mapping].map(([h, key]) => ({ heading: h, key })), missing: kind.columns.filter((c) => !found.has(c.key)).map((c) => c.label.replace(/\s*\(.*\)$/, '')) };
}

const sameName = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]/g, '') === String(b).toLowerCase().replace(/[^a-z0-9]/g, '');

/* How a day already recorded was made, in words, for "would replace". */
const MADE_BY = { DEVICE: 'from a reader', MANUAL: 'entered by hand', IMPORT: 'imported', REQUEST: 'from an approved request', LEAVE: 'from leave', CLOCK: 'from the app' };

/* `params.kind` opens it on one kind: the Import entry on a list (Holidays, Records, ...) says which. */
export default function DataImport({ params } = {}) {
  const [kindId, setKindId] = useState(() => (KINDS.some((k) => k.id === params?.kind) ? params.kind : 'records'));
  const kind = useMemo(() => KINDS.find((k) => k.id === kindId), [kindId]);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [columnsRead, setColumnsRead] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  /* The same import with dryRun: what would go in and what would not, before anything is saved. */
  const [check, setCheck] = useState(null);
  const input = useRef(null);

  const pick = async (f) => {
    setProblem('');
    setResult(null);
    setCheck(null);
    setRows(null);
    setColumnsRead(null);
    setFile(f || null);
    if (!f) return;
    try {
      const read = await readRows(f, kind);
      setRows(read.rows);
      setColumnsRead(read);
    } catch (e) {
      setProblem(String(e?.message || 'That file could not be read.'));
    }
  };
  const checkFile = async () => {
    if (!rows?.length) return;
    setBusy(true);
    setProblem('');
    try {
      setCheck(await kind.run(rows, true));
    } catch (e) {
      setProblem(String(e?.message || 'Could not check the file.'));
    } finally {
      setBusy(false);
    }
  };
  const go = async () => {
    if (!rows?.length) return;
    setBusy(true);
    setProblem('');
    try {
      setResult(await kind.run(rows, false));
    } catch (e) {
      setProblem(String(e?.message || 'Not imported.'));
    } finally {
      setBusy(false);
    }
  };
  /* Say how the first row's dates were read, so a month/day mix-up shows before anything is saved. */
  const dateNote = useMemo(() => {
    const first = rows?.[0];
    if (!first) return '';
    const keys = kind.columns.filter((c) => c.date && first[c.key]).map((c) => c.key);
    if (!keys.length) return '';
    const unread = keys.filter((k) => !toIsoDate(first[k]));
    const shown = keys.filter((k) => toIsoDate(first[k])).map((k) => `${k} ${new Date(`${first[k]}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    return [shown.length ? `Dates read day first: ${shown.join(', ')}.` : '', unread.length ? `Could not read ${unread.join(', ')} in the first row.` : ''].filter(Boolean).join(' ');
  }, [rows, kind]);
  const reset = () => { setFile(null); setRows(null); setColumnsRead(null); setResult(null); setCheck(null); setProblem(''); if (input.current) input.current.value = ''; };

  return (
    <div className="space-y-3">
      <PageHeader entity="settings" title="Import Data" description="Bring a spreadsheet in: pick what it holds, use the template, drop the file." />
      <div className="pb-8 space-y-6">
      <ol className="grid gap-4 lg:grid-cols-3">
        <li className="ui-card p-4 space-y-3">
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
        <li className="ui-card p-4 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">2</span>The template</h2>
          <p className="ui-caption">Columns in any order; your own headings work too (Emp code, In time, Out). Extra columns are ignored.</p>
          <ul className="text-sm space-y-0.5">
            {kind.columns.map((c) => <li key={c.key}><code className="ui-mono text-xs">{c.key}</code> <span className="ui-caption">— {c.label}</span></li>)}
          </ul>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => downloadCsvTemplate({ fileName: `${kind.label} import template`, columns: kind.columns.map((c) => ({ key: c.key, label: c.key })), sample: kind.sample })}>
            <Download size={16} aria-hidden="true" /> Download template
          </button>
        </li>
        <li className="ui-card p-4 space-y-3">
          <h2 className="ui-t-sec"><span className="ui-caption mr-2">3</span>The file</h2>
          <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={() => input.current?.click()}>
            <Upload size={16} aria-hidden="true" /> {file ? file.name : 'Choose an Excel or CSV file'}
          </button>
          {problem ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{problem}</p> : null}
          {rows && !result && !check ? (
            <>
              <p className="text-sm">{rows.length.toLocaleString('en-IN')} row{rows.length === 1 ? '' : 's'} read. First: <span className="ui-mono text-xs">{JSON.stringify(rows[0]).slice(0, 120)}</span></p>
              {columnsRead?.matched?.length ? <p className="ui-caption">Columns read: {columnsRead.matched.map((m) => { const label = kind.columns.find((c) => c.key === m.key)?.label.replace(/\s*\(.*\)$/, '') || m.key; return sameName(m.heading, label) || m.heading === m.key ? m.heading : `${m.heading} as ${label}`; }).join(', ')}.{columnsRead.missing.length ? ` Not in the file: ${columnsRead.missing.join(', ')}.` : ''}</p> : null}
              {dateNote ? <p className="ui-caption">{dateNote}</p> : null}
              <button type="button" className="ui-btn ui-btn-primary w-full" disabled={busy} onClick={checkFile}>{busy ? 'Checking…' : 'Check the file'}</button>
              <p className="ui-caption">Every row is checked the way it would be imported. Nothing is saved until you confirm.</p>
            </>
          ) : null}
          {check && !result ? (
            <div className="space-y-2" role="status">
              <p className="text-sm"><strong>{check.imported.toLocaleString('en-IN')}</strong> {kind.unit} ready{check.skipped ? `, ${check.skipped} already there` : ''}{check.failed ? <>, <strong style={{ color: 'rgb(var(--neg))' }}>{check.failed}</strong> with a problem</> : ''}.</p>
              {check.results?.length ? (
                <ul className="text-sm space-y-0.5 max-h-56 overflow-y-auto">
                  {check.results.map((x) => <li key={x.row}><span className="ui-mono text-xs">row {x.row}</span> <span className="ui-caption">{x.error}</span></li>)}
                </ul>
              ) : null}
              {check.replacing?.length ? (
                <details className="text-sm">
                  <summary className="cursor-pointer"><strong>{check.replacing.length.toLocaleString('en-IN')}</strong> {check.replacing.length === 1 ? 'day is' : 'days are'} already recorded and would be replaced</summary>
                  <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                    {check.replacing.map((x) => <li key={x.row}><span className="ui-mono text-xs">row {x.row}</span> <span className="ui-caption">replaces a day {MADE_BY[x.source] || 'already there'}</span></li>)}
                  </ul>
                </details>
              ) : null}
              <div className="flex gap-2">
                <button type="button" className="ui-btn ui-btn-primary flex-1" disabled={busy || !check.imported} onClick={go}>{busy ? 'Importing…' : `Import ${check.imported.toLocaleString('en-IN')} ${kind.unit}`}</button>
                <button type="button" className="ui-btn ui-btn-secondary" onClick={reset}>Start again</button>
              </div>
              {check.failed ? <p className="ui-caption">Rows with a problem are left out; fix them in the file and import it again.</p> : null}
            </div>
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
    </div>
  );
}
