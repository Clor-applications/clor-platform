import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload, ChevronLeft } from 'lucide-react';

import {
  commitImport,
  downloadTemplate,
  listImportSpecs,
  stageImport,
  validateImport,
} from '../../api/imports';
import { PageHeader, Spinner } from '@ui/components/ui/Primitives';
import { useFeatures } from '@ui/permissions/useFeatures';
import Modal from '@ui/components/ui/Modal';
import { csvSafeValue } from '@ui/utils/csv';

/**
 * Document import — requirements 15 and 16.
 *
 * The screen follows the server's three steps rather than hiding them behind
 * one button: choose and stage, see every problem, then commit. Hiding the
 * middle step is what produces an import nobody trusts.
 */

const saveTextAsFile = (text, filename) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/**
 * Keep only the columns that were asked for, in the template's own order.
 *
 * Required columns stay whatever the choice was: a file without them cannot be
 * checked, let alone imported, so offering to leave them out would be offering
 * a file that fails.
 */
export const narrowTemplate = (text, keys) => {
  const wanted = new Set((Array.isArray(keys) ? keys : []).map(String));
  if (!wanted.size) return text;

  const lines = String(text || '').split(/\r?\n/);
  if (!lines.length) return text;

  const split = (line) => line.split(',');
  const header = split(lines[0]);
  const keepAt = header.map((h, i) => (wanted.has(h.trim()) ? i : -1)).filter((i) => i >= 0);
  if (!keepAt.length || keepAt.length === header.length) return text;

  return lines
    .map((line, i) => {
      if (i > 0 && !line.trim()) return line;
      const cells = split(line);
      /* Rebuilt cells go back through the guard, the same as any other CSV this
         product writes — a template is a file a spreadsheet will open. */
      return keepAt.map((at) => csvSafeValue(cells[at] ?? '')).join(',');
    })
    .join('\n');
};

export default function ImportCenter({ onBack = null, initialDocType = '' }) {
  /*
   * Import is an opt-in feature, and the screen behaved as though it were not:
   * the file was pasted, checked, and only then did the server say the whole
   * thing was switched off. Say it before any of that work is done, and say
   * where to switch it on.
   */
  const { isEnabled } = useFeatures();
  const importsOn = isEnabled('imports');
  const [specs, setSpecs] = useState([]);
  const [unsupported, setUnsupported] = useState([]);
  const [docType, setDocType] = useState('');
  /*
   * Which columns the template carries.
   *
   * A template with every column on it is a spreadsheet somebody has to prune
   * before they can start, and the columns they do not need are the ones they
   * fill in wrongly. Required columns are always in it — a file without them
   * cannot be checked, let alone imported.
   */
  const [chosenColumns, setChosenColumns] = useState([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');

  const [batch, setBatch] = useState(null);
  const [issues, setIssues] = useState([]);
  const [result, setResult] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const spec = useMemo(() => specs.find((s) => s.docType === docType) || null, [specs, docType]);

  /* A new document type brings its own columns; start with all of them. */
  useEffect(() => {
    setChosenColumns((spec?.columns || []).map((c) => c.key));
  }, [spec]);

  const required = useMemo(
    () => new Set((spec?.columns || []).filter((c) => c.required).map((c) => c.key)),
    [spec]
  );

  const toggleColumn = (key) =>
    setChosenColumns((prev) => {
      if (required.has(key)) return prev;
      return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listImportSpecs();
        if (cancelled) return;
        setSpecs(data?.specs || []);
        setUnsupported(data?.unsupported || []);
        const wanted = String(initialDocType || '').toUpperCase();
        const known = (data?.specs || []).some((sp) => String(sp.docType).toUpperCase() === wanted);
        setDocType(known ? wanted : data?.specs?.[0]?.docType || '');
        setError('');
      } catch (e) {
        if (!cancelled) setError(String(e?.message || 'Could not load import types.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Any new file invalidates whatever was staged before it. */
  const resetRun = () => {
    setBatch(null);
    setIssues([]);
    setResult(null);
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    resetRun();
  };

  const onTemplate = async () => {
    setBusy(true);
    try {
      const text = await downloadTemplate(docType);
      /*
       * The server writes every column; the person asked for some of them. The
       * file is narrowed here rather than by a second server route, because
       * which columns somebody wants is a property of the moment, not of the
       * document type.
       */
      saveTextAsFile(narrowTemplate(text, chosenColumns), `${docType.toLowerCase()}-template.csv`);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not download the template.'));
    } finally {
      setBusy(false);
    }
  };

  const onStageAndValidate = async () => {
    setBusy(true);
    try {
      const staged = await stageImport({ docType, csv, fileName: fileName || null });
      const checked = await validateImport(staged.batch.id);
      setBatch(checked.batch);
      setIssues(checked.issues || []);
      setResult(null);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not read that file.'));
      setBatch(null);
    } finally {
      setBusy(false);
    }
  };

  const onCommit = async () => {
    setBusy(true);
    try {
      const done = await commitImport(batch.id);
      setResult(done);
      setBatch(done.batch);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not commit the import.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Import data"
        description="Files are checked before anything is written. You see every problem first, and rows that are fine still go through."
        actions={
          /* This screen is reached from a list's More menu, which navigates
             away from that list. Without a way back it was a dead end — the
             only exit was the navigation rail, which does not remember where
             you came from. */
          onBack ? (
            <button type="button" onClick={onBack} className="ui-btn ui-btn-secondary">
              <ChevronLeft size={16} aria-hidden="true" /> Back
            </button>
          ) : null
        }
      />

      {error ? (
        <div className="rounded-lg border border-[rgb(var(--neg)/0.35)] bg-[rgb(var(--neg-soft))] px-4 py-3 text-sm text-[rgb(var(--neg))]">{error}</div>
      ) : null}

      {!importsOn ? (
        <div
          role="status"
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgb(var(--accent-soft))', border: '1px solid rgb(var(--brand) / 0.25)' }}
        >
          <span className="ui-t-label block mb-0.5">Data import is switched off</span>
          Nothing here will write to the books until it is on. Switch it on under Settings → Features → Data,
          then come back.
        </div>
      ) : null}

      <div className="ui-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="ui-label" htmlFor="importcenter-what-are-you-importing">What are you importing?</label>
            <select id="importcenter-what-are-you-importing"
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value);
                resetRun();
              }}
              className="ui-select"
            >
              {specs.map((s) => (
                <option key={s.docType} value={s.docType}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setTemplateOpen(true)}
              disabled={busy || !docType}
              className="ui-btn ui-btn-secondary disabled:opacity-50"
            >
              <Download size={16} className="inline mr-1" /> Download template
            </button>
          </div>
          <div className="flex items-end">
            <label className="ui-btn ui-btn-secondary cursor-pointer">
              <FileUp size={16} className="inline mr-1" /> Choose CSV
              <input type="file" accept=".csv,text/csv" onChange={onPickFile} className="hidden" />
            </label>
          </div>
        </div>

        {spec ? <p className="text-sm ui-muted">{spec.description}</p> : null}

        {spec ? (
          <details className="text-sm">
            <summary className="cursor-pointer ui-muted">Columns this file needs</summary>
            <ul className="mt-2 space-y-1">
              {spec.columns.map((c) => (
                <li key={c.key}>
                  <code className="font-mono">{c.key}</code>
                  {c.required ? <span className="text-[rgb(var(--neg))]"> *</span> : null} — {c.hint}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div>
          <label className="ui-label">
            CSV content {fileName ? <span className="ui-muted">({fileName})</span> : null}
          </label>
          <textarea
            rows={8}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              resetRun();
            }}
            className="ui-input font-mono text-xs"
            placeholder="Paste the file here, or choose one above."
          />
        </div>

        <button
          type="button"
          onClick={onStageAndValidate}
          disabled={busy || !csv.trim() || !docType || !importsOn}
          title={importsOn ? undefined : 'Switch data import on under Settings → Features'}
          className="ui-btn ui-btn-primary disabled:opacity-50"
        >
          <Upload size={16} className="inline mr-1" /> {busy ? 'Checking…' : 'Check the file'}
        </button>
      </div>

      {/*
        Which columns the template carries, asked before it is written.
        A template with every column on it is a spreadsheet somebody has to
        prune before they can start, and the columns they do not need are the
        ones they fill in wrongly. The required ones cannot be turned off: a
        file without them cannot be checked, let alone imported.
      */}
      {templateOpen && spec ? (
        <Modal onClose={() => setTemplateOpen(false)} title={`Template — ${spec.label}`} maxWidthClass="max-w-2xl">
          <div className="space-y-4">
            <p className="text-sm ui-muted">
              Tick what the file should carry. {required.size} of {spec.columns.length} are required and always
              included.
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                onClick={() => setChosenColumns(spec.columns.map((c) => c.key))}
              >
                Select all
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                onClick={() => setChosenColumns(spec.columns.filter((c) => c.required).map((c) => c.key))}
              >
                Required only
              </button>
            </div>

            <ul className="grid gap-2 sm:grid-cols-2">
              {spec.columns.map((c) => (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="ui-checkbox mt-0.5"
                      checked={required.has(c.key) || chosenColumns.includes(c.key)}
                      disabled={required.has(c.key)}
                      onChange={() => toggleColumn(c.key)}
                      aria-label={`Include ${c.key} in the template`}
                    />
                    <span>
                      <code className="font-mono">{c.key}</code>
                      {c.required ? <span className="text-[rgb(var(--neg))]"> *</span> : null}
                      <span className="ui-muted"> — {c.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-2 pt-2" style={{ borderTop: '1px solid rgb(var(--border))' }}>
              <span className="ui-caption">
                {chosenColumns.length} of {spec.columns.length} columns
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTemplateOpen(false)} className="ui-btn ui-btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await onTemplate();
                    setTemplateOpen(false);
                  }}
                  className="ui-btn ui-btn-primary"
                >
                  <Download size={16} className="inline mr-1" /> Download
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {unsupported.length ? (
        <div className="ui-card p-4 text-sm">
          <h3 className="font-semibold mb-1">Not importable yet</h3>
          <ul className="space-y-1 ui-muted">
            {unsupported.map((u) => (
              <li key={u.docType}>
                <strong>{u.docType}</strong> — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {batch ? (
        <div className="ui-card p-4 space-y-3">
          <h3 className="font-medium">
            {batch.totalRows} row{batch.totalRows === 1 ? '' : 's'} read — {batch.validRows} ready,{' '}
            {batch.errorRows} with problems
          </h3>

          {issues.length ? (
            <div className="overflow-x-auto">
              <div className="flex items-center gap-2 mb-2 text-sm text-[rgb(var(--warn-ink))]">
                <AlertTriangle size={16} /> These rows will be skipped. Line numbers match the file.
              </div>
              <table className="ui-table w-full text-sm">
                <thead>
                  <tr className="text-left ui-muted">
                    <th className="px-3 py-2 w-24">Line</th>
                    <th className="px-3 py-2">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.slice(0, 200).map((i) => (
                    <tr key={i.rowNumber} className="border-t">
                      <td className="ui-col-meta px-3 py-2 tabular-nums">{i.rowNumber}</td>
                      <td className="ui-col-meta px-3 py-2">{i.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {issues.length > 200 ? (
                <p className="mt-2 text-xs ui-muted">Showing the first 200 of {issues.length} problems.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[rgb(var(--pos))] flex items-center gap-2">
              <CheckCircle2 size={16} /> No problems found.
            </p>
          )}

          <button
            type="button"
            onClick={onCommit}
            disabled={busy || batch.validRows === 0}
            className="ui-btn ui-btn-primary disabled:opacity-50"
          >
            {busy ? 'Importing…' : `Import ${batch.validRows} row${batch.validRows === 1 ? '' : 's'}`}
          </button>
          {batch.validRows === 0 ? (
            <p className="text-xs ui-muted">Nothing can be imported until at least one row is clean.</p>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-[rgb(var(--pos)/0.35)] bg-[rgb(var(--pos-soft))] px-4 py-3 text-sm text-[rgb(var(--pos))]">
          Imported {result.committed} row{result.committed === 1 ? '' : 's'}.
          {result.failures?.length ? (
            <ul className="mt-2 space-y-1 text-[rgb(var(--neg))]">
              {result.failures.map((f) => (
                <li key={f.group}>
                  {f.group}: {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
