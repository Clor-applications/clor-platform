import React, { useRef, useState } from 'react';
import { Check, FileDown, Upload } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import Alert from '@ui/components/ui/Alert';
import ErrorState from '@ui/components/ui/ErrorState';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { clearUnsaved } from '@platform/unsaved';
import { usePermissions } from '@ui/permissions/usePermissions';
import { downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import { readXlsx } from '@ui/utils/xlsx';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { IMPORT_COLUMNS, IMPORT_FIELDS, guessField } from '@ui/personnel/Employees';

/* The spreadsheet keys stay as they are (the template uses them); people choose from names. */
const FIELD_WORDS = {
  name: 'Name', code: 'Employee ID', email: 'Personal email', workEmail: 'Work email', phone: 'Phone', department: 'Department', jobPosition: 'Designation',
  employeeType: 'Employment type', workType: 'Work mode', dateOfJoining: 'Joining date', dateOfBirth: 'Date of birth', gender: 'Gender', businessUnit: 'Business unit', grade: 'Grade', costCentre: 'Cost centre',
  hours: 'Hours', probationEndDate: 'Probation ends', contractEndDate: 'Contract ends',
};
import { importEmployees, undoImport } from '@ui/personnel/api';

import { downloadText } from './api';
import { can } from './shared';

/**
 * Workforce → Import employees (People design spec v1 EMP-10; Workforce
 * package WF-07, WF-15). Upload, map the columns, check every row on the
 * server without saving (dry run), review the counts and the policy for
 * people already here, import, then the result row by row with a file of the
 * rows that did not go in. An import can be undone for 24 hours. Nothing is
 * saved before the Import button.
 */
const STEPS = [['upload', 'Upload'], ['map', 'Map columns'], ['validate', 'Check'], ['review', 'Review'], ['results', 'Results']];
const MAX_BYTES = 2_000_000;
const MAX_ROWS = 1000;
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default function ImportEmployees({ openScreen }) {
  const perms = usePermissions();
  const [file, setFile] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [mode, setMode] = useState('create');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [errorsOnly, setErrorsOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [step, setStep] = useState('upload');
  const input = useRef(null);
  const stepIndex = STEPS.findIndex(([k]) => k === step);
  /* A file mapped or checked but not imported yet is work in hand. */
  useUnsavedChanges(Boolean(file) && step !== 'results' && step !== 'upload');

  if (!can(perms, 'PEOPLE::Employees::CREATE')) return <ErrorState kind="forbidden" body="Importing employees needs the Employees create permission." />;

  const take = async (f) => {
    setFailure(null);
    if (!f) return;
    const excel = /\.xlsx$/i.test(f.name);
    if (!excel && !/\.csv$/i.test(f.name) && f.type !== 'text/csv') return setFailure({ message: 'Choose a CSV or Excel (.xlsx) file.' });
    if (f.size > MAX_BYTES) return setFailure({ message: 'That file is over 2 MB. Split it into smaller files.' });
    try {
      let headers;
      let rows;
      if (excel) {
        const sheet = await readXlsx(f);
        headers = sheet.headers.map((h) => String(h || '').trim());
        rows = sheet.rows;
      } else {
        /* parseCsv gives the header row and each row keyed by it; the mapping works on columns, so rows go back to arrays. */
        const parsed = parseCsv(await readFileText(f));
        headers = (parsed.headers || []).map((h) => String(h || '').trim());
        rows = (parsed.rows || []).map((o) => headers.map((h) => o[h] ?? ''));
      }
      rows = rows.filter((r) => r.some((c) => String(c || '').trim()));
      if (!headers.length || !rows.length) return setFailure({ message: 'That file has no rows under its header row.' });
      if (rows.length > MAX_ROWS) return setFailure({ message: `That file has ${rows.length} rows; import at most ${MAX_ROWS} at a time.` });
      const seen = new Set();
      const dupes = headers.filter((h) => { const k = h.toLowerCase(); if (seen.has(k)) return true; seen.add(k); return false; });
      setFile({ name: f.name, headers, rows, dupes });
      setMapping(headers.map(guessField));
      setPreview(null);
      setResult(null);
      setStep('map');
    } catch (e) {
      setFailure({ message: String(e?.message || 'Could not read that file.') });
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  const records = () => file.rows.map((r) => Object.fromEntries(mapping.map((k, i) => (k ? [k, String(r[i] ?? '').trim() || null] : null)).filter(Boolean)));
  const mappedKeys = mapping.filter(Boolean);
  const twice = mappedKeys.filter((k, i) => mappedKeys.indexOf(k) !== i);
  const check = async () => {
    setBusy(true);
    setFailure(null);
    try {
      setPreview(await importEmployees(records(), true, mode));
      setStep('validate');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (busy) return;
    if (!(await confirmDialog({ title: `Import ${preview.imported} ${preview.imported === 1 ? 'row' : 'rows'}?`, message: `${preview.failed} with a problem will be skipped. You can undo the import for 24 hours.`, confirmLabel: 'Import', tone: 'primary' }))) return;
    setBusy(true);
    setFailure(null);
    try {
      setResult(await importEmployees(records(), false, mode));
      setStep('results');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!(await confirmDialog({ title: 'Undo this import?', message: 'The people it added are removed with their history; the people it changed go back to what they were.', confirmLabel: 'Undo' }))) return;
    setBusy(true);
    try {
      const r = await undoImport(result.batchId);
      notify.success(`Undone: ${r.removed} removed, ${r.restored} put back${r.kept ? `, ${r.kept} kept (already in payroll)` : ''}.`);
      setResult({ ...result, undone: true });
    } catch (e) {
      notify.error(String(e?.message || 'Not undone.'));
    } finally {
      setBusy(false);
    }
  };
  /* The rows that did not go in, exactly as the file had them plus what was wrong: fix them in the spreadsheet and upload that file. */
  const failedRows = () => {
    const bad = result.results.filter((r) => !r.ok);
    const lines = [[...file.headers, 'Problem'], ...bad.map((r) => [...(file.rows[r.row - 1] || []), r.error || ''])];
    const base = file.name.replace(/\.(csv|xlsx)$/i, '');
    downloadText(`\ufeff${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`, `${base}-to-fix.csv`);
  };
  const report = (res, name) => {
    const lines = [['Row', 'Result', 'Detail'], ...res.results.map((r) => [r.row, r.ok ? (r.action === 'UPDATE' ? 'Updated' : 'Ready') : 'Problem', r.ok ? (r.warning || '') : r.error])];
    downloadText(`\ufeff${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`, name);
  };

  return (
    <div className="space-y-4">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Workforce', onClick: () => openScreen?.('employees') }, { label: 'Import employees' }]} title="Import employees" />
      <ol className="ui-stepper" aria-label="Steps">
        {STEPS.map(([k, label], i) => (
          <li key={k} className={`ui-step ${i === stepIndex ? 'is-current' : ''} ${i < stepIndex ? 'is-done' : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
            <span className="ui-step-mark" aria-hidden="true">{i < stepIndex ? <Check size={14} /> : i + 1}</span><span className="ui-step-label">{label}</span>
          </li>
        ))}
      </ol>
      <div className="ui-record-section space-y-4">
        {failure ? <ErrorState error={failure.status || failure.network ? failure : null} title={failure.status || failure.network ? undefined : 'That file cannot be used'} body={failure.status || failure.network ? undefined : failure.message} compact onRetry={step === 'map' ? check : step === 'review' ? commit : null} retryLabel="Try again" /> : null}

        {step === 'upload' ? (
          <div className="space-y-3">
            <label className="ui-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files?.[0]); }}>
              <Upload size={24} aria-hidden="true" />
              <span className="font-medium">Choose a CSV or Excel file</span>
              <span className="ui-caption">or drop it here · up to 2 MB and {MAX_ROWS} rows</span>
              <input ref={input} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => downloadCsvTemplate({ fileName: 'Employees import template', columns: IMPORT_COLUMNS, sample: { name: 'Asha Rao', code: 'EMP-0001', department: 'Finance', jobPosition: 'Accountant', dateOfJoining: '2026-04-01', gender: 'FEMALE' } })}><FileDown size={16} aria-hidden="true" /> Download the template</button>
            </div>
          </div>
        ) : null}

        {step === 'map' && file ? (
          <div className="space-y-3">
            <p className="text-sm"><span className="font-medium">{file.name}</span><span className="ui-muted"> · {file.rows.length} {file.rows.length === 1 ? 'row' : 'rows'}</span></p>
            {file.dupes.length ? <Alert tone="warn" title="Repeated column names">{file.dupes.join(', ')} appear more than once; map only one of each.</Alert> : null}
            {twice.length ? <Alert tone="neg" title="Two columns go to the same field">{[...new Set(twice)].join(', ')}: choose one.</Alert> : null}
            {!mappedKeys.includes('name') ? <Alert tone="info" title="A name column is needed">Map one column to name.</Alert> : null}
            <div className="ui-table-scroll">
              <table className="ui-table w-full">
                <thead><tr><th scope="col">Column in the file</th><th scope="col">First rows</th><th scope="col">Goes to</th></tr></thead>
                <tbody className="ui-rows">
                  {file.headers.map((h, i) => (
                    <tr key={`${h}-${i}`}>
                      <td className="font-medium">{h || `Column ${i + 1}`}</td>
                      <td className="ui-caption">{file.rows.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        <PopupSelect showValueSubtext={false} ariaLabel={`Field for ${h || `column ${i + 1}`}`} value={mapping[i]} alwaysSearch
                          onChange={(v) => { const m = [...mapping]; m[i] = v || ''; setMapping(m); setPreview(null); }}
                          options={[{ value: '', label: 'Ignore this column' }, ...IMPORT_FIELDS.map((f) => ({ value: f.key, label: FIELD_WORDS[f.key] || f.label }))]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="max-w-md">
              <PopupSelect showValueSubtext={false} label="When an employee ID is already here" value={mode} onChange={(v) => { setMode(v || 'create'); setPreview(null); }}
                options={[{ value: 'create', label: 'Skip that row' }, { value: 'update', label: 'Update that employee' }]} />
            </div>
          </div>
        ) : null}

        {(step === 'validate' || step === 'review') && preview ? (
          <div className="space-y-3">
            <dl className="ui-metric-strip">
              <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{preview.imported}</dd><dt className="ui-metric-label">Ready{preview.results.some((r) => r.action === 'UPDATE') ? ` (${preview.results.filter((r) => r.action === 'UPDATE').length} updates)` : ''}</dt></span></div>
              <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{preview.failed}</dd><dt className="ui-metric-label">With a problem</dt></span></div>
              <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{preview.results.filter((r) => r.warning).length}</dd><dt className="ui-metric-label">May be someone already here</dt></span></div>
            </dl>
            {step === 'validate' ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />Problems only</label>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm ml-auto" onClick={() => report(preview, 'import-check.csv')}>Download the check</button>
                </div>
                <ul className="divide-y text-sm max-h-96 overflow-y-auto" aria-label="Rows">
                  {preview.results.filter((r) => !errorsOnly || !r.ok || r.warning).map((r) => (
                    <li key={r.row} className="py-1.5 flex gap-3"><span className="tabular-nums ui-muted w-16 shrink-0">Row {r.row}</span><span className={r.ok ? '' : 'ui-text-neg'}>{r.ok ? (r.warning || (r.action === 'UPDATE' ? 'Updates someone already here' : 'Ready')) : r.error}</span></li>
                  ))}
                </ul>
              </>
            ) : (
              <Alert tone="info" title={`${preview.imported} ${preview.imported === 1 ? 'row goes' : 'rows go'} in; ${preview.failed} ${preview.failed === 1 ? 'is' : 'are'} skipped`}>{mode === 'update' ? 'People already here are updated with the columns given.' : 'Rows naming an employee ID already here are skipped.'} It can be undone for 24 hours.</Alert>
            )}
          </div>
        ) : null}

        {step === 'results' && result ? (
          <div className="space-y-3">
            <Alert tone={result.failed ? 'warn' : 'pos'} title={`${result.imported} ${mode === 'update' ? 'saved' : 'imported'}, ${result.failed} not`}>{result.undone ? 'This import has been undone.' : result.batchId ? `It can be undone until ${new Date(result.undoUntil).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</Alert>
            {result.failed ? <ul className="divide-y text-sm max-h-96 overflow-y-auto">{result.results.filter((r) => !r.ok).map((r) => <li key={r.row} className="py-1.5"><span className="tabular-nums ui-muted">Row {r.row}</span> · {r.error}</li>)}</ul> : null}
          </div>
        ) : null}

        <div className="ui-wizard-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={async () => { if (step === 'results' || !file || await confirmDialog({ title: 'Leave the import?', message: 'Nothing has been imported.', confirmLabel: 'Leave' })) { clearUnsaved(); openScreen?.('employees'); } }}>{step === 'results' ? 'Back to Workforce' : 'Cancel'}</button>
          <span className="flex flex-wrap gap-2 ml-auto">
            {step === 'map' ? <><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setStep('upload')}>Choose another file</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !mappedKeys.includes('name') || twice.length > 0} onClick={check}>{busy ? 'Checking…' : 'Check rows'}</button></> : null}
            {step === 'validate' ? <><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setStep('map')}>Back to mapping</button><button type="button" className="ui-btn ui-btn-primary" disabled={!preview?.imported} onClick={() => setStep('review')}>Continue</button></> : null}
            {step === 'review' ? <><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setStep('validate')}>Back</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={commit}>{busy ? 'Importing…' : `Import ${preview?.imported || ''}`}</button></> : null}
            {step === 'results' ? <>{result?.failed ? <><button type="button" className="ui-btn ui-btn-secondary" onClick={failedRows}>Download rows to fix</button><button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setFile(null); setPreview(null); setResult(null); setStep('upload'); }}>Upload the fixed file</button></> : null}{result?.batchId && !result.undone ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={undo}>Undo this import</button> : null}</> : null}
          </span>
        </div>
      </div>
    </div>
  );
}
