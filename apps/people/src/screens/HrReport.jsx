import React, { useState } from 'react';
import { Download } from '@ui/components/ui/lineIcons';

import ListHeader from '@ui/components/list/ListHeader';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import ReportChart from '../components/ReportChart';
import { hrReportCsv, listHrReports, runHrReport } from '../api/hrReports';

/*
 * One People report, full page (platform audit, 11 Nov 2026): the filters on
 * one line, one chart, the table, and Export as the screen's one action. The
 * server works the report out (services/people/reports.ts) and hands back
 * columns, rows, a totals line and the chart; this screen draws whichever
 * report `params.report` names. The file is the same rows, built by the
 * server from the same filters.
 */
const GROUPINGS = [['department', 'Department'], ['branch', 'Branch'], ['employmentType', 'Employment type'], ['grade', 'Grade']];
const FILTERS = [
  ['departmentId', 'departments', 'Department', 'Every department'],
  ['branchId', 'branches', 'Branch', 'Every branch'],
  ['employeeTypeId', 'employeeTypes', 'Employment type', 'Every employment type'],
  ['gradeId', 'grades', 'Grade', 'Every grade'],
];
const FILTER_KEYS = FILTERS.map(([k]) => k);

/** A cell as the reader sees it: dates in the house format, a rate with its sign, nothing as a dash. */
function shown(col, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.kind === 'date') return formatDate(String(value).slice(0, 10)) || String(value);
  if (col.kind === 'pct' && typeof value === 'number') return `${value.toFixed(1)}%`;
  return String(value);
}
const cellClass = (col, value) => [col.align === 'right' ? 'text-right' : '', typeof value === 'number' || col.kind === 'date' || col.align === 'right' ? 'tabular-nums whitespace-nowrap' : '', typeof value === 'string' && col.align === 'right' ? 'ui-muted' : ''].filter(Boolean).join(' ');

/** A date in the toolbar with its word beside it, so From and To are told apart at a glance. */
function DateField({ word, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="ui-caption" aria-hidden="true">{word}</span>
      <div className="w-40"><DatePicker label={word} value={value} onChange={onChange} /></div>
    </div>
  );
}

export default function HrReport({ params = {}, updateParams, openScreen }) {
  const p = params || {};
  const id = String(p.report || 'headcount');
  const set = (patch) => updateParams?.(patch, { push: false });
  const catalogue = useRequest(() => listHrReports(), []);
  const spec = catalogue.data?.reports?.find((r) => r.id === id) || null;
  const q = { from: p.from || '', to: p.to || '', by: p.by || '', departmentId: p.departmentId || '', branchId: p.branchId || '', employeeTypeId: p.employeeTypeId || '', gradeId: p.gradeId || '' };
  const report = useRequest(() => runHrReport(id, q), [id, q.from, q.to, q.by, q.departmentId, q.branchId, q.employeeTypeId, q.gradeId]);
  const d = report.data;
  const [exporting, setExporting] = useState(false);
  const filtered = FILTER_KEYS.some((k) => q[k]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const text = await hrReportCsv(id, q);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}-${d?.from ? `${d.from}-to-` : ''}${d?.to || ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify.error(String(e?.message || 'Not exported.'));
    } finally {
      setExporting(false);
    }
  };

  const lists = catalogue.data?.filters || {};
  const dates = spec?.dates || (d && !d.from ? 'day' : 'days');
  const groupings = [...(id === 'movement' ? [['month', 'Month']] : []), ...GROUPINGS.filter(([k]) => k === 'department' || (lists[{ branch: 'branches', employmentType: 'employeeTypes', grade: 'grades' }[k]] || []).length)];
  const toolbar = (
    <>
      {dates === 'day' ? <DateField word="As of" value={q.to || d?.to || ''} onChange={(v) => set({ to: v || null })} /> : (
        <>
          <DateField word="From" value={q.from || d?.from || ''} onChange={(v) => set({ from: v || null })} />
          <DateField word="To" value={q.to || d?.to || ''} onChange={(v) => set({ to: v || null })} />
        </>
      )}
      {spec?.by && groupings.length > 1 ? (
        <div className="w-48"><PopupSelect showValueSubtext={false} ariaLabel="Group by" value={q.by || d?.by || groupings[0][0]} onChange={(v) => set({ by: v || null })} options={groupings.map(([value, label]) => ({ value, label: `By ${label.toLowerCase()}` }))} /></div>
      ) : null}
      {FILTERS.map(([key, list, label, all]) => ((lists[list] || []).length ? (
        <div key={key} className="w-48"><PopupSelect showValueSubtext={false} ariaLabel={label} value={q[key]} onChange={(v) => set({ [key]: v || null })} options={[{ value: '', label: all }, ...lists[list].map((o) => ({ value: o.id, label: o.name }))]} placeholder={all} /></div>
      ) : null))}
    </>
  );

  const title = d?.title || spec?.name || 'Report';
  return (
    <div className="space-y-4 pb-8">
      <ListHeader
        breadcrumb={[{ label: 'People' }, { label: 'Reports', onClick: openScreen ? () => openScreen('reportsHome') : undefined }, { label: title }]}
        title={title}
        description={spec?.description || null}
        entity="report"
        primary={<button type="button" className="ui-btn ui-btn-primary" disabled={exporting || !d?.rows?.length} onClick={exportCsv} title="Download these rows as a CSV file, which opens in Excel"><Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export'}</button>}
        toolbar={toolbar}
      />
      {report.error && !d ? <ErrorState error={report.error} onRetry={report.reload} body={report.error?.status === 403 ? 'This report is not open to your role.' : undefined} />
        : !d ? <SkeletonCard lines={8} />
          : !d.rows.length ? <EmptyState kind={filtered ? 'filtered' : undefined} title="Nothing in this period" description={filtered ? 'No one matches these filters.' : 'Change the dates to look further back or ahead.'} onClearFilters={filtered ? () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))) : undefined} />
            : (
              <>
                {d.chart ? <ReportChart chart={d.chart} label={title} /> : null}
                <div className="ui-table-scroll">
                  <table className="ui-table w-full" aria-label={title}>
                    <thead><tr>{d.columns.map((c) => <th key={c.key} scope="col" className={c.align === 'right' ? 'text-right' : ''}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {d.rows.map((row, i) => (
                        <tr key={i}>
                          {d.columns.map((c, n) => (n === 0
                            ? <th key={c.key} scope="row" className="font-normal text-left whitespace-nowrap">{shown(c, row[c.key])}</th>
                            : <td key={c.key} className={cellClass(c, row[c.key])}>{shown(c, row[c.key])}</td>))}
                        </tr>
                      ))}
                    </tbody>
                    {d.totals ? (
                      <tfoot>
                        <tr className="font-medium">
                          {d.columns.map((c, n) => (n === 0
                            ? <th key={c.key} scope="row" className="text-left whitespace-nowrap">{shown(c, d.totals[c.key])}</th>
                            : <td key={c.key} className={cellClass(c, d.totals[c.key])}>{d.totals[c.key] === undefined ? '' : shown(c, d.totals[c.key])}</td>))}
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
                {d.notes?.length ? <ul className="space-y-1">{d.notes.map((n) => <li key={n} className="ui-caption">{n}</li>)}</ul> : null}
              </>
            )}
    </div>
  );
}
