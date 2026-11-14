import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload, ChevronLeft, Search, Eye, FileText, XCircle, Pencil } from 'lucide-react';

import {
  commitImport,
  downloadTemplate,
  listImportSpecs,
  listJournalImportSeries,
  stageImport,
  validateImport,
} from '../../api/imports';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { useFeatures } from '@ui/permissions/useFeatures';
import { setFeatures } from '@ui/api/features';
import Modal from '@ui/components/ui/Modal';
import Drawer from '@ui/components/ui/Drawer';
import { csvSafeValue, parseCsv, downloadCsv } from '@ui/utils/csv';
import { formatMoney } from '@ui/utils/money';
import { getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { createLedgerAccount, getLedgerAccounts } from '@ui/api/ledger';

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

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const journalColumn = (header) => {
  const key = String(header || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
  return { journal_no: 'entry_ref', ledger_name: 'account_name', ledger_code: 'account_code' }[key] || key;
};

export const updateImportLines = (csv, editedLines) => {
  const parsed = parseCsv(csv);
  const rows = parsed.rows.map((row) => ({ ...row }));
  for (const line of editedLines) {
    const index = Number(line.line) - 2;
    if (index < 0 || index >= rows.length) continue;
    for (const header of parsed.headers) {
      const key = header.toLowerCase().trim();
      if (Object.hasOwn(line.data, key)) rows[index][header] = String(line.data[key] ?? '');
    }
  }
  return [parsed.headers, ...rows.map((row) => parsed.headers.map((header) => row[header] ?? ''))]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
};

export const updateImportJournal = (csv, originalLines, fields, editedLines) => {
  const { headers, rows } = parseCsv(csv);
  const outputHeaders = editedLines.some((line) => line.data.description) && !headers.some((header) => journalColumn(header) === 'description')
    ? [...headers, 'Description'] : headers;
  const originalIndexes = new Set(originalLines.map((line) => Number(line.line) - 2));
  const firstIndex = Math.min(...originalIndexes);
  const journalRows = editedLines.map((line) => ({
    ...line.data,
    entry_ref: fields.entry_ref,
    transaction_series: fields.transaction_series,
    date: fields.date,
    narration: fields.narration,
  }));
  const remaining = rows.filter((_, index) => !originalIndexes.has(index));
  remaining.splice(firstIndex, 0, ...journalRows);
  return [outputHeaders, ...remaining.map((row) => outputHeaders.map((header) => row[header] ?? row[header.toLowerCase().trim()] ?? row[journalColumn(header)] ?? ''))]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
};

const isoDate = (value) => {
  const text = String(value || '').trim();
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text;
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

export const normalizeJournalTemplate = (text, chartLedgers = [], journalSeries = []) => {
  const columns = [
    ['Date', 'date'], ['Journal No', 'entry_ref'], ['Transaction series', 'transaction_series'],
    ['Ledger Name', 'account_name'], ['Ledger Code', 'account_code'], ['Debit', 'debit'],
    ['Credit', 'credit'], ['Description', 'description'], ['Narration', 'narration'],
  ];
  const rows = parseCsv(text).rows;
  const sample = rows.length ? rows : [
    { date: '2026-04-01', entry_ref: '1', account_code: '1200', debit: '5000.00', narration: 'Opening balance' },
    { date: '2026-04-01', entry_ref: '1', account_code: '4000', credit: '5000.00', narration: 'Opening balance' },
  ];
  const cash = chartLedgers.find((account) => String(account.name || '').trim().toLowerCase() === 'cash');
  const counterpart = chartLedgers.find((account) => account.id !== cash?.id && String(account.type || account.accountType || '').trim().toUpperCase() === 'INCOME');
  const sampleLedger = cash && counterpart ? [cash, counterpart] : null;
  const defaultSeries = journalSeries.find((series) => series.isDefault) || journalSeries[0];
  const valueFor = (row, key) => Object.entries(row).find(([header]) => journalColumn(header) === key)?.[1] || '';
  return [columns.map(([label]) => label), ...sample.map((row, index) => columns.map(([, key]) => {
    if (sampleLedger?.[index] && key === 'account_name') return String(sampleLedger[index].name || '');
    if (sampleLedger?.[index] && key === 'account_code') return String(sampleLedger[index].code || '');
    const value = valueFor(row, key);
    if (key === 'entry_ref') return /^JV[-_]/i.test(String(value)) ? '1' : String(value || '1');
    if (key === 'transaction_series') return String(defaultSeries?.name || value || 'Default');
    return String(value);
  }))].map((row) => row.map(csvCell).join(',')).join('\r\n');
};

export function buildImportReviewRows(csv, groupBy, issues, validated, failures = [], committed = false) {
  const groups = new Map();
  const problems = new Map(issues.map((issue) => [issue.rowNumber, issue.error]));
  parseCsv(csv).rows.forEach((raw, index) => {
    const data = Object.fromEntries(Object.entries(raw).map(([key, value]) => [journalColumn(key), value]));
    const number = data[groupBy] || `Line ${index + 2}`;
    if (!groups.has(number)) groups.set(number, { number, date: data.date || '', customer: data.customer_name || data.vendor_name || '', narration: data.narration || '', debit: 0, credit: 0, amount: 0, gst: 0, hasGst: false, remarks: [], lines: [] });
    const row = groups.get(number);
    const numeric = (value) => Number(String(value || '').replace(/[, ]/g, '')) || 0;
    const taxable = numeric(data.quantity) * numeric(data.rate) * (1 - numeric(data.discount_pct) / 100);
    row.amount += data.amount ? numeric(data.amount) : taxable;
    row.debit += numeric(data.debit);
    row.credit += numeric(data.credit);
    if (data.gst_rate !== undefined && data.gst_rate !== '') {
      row.gst += taxable * numeric(data.gst_rate) / 100;
      row.hasGst = true;
    }
    row.lines.push({ line: index + 2, data });
    if (problems.has(index + 2)) row.remarks.push(`Line ${index + 2}: ${problems.get(index + 2)}`);
  });
  return [...groups.values()].map((row) => {
    const failure = failures.find((item) => item.group === row.number);
    if (failure) row.remarks.push(failure.error);
    return { ...row, status: row.remarks.length ? 'Errors' : committed ? 'Imported' : validated ? 'Ready' : 'Needs Review' };
  });
}

export default function ImportCenter({ onBack = null, initialDocType = '', currentCompany = null, db = null }) {
  /*
   * Import is an opt-in feature, and the screen behaved as though it were not:
   * the file was pasted, checked, and only then did the server say the whole
   * thing was switched off. Say it before any of that work is done, and say
   * where to switch it on.
   */
  const { isEnabled, reload } = useFeatures();
  const importsOn = isEnabled('imports');
  const [specs, setSpecs] = useState([]);
  const [docType, setDocType] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');

  const [batch, setBatch] = useState(null);
  const [issues, setIssues] = useState([]);
  const [result, setResult] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const [reviewStatus, setReviewStatus] = useState('All');
  const [query, setQuery] = useState('');
  const [viewingRow, setViewingRow] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [editLines, setEditLines] = useState([]);
  const [journalFields, setJournalFields] = useState({ entry_ref: '', date: '', transaction_series: '', narration: '' });
  const [ledgerOptions, setLedgerOptions] = useState([]);
  const [journalSeries, setJournalSeries] = useState([]);
  const isJournal = String(docType).toUpperCase() === 'JOURNAL';
  const chartLedgers = useMemo(() => (db?.chartOfAccounts || []).filter((account) =>
    String(account.companyId) === String(currentCompany?.id) && account.active !== false && account.isActive !== false && !account.hiddenFromChart && String(account.name || '').trim()
  ), [db?.chartOfAccounts, currentCompany?.id]);
  const chartOptions = useMemo(() => chartLedgers.map((account) => ({ id: String(account.id), code: String(account.code || '').trim(), name: String(account.name).trim() })), [chartLedgers]);
  const documentLabel = isJournal ? 'journal entries' : String(specs.find((item) => item.docType === docType)?.label || 'documents').toLowerCase();
  const singularLabel = isJournal ? 'journal entry' : 'invoice';

  const invoiceCustomFields = useMemo(
    () => String(docType).toUpperCase() === 'INVOICE' ? getVisibleCustomFields(currentCompany, 'invoice') : [],
    [currentCompany, docType]
  );
  const spec = useMemo(() => {
    const base = specs.find((s) => s.docType === docType) || null;
    if (!base || !invoiceCustomFields.length) return base;
    return {
      ...base,
      columns: base.columns.concat(invoiceCustomFields.map((field) => ({
        key: `custom_${field.key}`,
        label: field.label,
        required: Boolean(field.required),
        hint: 'Invoice custom field',
        sample: '',
      }))),
    };
  }, [specs, docType, invoiceCustomFields]);
  const reviewRows = useMemo(() => buildImportReviewRows(csv, spec?.groupBy || 'invoice_no', issues, Boolean(batch), result?.failures || [], batch?.status === 'COMMITTED'), [csv, spec, issues, batch, result]);
  const reviewCounts = Object.fromEntries(['All', 'Ready', 'Needs Review', 'Errors', 'Imported'].map((status) => [status, status === 'All' ? reviewRows.length : reviewRows.filter((row) => row.status === status).length]));
  const visibleRows = reviewRows.filter((row) => (reviewStatus === 'All' || row.status === reviewStatus) && `${row.number} ${row.customer} ${row.narration} ${row.date} ${row.amount} ${row.debit} ${row.credit} ${row.remarks.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const postedNumberFor = (serial) => result?.postedJournals?.find((item) => item.serial === serial)?.number || '';

  /* A new document type brings its own columns; start with all of them. */
  useEffect(() => {
  }, [spec]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listImportSpecs();
        if (cancelled) return;
        setSpecs(data?.specs || []);
        const wanted = String(initialDocType || 'INVOICE').toUpperCase();
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

  useEffect(() => {
    if (!isJournal) return;
    let cancelled = false;
    listJournalImportSeries().then((series) => {
      if (cancelled) return;
      setJournalSeries(series);
    }).catch((e) => { if (!cancelled) setError(String(e?.message || 'Could not load journal series.')); });
    return () => { cancelled = true; };
  }, [isJournal]);

  /** Any new file invalidates whatever was staged before it. */
  const resetRun = () => {
    setBatch(null);
    setIssues([]);
    setResult(null);
  };

  const prepareJournalCsv = async (contents) => {
    if (!isJournal) return contents;
    const parsed = parseCsv(contents);
    const headers = parsed.headers.slice();
    const dateHeader = headers.find((header) => journalColumn(header) === 'date');
    const codeHeader = headers.find((header) => journalColumn(header) === 'account_code');
    const nameHeader = headers.find((header) => journalColumn(header) === 'account_name');
    const seriesHeader = headers.find((header) => journalColumn(header) === 'transaction_series');
    if (!codeHeader) headers.push('Ledger Code');
    if (!nameHeader) headers.push('Ledger Name');
    if (!seriesHeader) headers.push('Transaction series');
    const defaultSeries = journalSeries.find((series) => series.isDefault) || journalSeries[0];
    const matched = new Map();
    const matchedByRow = new Map();
    const serverCodes = new Map();
    const normal = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const rows = parsed.rows.map((row, index) => {
      const dated = dateHeader ? { ...row, [dateHeader]: isoDate(row[dateHeader]) } : { ...row };
      const chosenSeries = String(row[seriesHeader || ''] || '').trim();
      if (defaultSeries && (!chosenSeries || (chosenSeries.toLowerCase() === 'default' && !journalSeries.some((series) => series.name.toLowerCase() === 'default')))) {
        dated[seriesHeader || 'Transaction series'] = defaultSeries.name;
      }
      const code = String(row[codeHeader || ''] || '').trim();
      const name = String(row[nameHeader || ''] || '').trim();
      const byCode = code ? chartLedgers.find((account) => normal(account.code) === normal(code)) : null;
      const byName = name ? chartLedgers.find((account) => normal(account.name) === normal(name)) : null;
      if (name && chartLedgers.length && !byName) throw new Error(`Line ${index + 2}: Ledger name "${name}" is not in this company's chart of accounts`);
      if (byCode && byName && String(byCode.id) !== String(byName.id)) throw new Error(`Line ${index + 2}: Ledger name and code refer to different chart accounts`);
      const account = byCode || byName;
      if (!account) return dated;
      matched.set(String(account.id), account);
      matchedByRow.set(index, String(account.id));
      return { ...dated, [codeHeader || 'Ledger Code']: String(account.code || ''), [nameHeader || 'Ledger Name']: String(account.name || '') };
    });
    for (const account of matched.values()) {
      const type = String(account.type || account.accountType || '').trim().toUpperCase();
      const accountType = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].includes(type) ? type : 'ASSET';
      const group = (db?.accountGroups || []).find((item) => String(item.id) === String(account.groupId) && String(item.companyId) === String(currentCompany.id));
      const groupName = String(group?.name || '').trim().toLowerCase();
      const controlKind = groupName === 'cash-in-hand' ? 'CASH' : groupName === 'bank accounts' ? 'BANK' : undefined;
      const response = await createLedgerAccount({ code: String(account.code || '').trim(), name: String(account.name).trim(), accountType, controlKind, sourceKey: `coa-${currentCompany.id}-${account.id}` });
      if (account.code && normal(response?.account?.code) !== normal(account.code)) throw new Error(`Ledger ${account.name} could not be matched to its chart code ${account.code}`);
      serverCodes.set(String(account.id), String(response?.account?.code || '').trim());
    }
    rows.forEach((row, index) => {
      const linkedCode = serverCodes.get(matchedByRow.get(index));
      if (linkedCode) row[codeHeader || 'Ledger Code'] = linkedCode;
    });
    setLedgerOptions(chartOptions);
    // Send the API's canonical field names. The downloaded template keeps its
    // friendly headings, but older API workers only recognize these keys.
    const apiHeaders = headers.map(journalColumn);
    return [apiHeaders, ...rows.map((row) => headers.map((header) => row[header] ?? ''))].map((row) => row.map(csvCell).join(',')).join('\r\n');
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const contents = await file.text();
    resetRun();
    // The header button is the entry point: once a file is chosen, start the
    // same stage/validation pipeline immediately instead of showing another
    // intermediate upload card.
    setBusy(true);
    try {
      const prepared = await prepareJournalCsv(contents);
      setCsv(prepared);
      const staged = await stageImport({ docType, csv: prepared, fileName: file.name });
      const checked = await validateImport(staged.batch.id);
      setBatch(checked.batch);
      setIssues(checked.issues || []);
      setResult(null);
      setReviewStatus('All');
      setError('');
    } catch (err) {
      setError(String(err?.message || 'Could not read that file.'));
      setBatch(null);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
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
      // Templates are complete by design: users can fill the downloaded file
      // immediately without a second field-selection step.
      let template = text;
      if (String(docType).toUpperCase() === 'JOURNAL') template = normalizeJournalTemplate(template, chartLedgers, journalSeries);
      if (String(docType).toUpperCase() === 'INVOICE' && invoiceCustomFields.length) {
        const customHeaders = invoiceCustomFields.map((field) => csvSafeValue(`custom_${field.key}`));
        const customBlank = invoiceCustomFields.map(() => '');
        const lines = template.split(/\r?\n/);
        lines[0] = `${lines[0]},${customHeaders.join(',')}`;
        if (lines.length > 1) lines[1] = `${lines[1] || ''},${customBlank.join(',')}`;
        template = lines.join('\n');
      }
      const filename = String(docType).toUpperCase() === 'INVOICE'
        ? 'Sales invoice template.csv'
        : `${docType.toLowerCase()}-template.csv`;
      saveTextAsFile(template, filename);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not download the template.'));
    } finally {
      setBusy(false);
    }
  };

  const chooseImportFile = () => fileInputRef.current?.click();

  const beginCorrection = async (row) => {
    setEditingRow(row);
    setEditLines(row.lines.map((line) => ({ line: line.line, data: { ...line.data } })));
    setError('');
    if (isJournal) {
      setJournalFields({ entry_ref: row.number, date: isoDate(row.date), transaction_series: row.lines[0]?.data.transaction_series || '', narration: row.narration });
      try {
        if (db) setLedgerOptions(chartOptions);
        else { const response = await getLedgerAccounts(); setLedgerOptions(response?.accounts || []); }
      } catch (e) {
        setError(String(e?.message || 'Could not load ledger accounts.'));
      }
    }
  };

  const openJournalRow = async (row) => {
    if (row.status !== 'Imported') { beginCorrection(row); return; }
    setViewingRow(row);
    try {
      if (db) setLedgerOptions(chartOptions);
      else { const response = await getLedgerAccounts(); setLedgerOptions(response?.accounts || []); }
    } catch {
      setLedgerOptions([]);
    }
  };

  const saveCorrection = async () => {
    const corrected = isJournal
      ? updateImportJournal(csv, editingRow.lines, journalFields, editLines)
      : updateImportLines(csv, editLines);
    setBusy(true);
    try {
      const prepared = await prepareJournalCsv(corrected);
      const staged = await stageImport({ docType, csv: prepared, fileName: fileName || null });
      const checked = await validateImport(staged.batch.id);
      setCsv(prepared);
      setBatch(checked.batch);
      setIssues(checked.issues || []);
      setResult(null);
      setEditingRow(null);
      setReviewStatus('All');
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not validate the correction.'));
    } finally {
      setBusy(false);
    }
  };

  const changeJournalLine = (index, field, value) => {
    setEditLines((previous) => previous.map((line, lineIndex) => lineIndex === index
      ? { ...line, data: { ...line.data, [field]: value, ...(field === 'debit' && Number(value) > 0 ? { credit: '' } : {}), ...(field === 'credit' && Number(value) > 0 ? { debit: '' } : {}) } }
      : line));
  };

  const changeJournalLedger = (index, choice) => {
    const selected = ledgerOptions.find((account) => account.name === choice);
    setEditLines((previous) => previous.map((line, lineIndex) => lineIndex === index
      ? { ...line, data: { ...line.data, account_code: selected?.code || '', account_name: selected?.name || '' } }
      : line));
  };

  const journalDebit = editLines.reduce((sum, line) => sum + (Number(line.data.debit) || 0), 0);
  const journalCredit = editLines.reduce((sum, line) => sum + (Number(line.data.credit) || 0), 0);

  const onStageAndValidate = async () => {
    setBusy(true);
    try {
      const prepared = await prepareJournalCsv(csv);
      const staged = await stageImport({ docType, csv: prepared, fileName: fileName || null });
      setCsv(prepared);
      const checked = await validateImport(staged.batch.id);
      setBatch(checked.batch);
      setIssues(checked.issues || []);
      setResult(null);
      setError('');
      setReviewStatus('All');
    } catch (e) {
      setError(String(e?.message || 'Could not read that file.'));
      setBatch(null);
    } finally {
      setBusy(false);
    }
  };

  const onCommit = async () => {
    if (!batch || !reviewCounts.Ready || (isJournal && reviewCounts.Errors)) return;
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

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="import-center-page space-y-3">
      <PageHeader
        entity={isJournal ? 'journal' : 'invoice'}
        title="Import data"
        actions={
          /* This screen is reached from a list's More menu, which navigates
             away from that list. Without a way back it was a dead end — the
             only exit was the navigation rail, which does not remember where
             you came from. */
          <>
          {onBack ? (
            <button type="button" onClick={onBack} className="ui-btn ui-btn-secondary">
              <ChevronLeft size={16} aria-hidden="true" /> Back
            </button>
          ) : null}
          <button type="button" onClick={onTemplate} disabled={busy || !docType} className="ui-btn ui-btn-secondary"><Download size={16} /> Download Template</button>
          {batch && reviewCounts.Ready > 0 && (!isJournal || reviewCounts.Errors === 0) && batch.status !== 'COMMITTED' ? <button type="button" onClick={onCommit} disabled={busy} className="ui-btn ui-btn-primary">{busy ? 'Posting…' : isJournal ? `Post ${reviewCounts.Ready} Journals` : 'Import Ready Invoices'}</button> : null}
          <button type="button" onClick={chooseImportFile} disabled={busy || !docType || !importsOn} className={`ui-btn ${batch && reviewCounts.Ready > 0 && (!isJournal || reviewCounts.Errors === 0) && batch.status !== 'COMMITTED' ? 'ui-btn-secondary' : 'ui-btn-primary'}`}><Upload size={16} /> {isJournal ? 'Import Journals' : 'Import Invoices'}</button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onPickFile} className="hidden" aria-label={`Choose ${singularLabel} import file`} />
          </>
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
          Enable data import for this company to upload and validate {documentLabel}.
          <button type="button" className="ui-btn ui-btn-secondary mt-2" disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await setFeatures({ imports: true });
                await reload?.();
              } catch (e) {
                setError(String(e?.message || 'Could not enable data import.'));
              } finally {
                setBusy(false);
              }
            }}>
            {busy ? 'Enabling…' : 'Enable data import'}
          </button>
        </div>
      ) : null}

      <section className="import-kpi-grid" aria-label="Import summary">
        <div className="import-kpi import-kpi-blue"><i><FileText size={21} /></i><span>Total {documentLabel}</span><strong>{reviewCounts.All}</strong><small>{fileName || 'Upload a file to begin'}</small></div>
        <div className="import-kpi import-kpi-green"><i><CheckCircle2 size={21} /></i><span>{isJournal ? 'Ready to post' : 'Ready to import'}</span><strong>{reviewCounts.Ready}</strong><small>Validated {documentLabel}</small></div>
        <div className="import-kpi import-kpi-amber"><i><AlertTriangle size={21} /></i><span>Needs review</span><strong>{reviewCounts['Needs Review']}</strong><small>Awaiting validation</small></div>
        <div className="import-kpi import-kpi-red"><i><XCircle size={21} /></i><span>Errors</span><strong>{reviewCounts.Errors}</strong><small>{isJournal ? 'Correct before posting' : 'Invoices requiring correction'}</small></div>
      </section>
      <div className="import-review-workspace">
      <div className="import-review-toolbar">
        <div className="import-status-tabs" role="tablist" aria-label="Import status">
          {['All', 'Ready', 'Needs Review', 'Errors', ...(reviewCounts.Imported ? ['Imported'] : [])].map((status) => <button key={status} type="button" role="tab" aria-selected={reviewStatus === status} className={reviewStatus === status ? 'is-active' : ''} onClick={() => setReviewStatus(status)}>{status} <b>({reviewCounts[status]})</b></button>)}
        </div>
        <label className="import-review-search"><Search size={15} /><input type="search" className="ui-input" aria-label={`Search imported ${documentLabel}`} placeholder={isJournal ? 'Search journal no, date, narration…' : 'Search invoice no, customer, amount…'} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!visibleRows.length} onClick={() => downloadCsv({ fileName: isJournal ? 'Journal import review' : 'Invoice import review', columns: isJournal ? [{ key: 'number', label: 'Journal No' }, { key: 'date', label: 'Date' }, { key: 'narration', label: 'Narration' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }, { key: 'status', label: 'Status' }, { key: 'remarks', label: 'Remarks', value: (row) => row.remarks.join('; ') }] : [{ key: 'number', label: 'Invoice No' }, { key: 'date', label: 'Invoice Date' }, { key: 'customer', label: 'Customer' }, { key: 'amount', label: 'Amount' }, { key: 'status', label: 'Status' }, { key: 'remarks', label: 'Remarks', value: (row) => row.remarks.join('; ') }], rows: visibleRows })}><Download size={14} /> Export</button>
      </div>
      <div className="import-review-scroll">
        <table className={`ui-table ui-table-sticky import-review-table${isJournal ? ' is-journal' : ''}`}>
          <thead><tr><th scope="col">#</th><th scope="col">{isJournal ? 'Journal No.' : 'Invoice No (File)'}</th><th scope="col">{isJournal ? 'Date' : 'Invoice Date'}</th><th scope="col">{isJournal ? 'Narration' : 'Customer'}</th><th scope="col" className="ui-num">{isJournal ? 'Debit' : 'Amount'}</th><th scope="col" className="ui-num">{isJournal ? 'Credit' : 'GST Amount'}</th><th scope="col">Status</th><th scope="col">Remarks</th>{!isJournal ? <th scope="col">Actions</th> : null}</tr></thead>
          <tbody>
            {visibleRows.length ? visibleRows.map((row, index) => <tr key={row.number} className={isJournal ? 'import-journal-clickable' : ''} role={isJournal ? 'button' : undefined} tabIndex={isJournal ? 0 : undefined} aria-label={isJournal ? `${row.status === 'Imported' ? 'View' : 'Edit'} journal entry ${row.number}` : undefined} onClick={isJournal ? () => openJournalRow(row) : undefined} onKeyDown={isJournal ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openJournalRow(row); } } : undefined}>
              <td>{index + 1}</td><td><strong>{row.number}</strong><small className="import-row-file">{fileName || 'Pasted CSV'}</small></td><td>{row.date || '—'}</td><td>{(isJournal ? row.narration : row.customer) || '—'}</td>
              <td className="ui-num">{formatMoney(isJournal ? row.debit : row.amount, currentCompany)}</td><td className="ui-num">{isJournal ? formatMoney(row.credit, currentCompany) : row.hasGst ? formatMoney(row.gst, currentCompany) : '—'}</td>
              <td><span className="import-review-status" data-status={row.status}>{row.status}</span></td><td><span className="import-row-remark" title={row.remarks.join('; ')}>{row.remarks.join('; ') || (row.status === 'Needs Review' ? 'Check the file to validate' : '—')}</span></td>
              {!isJournal ? <td><div className="import-row-actions"><button type="button" className="ui-icon-btn" aria-label={`View ${singularLabel} ${row.number}`} onClick={() => setViewingRow(row)}><Eye size={16} /></button>{row.status !== 'Imported' ? <button type="button" className="ui-icon-btn" aria-label={`Correct ${singularLabel} ${row.number}`} onClick={() => beginCorrection(row)}><Pencil size={15} /></button> : null}</div></td> : null}
            </tr>) : <tr><td colSpan={isJournal ? 8 : 9}><div className="import-review-empty"><FileUp size={28} /><h2>{reviewRows.length ? `No ${documentLabel} match` : `No ${documentLabel} uploaded`}</h2></div></td></tr>}
          </tbody>
        </table>
      </div>
      </div>

      <Drawer open={false} onClose={() => {}} title="Import Invoices" widthClass="import-upload-drawer">
      <div className="ui-card import-upload-card p-4 space-y-3">
        <div className="import-section-heading">
          <div>
            <h2>Upload invoices</h2>
            <p>Upload a CSV file, review every row, and create sales invoices in bulk.</p>
          </div>
          <span className="import-file-badge">CSV import</span>
        </div>
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
              onClick={onTemplate}
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

        {spec ? <p className="import-help-text">{spec.description}</p> : null}

        {spec ? (
          <div className="import-fields-panel">
            <div className="import-fields-title">Invoice fields</div>
            <div className="import-fields-table">
              {spec.columns.map((c) => (
                <div className="import-field-chip" key={c.key}>
                  <strong>{c.label}</strong>{c.required ? <span aria-label="required">*</span> : null}
                  <small>{c.hint}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <label className="ui-label import-input-label">
            Import file {fileName ? <span className="ui-muted">· {fileName}</span> : null}
          </label>
          <textarea
            rows={8}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              resetRun();
            }}
            className="ui-input import-csv-input font-mono text-xs"
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
      </Drawer>

      {!isJournal && <Drawer open={Boolean(viewingRow)} onClose={() => setViewingRow(null)} title={`Invoice ${viewingRow?.number || ''}`} widthClass="import-upload-drawer">
        {viewingRow ? <div className="space-y-4"><p className="text-sm ui-muted">{viewingRow.date} · {viewingRow.status}</p>{viewingRow.remarks.length ? <p className="text-sm text-[rgb(var(--neg))]">{viewingRow.remarks.join('; ')}</p> : null}{viewingRow.lines.map((line) => <section key={line.line}><h3 className="text-sm font-semibold mb-2">File line {line.line}</h3><dl className="import-line-details">{Object.entries(line.data).filter(([, value]) => value).map(([key, value]) => <React.Fragment key={key}><dt>{spec?.columns.find((column) => column.key === key)?.label || key}</dt><dd>{value}</dd></React.Fragment>)}</dl></section>)}</div> : null}
      </Drawer>}

      {isJournal && viewingRow ? <Modal onClose={() => setViewingRow(null)} title={`Journal Entry ${viewingRow.number}`} maxWidthClass="max-w-5xl">
        <div className="import-journal-detail">
          <header><h3>{currentCompany?.name || 'Company'}</h3><strong>Journal Voucher</strong></header>
          <div className="import-journal-detail-meta"><div><span>Journal No.</span><strong>{postedNumberFor(viewingRow.number) || '—'}</strong></div><div><span>File serial</span><strong>{viewingRow.number}</strong></div><div><span>Date</span><strong>{viewingRow.date || '—'}</strong></div></div>
          <div className="import-journal-lines-wrap"><table className="ui-table import-journal-lines"><thead><tr><th>Ledger</th><th>Description</th><th className="ui-num">Debit</th><th className="ui-num">Credit</th></tr></thead><tbody>{viewingRow.lines.map((line) => <tr key={line.line}><td><strong>{line.data.account_name || ledgerOptions.find((account) => account.code === line.data.account_code)?.name || line.data.account_code || '—'}</strong>{line.data.account_code ? <small className="block ui-muted">{line.data.account_code}</small> : null}</td><td>{line.data.description || '—'}</td><td className="ui-num">{line.data.debit ? formatMoney(Number(line.data.debit), currentCompany) : '—'}</td><td className="ui-num">{line.data.credit ? formatMoney(Number(line.data.credit), currentCompany) : '—'}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total</th><th className="ui-num">{formatMoney(viewingRow.debit, currentCompany)}</th><th className="ui-num">{formatMoney(viewingRow.credit, currentCompany)}</th></tr></tfoot></table></div>
          <div className="import-journal-detail-narration"><span>Narration</span><p>{viewingRow.narration || '—'}</p></div>
        </div>
      </Modal> : null}

      {isJournal && editingRow ? <Modal onClose={() => setEditingRow(null)} title={`Edit Journal Entry ${editingRow.number}`} maxWidthClass="max-w-5xl" headerActions={<button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={saveCorrection}>{busy ? 'Checking…' : 'Save and validate'}</button>}>
        <div className="import-journal-editor">
          {error ? <div className="import-correction-error" role="alert">{error}</div> : null}
          {editingRow.remarks.length ? <div className="import-correction-error"><ul>{[...new Set(editingRow.remarks.flatMap((remark) => remark.replace(/^Line \d+: /, '').split('; ').map((message) => message.trim()).filter(Boolean)))].map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul></div> : null}
          <div className="import-journal-meta">
            <div className="import-journal-top-fields">
              <label className="ui-label">Journal No.<input className="ui-input w-full mt-1" value={journalFields.entry_ref} onChange={(event) => setJournalFields((previous) => ({ ...previous, entry_ref: event.target.value }))} /></label>
              <label className="ui-label">Date<input className="ui-input w-full mt-1" type="date" value={journalFields.date} onChange={(event) => setJournalFields((previous) => ({ ...previous, date: event.target.value }))} /></label>
              <label className="ui-label">Transaction series<select className="ui-select w-full mt-1" value={journalFields.transaction_series} onChange={(event) => setJournalFields((previous) => ({ ...previous, transaction_series: event.target.value }))}><option value="">Select series</option>{journalSeries.map((series) => <option key={series.id} value={series.name}>{series.name}</option>)}</select></label>
            </div>
            <label className="ui-label">Narration<input className="ui-input w-full mt-1" value={journalFields.narration} onChange={(event) => setJournalFields((previous) => ({ ...previous, narration: event.target.value }))} /></label>
          </div>
          <h3 className="ui-t-sec">Line Items</h3>
          <div className="import-journal-lines-wrap"><table className="ui-table import-journal-lines">
            <thead><tr><th>Ledger</th><th>Description</th><th className="ui-num">Debit</th><th className="ui-num">Credit</th><th aria-label="Actions" /></tr></thead>
            <tbody>{editLines.map((line, index) => <tr key={line.line || `new-${index}`}>
              <td><select className="ui-select w-full" aria-label={`Ledger, line ${index + 1}`} value={line.data.account_name || ledgerOptions.find((account) => account.code === line.data.account_code)?.name || ''} onChange={(event) => changeJournalLedger(index, event.target.value)}>
                <option value="">Select ledger</option>
                {line.data.account_name && !ledgerOptions.some((account) => account.name.trim().toLowerCase() === line.data.account_name.trim().toLowerCase()) ? <option value={line.data.account_name}>{line.data.account_name} (unmatched)</option> : null}
                {ledgerOptions.map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}
              </select></td>
              <td><input className="ui-input w-full" aria-label={`Description, line ${index + 1}`} value={line.data.description || ''} onChange={(event) => changeJournalLine(index, 'description', event.target.value)} placeholder="Line description" /></td>
              <td><input className="ui-input w-full text-right" aria-label={`Debit, line ${index + 1}`} type="number" min="0" step="0.01" value={line.data.debit || ''} onChange={(event) => changeJournalLine(index, 'debit', event.target.value)} /></td>
              <td><input className="ui-input w-full text-right" aria-label={`Credit, line ${index + 1}`} type="number" min="0" step="0.01" value={line.data.credit || ''} onChange={(event) => changeJournalLine(index, 'credit', event.target.value)} /></td>
              <td><button type="button" className="ui-icon-btn" disabled={editLines.length <= 2} aria-label={`Remove line ${index + 1}`} onClick={() => setEditLines((previous) => previous.filter((_, lineIndex) => lineIndex !== index))}><XCircle size={16} /></button></td>
            </tr>)}</tbody>
          </table></div>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditLines((previous) => [...previous, { line: 0, data: { account_code: '', debit: '', credit: '', description: '' } }])}>+ Add Line</button>
          <div className="import-journal-totals"><div><span>Total Dr</span><strong>{formatMoney(journalDebit, currentCompany)}</strong></div><div><span>Total Cr</span><strong>{formatMoney(journalCredit, currentCompany)}</strong></div><div><span>Difference</span><strong>{formatMoney(Math.abs(journalDebit - journalCredit), currentCompany)}</strong></div></div>
        </div>
      </Modal> : null}

      {!isJournal && <Drawer open={Boolean(editingRow)} onClose={() => setEditingRow(null)} title={`Correct ${singularLabel} ${editingRow?.number || ''}`} widthClass="import-upload-drawer">
        {editingRow ? <div className="import-correction space-y-3">
          {error ? <div className="import-correction-error" role="alert">{error}</div> : null}
          {editingRow.remarks.length ? <div className="import-correction-error">{editingRow.remarks.join('; ')}</div> : null}
          {editLines.map((line, index) => <section key={line.line} className="import-correction-line">
            <h3 className="ui-t-label mb-2">Line {index + 1}</h3>
            <div className="import-correction-fields">
              {(spec?.columns || []).map((column) => <label key={column.key} className="ui-label">
                {column.label}{column.required ? ' *' : ''}
                <input
                  className="ui-input w-full mt-1"
                  type="text"
                  value={line.data[column.key] ?? ''}
                  placeholder={column.key === 'date' ? 'YYYY-MM-DD' : undefined}
                  onChange={(event) => setEditLines((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, data: { ...item.data, [column.key]: event.target.value } } : item))}
                />
              </label>)}
            </div>
          </section>)}
          <div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditingRow(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={saveCorrection}>{busy ? 'Checking…' : 'Save and validate'}</button></div>
        </div> : null}
      </Drawer>}


      {result ? (
        <div className="rounded-lg border border-[rgb(var(--pos)/0.35)] bg-[rgb(var(--pos-soft))] px-4 py-3 text-sm text-[rgb(var(--pos))]">
          {isJournal ? `Posted ${result.postedJournals?.length || 0} journal entr${result.postedJournals?.length === 1 ? 'y' : 'ies'}.` : `Imported ${result.committed} row${result.committed === 1 ? '' : 's'}.`}
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
