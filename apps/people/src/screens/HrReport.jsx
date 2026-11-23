import { errorWords } from '@ui/utils/errorWords';
import { moneyCell } from '@ui/utils/money';
import React, { useEffect, useState } from 'react';
import RangePresets from '@ui/components/ui/RangePresets';
import { Download, Printer } from '@ui/components/ui/lineIcons';

import ListHeader from '@ui/components/list/ListHeader';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { SlowNote } from '@ui/picks/round60';
import { notify } from '@ui/components/ui/notify';
import ReportChart from '../components/ReportChart';
import ReportViews from '../components/ReportViews';
import { hrReportCsv, listHrReports, runHrReport } from '../api/hrReports';
import { withWomenShare } from './womenShare';
import { ColumnName, RowsMore, noteRecentReport, printReport, reportHeaderLines, shapeRows, signedFigure, useRowShape, withHeaderLines } from '@ui/picks/round63';

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
/* What a saved view keeps: the dates and grouping the reader set, and the filters. */
const VIEW_KEYS = ['from', 'to', 'by', ...FILTER_KEYS];

/** A cell as the reader sees it: dates in the house format, a rate with its sign, nothing as a dash. */
function shown(col, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (col.kind === 'date') return formatDate(String(value).slice(0, 10)) || String(value);
  if (col.kind === 'pct' && typeof value === 'number') return `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`;
  /* Money in a table: ₹, Indian grouping, two decimals, a true minus (DESIGN.md); zero reads "—". */
  if (col.kind === 'money' && typeof value === 'number') return moneyCell(value);
  /* Round 63 "negformat" A: a minus figure reads "−1,200", the sign before the figure (red: cellClass). */
  if (typeof value === 'number') return signedFigure(value).text;
  return String(value);
}
const cellClass = (col, value) => [col.align === 'right' ? 'text-right' : '', typeof value === 'number' || col.kind === 'date' || col.align === 'right' ? 'tabular-nums whitespace-nowrap' : '', typeof value === 'string' && col.align === 'right' ? 'ui-muted' : '', typeof value === 'number' && value < 0 ? 'ui-neg-figure' : ''].filter(Boolean).join(' ');

/** A date in the toolbar with its word beside it, so From and To are told apart at a glance. */
function DateField({ word, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="ui-caption" aria-hidden="true">{word}</span>
      <div className="w-40"><DatePicker label={word} value={value} onChange={onChange} /></div>
    </div>
  );
}

export default function HrReport({ params = {}, updateParams, openScreen, tenant, user }) {
  const p = params || {};
  const id = String(p.report || 'headcount');
  /* Changing a date or filter leaves the saved view behind, so its name comes off the button. */
  const set = (patch) => updateParams?.(p.view && !('view' in patch) ? { ...patch, view: null } : patch, { push: false });
  const applyView = (v) => set({ ...Object.fromEntries(VIEW_KEYS.map((k) => [k, v.filters?.[k] || null])), view: v.id });
  const catalogue = useRequest(() => listHrReports(), []);
  const spec = catalogue.data?.reports?.find((r) => r.id === id) || null;
  const q = { from: p.from || '', to: p.to || '', by: p.by || '', departmentId: p.departmentId || '', branchId: p.branchId || '', employeeTypeId: p.employeeTypeId || '', gradeId: p.gradeId || '' };
  const report = useRequest(() => runHrReport(id, q), [id, q.from, q.to, q.by, q.departmentId, q.branchId, q.employeeTypeId, q.gradeId]);
  const d = withWomenShare(report.data);
  const [exporting, setExporting] = useState(false);
  const filtered = FILTER_KEYS.some((k) => q[k]);
  const shape = useRowShape();
  /* Round 63 "reportrecent" A: this report and its period go on top of the reports page next time. */
  useEffect(() => { if (d?.id) noteRecentReport({ id, from: d.from || '', to: d.to || '' }); }, [id, d?.id, d?.from, d?.to]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const text = await hrReportCsv(id, q);
      /* Round 63 "reportheader" A: the file says whose it is, which report, the period, the filters, and when and by whom. */
      const filterWords = FILTERS.filter(([key]) => q[key]).map(([key, list, label]) => `${label}: ${(lists[list] || []).find((o) => o.id === q[key])?.name || q[key]}`);
      const lines = reportHeaderLines({ company: tenant?.name || '', report: title, from: d?.from || '', to: d?.to || '', filters: filterWords, by: user?.fullName || user?.name || '' });
      const url = URL.createObjectURL(new Blob([withHeaderLines(text, lines)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}-${d?.from ? `${d.from}-to-` : ''}${d?.to || ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify.error(errorWords(e, 'export the rows'));
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
          <RangePresets from={q.from || d?.from || ''} to={q.to || d?.to || ''} onPick={(f, t) => set({ from: f, to: t })} />
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
        breadcrumb={[{ label: 'People' }, { label: 'All reports', onClick: openScreen ? () => openScreen('reportsHome') : undefined }, { label: title }]}
        title={title}
        description={spec?.description || null}
        entity="report"
        primary={<button type="button" className="ui-btn ui-btn-primary" disabled={exporting || !d?.rows?.length} onClick={exportCsv} title="Download these rows as a CSV file, which opens in Excel"><Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export'}</button>}
        secondary={d?.rows?.length ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => printReport(() => shape.setShowAll(true))} title="Print or save as PDF: landscape, headings on every page"><Printer size={16} aria-hidden="true" /> Print</button> : null}
        toolbar={toolbar}
        toolbarEnd={<ReportViews report={id} current={Object.fromEntries(VIEW_KEYS.filter((k) => p[k]).map((k) => [k, p[k]]))} activeId={p.view || ''} onApply={applyView} />}
      />
      {report.error && !d ? <ErrorState error={report.error} onRetry={report.reload} body={report.error?.status === 403 ? 'This report is not open to your role.' : undefined} />
        : !d ? <><SlowNote busy /><SkeletonCard lines={8} /></>
          : !d.rows.length ? <EmptyState kind={filtered ? 'filtered' : undefined} title="Nothing in this period" description={filtered ? 'No one matches these filters.' : 'Change the dates to look further back or ahead.'} onClearFilters={filtered ? () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))) : undefined} />
            : (
              <>
                {d.chart ? <ReportChart chart={d.chart} label={title} /> : null}
                <ReportTable d={d} title={title} shape={shape} openScreen={openScreen} />
                {d.notes?.length ? <ul className="space-y-1">{d.notes.map((n) => <li key={n} className="ui-caption">{n}</li>)}</ul> : null}
              </>
            )}
    </div>
  );
}

/*
 * The report's table (round 63): column names explain themselves on hover or tap, all-zero rows wait
 * behind "Show N with none", the first 20 rows show with the count, the totals row stays in sight at the
 * bottom, and a person's name opens the people list on them (the report carries the employee ID, not
 * the record, so the list finds them in one step).
 */
function ReportTable({ d, title, shape, openScreen }) {
  const { visible, hiddenZero, total, more } = shapeRows(d.rows, d.columns, { showZero: shape.showZero, showAll: shape.showAll });
  const person = d.columns.some((c) => c.key === 'name') && d.columns.some((c) => c.key === 'code');
  const nameCell = (c, row) => {
    if (!(person && c.key === 'name' && openScreen && row.name && (row.code || row.name))) return shown(c, row[c.key]);
    return <button type="button" className="ui-link text-left" onClick={() => openScreen('employees', { q: String(row.code || row.name) })} title="Find them in People">{shown(c, row[c.key])}</button>;
  };
  return (
    <div className="ui-report-print space-y-2">
      <div className="ui-table-scroll ui-report-scroll">
        <table className="ui-table ui-report-table w-full" aria-label={title}>
          <thead><tr>{d.columns.map((c) => <th key={c.key} scope="col" className={c.align === 'right' ? 'text-right' : ''}><ColumnName label={c.label} help={c.help} /></th>)}</tr></thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i}>
                {d.columns.map((c, n) => (n === 0
                  ? <th key={c.key} scope="row" className="font-normal text-left whitespace-nowrap">{nameCell(c, row)}</th>
                  : <td key={c.key} className={cellClass(c, row[c.key])}>{nameCell(c, row)}</td>))}
              </tr>
            ))}
          </tbody>
          {d.totals ? (
            <tfoot>
              <tr className="font-semibold">
                {d.columns.map((c, n) => (n === 0
                  ? <th key={c.key} scope="row" className="text-left whitespace-nowrap">{shown(c, d.totals[c.key])}</th>
                  : <td key={c.key} className={cellClass(c, d.totals[c.key])}>{d.totals[c.key] === undefined ? '' : shown(c, d.totals[c.key])}</td>))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <RowsMore hiddenZero={hiddenZero} more={more} total={total} shownCount={visible.length} person={person} onShowZero={() => shape.setShowZero(true)} onShowAll={() => shape.setShowAll(true)} />
    </div>
  );
}
