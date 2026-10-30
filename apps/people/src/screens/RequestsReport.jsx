import React, { useMemo, useState } from 'react';
import { Download } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { formsReport, formsReportCsvPath, listForms } from '../api/requests';

/*
 * Requests report (FEATURE-UI-AUDIT gap 25): every request of the types HR
 * set up, in a period — who asked, what they wrote, where it stands, how many
 * working days it took — and a line per type. Export for a spreadsheet.
 */
const STATUS = { WAITING: 'Waiting', MORE_INFO: 'Asked for more', APPROVED: 'Approved', REJECTED: 'Not approved', WITHDRAWN: 'Withdrawn' };
const TONE = { WAITING: 'warn', MORE_INFO: 'warn', APPROVED: 'pos', REJECTED: 'neg', WITHDRAWN: 'neutral' };
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10)) : '');
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;

export default function RequestsReport({ params = {}, updateParams }) {
  const p = params || {};
  const set = (patch) => updateParams?.(patch, { push: false });
  const q = { formId: p.formId || '', status: p.status || '', from: p.from || firstOfYear(), to: p.to || '' };
  const forms = useRequest(() => listForms().then((r) => r.forms).catch(() => []), []);
  const report = useRequest(() => formsReport(q), [q.formId, q.status, q.from, q.to]);
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const rows = useMemo(() => report.data?.rows || [], [report.data]);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const text = await apiFetch(formsReportCsvPath(q), { skipWarehouseHeader: true, asText: true });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `requests-${q.from}${q.to ? `-to-${q.to}` : ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify.error(String(e?.message || 'Not exported.'));
    } finally {
      setExporting(false);
    }
  };

  const summaryColumns = [
    { key: 'name', label: 'Request', always: true, render: (s) => <span className="font-medium">{s.formName}</span> },
    { key: 'total', label: 'Asked', align: 'right', render: (s) => <span className="tabular-nums">{s.total}</span> },
    { key: 'waiting', label: 'Waiting', align: 'right', render: (s) => <span className="tabular-nums">{s.waiting}</span> },
    { key: 'overdue', label: 'Overdue', align: 'right', render: (s) => <span className={`tabular-nums ${s.overdue ? 'ui-text-warn' : ''}`}>{s.overdue}</span> },
    { key: 'approved', label: 'Approved', align: 'right', render: (s) => <span className="tabular-nums">{s.approved}</span> },
    { key: 'rejected', label: 'Not approved', align: 'right', render: (s) => <span className="tabular-nums">{s.rejected}</span> },
    { key: 'avg', label: 'Days to decide', align: 'right', render: (s) => <span className="tabular-nums">{s.averageDaysToDecide ?? '—'}</span> },
  ];
  const rowColumns = [
    { key: 'person', label: 'Person', always: true, render: (r) => (
      <span className="min-w-0">
        <span className="block truncate font-medium">{r.employeeName || '—'}</span>
        {r.employeeCode ? <span className="block truncate ui-caption">{r.employeeCode}</span> : null}
      </span>
    ) },
    { key: 'form', label: 'Request', render: (r) => r.formName },
    { key: 'answers', label: 'Answers', render: (r) => <span className="block max-w-sm truncate" title={r.lines.map((l) => `${l.label}: ${l.value}`).join('\n')}>{r.lines.map((l) => l.value).join(' · ')}</span> },
    { key: 'asked', label: 'Asked', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.askedAt)}</span> },
    { key: 'status', label: 'Status', render: (r) => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className={`ui-pill ui-pill-${TONE[r.status] || 'neutral'}`}>{STATUS[r.status] || r.status}</span>
        {r.overdue ? <span className="ui-pill ui-pill-neg">Overdue</span> : null}
      </span>
    ) },
    { key: 'days', label: 'Days to decide', align: 'right', render: (r) => <span className="tabular-nums">{r.daysToDecide ?? ''}</span> },
  ];
  const formOptions = [{ value: '', label: 'Every request type' }, ...(forms.data || []).map((f) => ({ value: f.id, label: f.name }))];
  const statusOptions = [{ value: '', label: 'Any status' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Reports' }]}
        title="Requests report"
        actions={<button type="button" className="ui-btn ui-btn-primary" disabled={exporting || !rows.length} onClick={exportCsv}><Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export'}</button>}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Request type" value={q.formId} onChange={(v) => set({ formId: v || null, page: null })} options={formOptions} placeholder="Every request type" /></div>
        <div className="w-full sm:w-44"><PopupSelect showValueSubtext={false} ariaLabel="Status" value={q.status} onChange={(v) => set({ status: v || null, page: null })} options={statusOptions} placeholder="Any status" /></div>
        <div className="w-[calc(50%-0.375rem)] sm:w-40"><span className="ui-label" id="rr-from">From</span><DatePicker label="From" describedBy="rr-from" value={q.from} onChange={(v) => set({ from: v || null, page: null })} /></div>
        <div className="w-[calc(50%-0.375rem)] sm:w-40"><span className="ui-label" id="rr-to">To</span><DatePicker label="To" describedBy="rr-to" value={q.to} onChange={(v) => set({ to: v || null, page: null })} /></div>
      </div>

      {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : (
        <>
          <DataTable
            label="By request type"
            columns={summaryColumns}
            rows={report.data?.summary || []}
            rowKey={(s) => s.formId}
            total={(report.data?.summary || []).length}
            page={1}
            pageSize={100}
            noun="request types"
            loading={report.loading}
            refreshing={report.refreshing}
            card={(s) => (
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{s.formName}</span><span className="tabular-nums">{s.total}</span></span>
                <span className="block ui-caption tabular-nums">{s.waiting} waiting · {s.approved} approved · {s.averageDaysToDecide ?? '—'} days to decide</span>
              </span>
            )}
            empty={<EmptyState title="No request types yet" description="Set them up in Settings → Request types." />}
          />
          <DataTable
            label="Requests"
            columns={rowColumns}
            rows={rows.slice((page - 1) * size, page * size)}
            rowKey={(r) => r.id}
            total={rows.length}
            page={page}
            pageSize={size}
            noun="requests"
            onPage={(n) => set({ page: n > 1 ? n : null })}
            onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
            loading={report.loading}
            refreshing={report.refreshing}
            card={(r) => (
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.employeeName}</span><span className={`ui-pill ui-pill-${TONE[r.status] || 'neutral'}`}>{STATUS[r.status] || r.status}</span></span>
                <span className="block truncate ui-caption">{r.formName} · {day(r.askedAt)}</span>
                <span className="block truncate ui-caption">{r.lines.map((l) => l.value).join(' · ')}</span>
              </span>
            )}
            empty={<EmptyState kind={q.formId || q.status ? 'filtered' : undefined} title="No requests in this period" onClearFilters={q.formId || q.status ? () => set({ formId: null, status: null, page: null }) : undefined} />}
          />
        </>
      )}
    </div>
  );
}
