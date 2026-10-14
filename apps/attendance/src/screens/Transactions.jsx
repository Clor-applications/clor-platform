import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { listDevices, listEmployees, listTransactions, todayIst } from '../api/attendance';

/**
 * Every punch exactly as a reader sent it — before it is paired into a day.
 * Where to look when a day seems wrong: was the punch made, on which reader,
 * how was it verified, whose ID was it? (ClorTime's Transaction view.)
 */
export default function Transactions() {
  const [filters, setFilters] = useState({ from: todayIst(), to: todayIst(), employeeId: '', deviceId: '', unmatched: '' });
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [devices, setDevices] = useState([]);

  const load = useCallback(() => {
    listTransactions(filters).then(setData).catch((e) => notify.error(String(e?.message || 'Could not load transactions.')));
  }, [filters]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    listEmployees().then(setPeople).catch(() => setPeople([]));
    listDevices().then((r) => setDevices(r?.devices || [])).catch(() => setDevices([]));
  }, []);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Transactions"
        description="Every punch as the readers sent it, before it becomes a day."
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            disabled={!data?.transactions?.length}
            onClick={() =>
              downloadCsv({
                fileName: `Transactions ${filters.from} to ${filters.to}`,
                columns: [
                  { key: 'localTime', label: 'Time' },
                  { key: 'pin', label: 'Reader ID' },
                  { key: 'employeeCode', label: 'Employee ID' },
                  { key: 'employeeName', label: 'Name' },
                  { key: 'kind', label: 'Direction', value: (r) => r.kind || 'Not given' },
                  { key: 'state', label: 'Punch state' },
                  { key: 'verify', label: 'Verified by' },
                  { key: 'deviceName', label: 'Reader' },
                  { key: 'shiftDate', label: 'Counted on day' },
                ],
                rows: data.transactions,
              })
            }
          >
            <Download size={16} aria-hidden="true" /> Export
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="ui-input !w-auto" value={filters.from} max={filters.to} onChange={set('from')} aria-label="From" />
        <input type="date" className="ui-input !w-auto" value={filters.to} max={todayIst()} onChange={set('to')} aria-label="To" />
        <select className="ui-select !w-auto" value={filters.employeeId} onChange={set('employeeId')} aria-label="Employee" disabled={filters.unmatched === 'true'}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="ui-select !w-auto" value={filters.deviceId} onChange={set('deviceId')} aria-label="Reader">
          <option value="">All readers</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="ui-checkbox" checked={filters.unmatched === 'true'} onChange={(e) => setFilters((f) => ({ ...f, unmatched: e.target.checked ? 'true' : '' }))} /> Unmatched only
        </label>
      </div>
      {!data ? (
        <SkeletonCard lines={6} />
      ) : !data.transactions.length ? (
        <EmptyState title="No punches" description="No reader sent a punch in this range." />
      ) : (
        <div className="ui-card overflow-hidden">
          {data.truncated ? <p className="ui-caption px-4 pt-3">Showing the latest {data.transactions.length} of {data.total}. Narrow the dates or export to see the rest.</p> : null}
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Time</th>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Reader ID</th>
                  <th scope="col" className="ui-th ui-col-h-center">Direction</th>
                  <th scope="col" className="ui-th">Verified by</th>
                  <th scope="col" className="ui-th">Reader</th>
                  <th scope="col" className="ui-th">Counted on</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap tabular-nums">{t.localTime}</td>
                    <td className="ui-col-entity">{t.employeeName || <span className="ui-caption" style={{ color: 'rgb(var(--warn-ink))' }}>unmatched</span>}</td>
                    <td className="font-mono">{t.pin}</td>
                    <td className="ui-col-h-center">
                      {t.kind ? <span className={`ui-pill ${t.kind === 'IN' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{t.kind}</span> : <span className="ui-caption" title={`Punch state ${t.state}`}>—</span>}
                    </td>
                    <td>{t.verify}</td>
                    <td>{t.deviceName}</td>
                    <td className="ui-col-meta whitespace-nowrap">{t.shiftDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
