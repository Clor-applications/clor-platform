import React, { useCallback, useEffect, useState } from 'react';
import { Camera, Download, MapPin } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import Modal from '@ui/components/ui/Modal';
import { getPunchPhoto, listDevices, listEmployees, listTransactions, matchPunches, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Every punch exactly as a reader sent it — before it is paired into a day.
 * Where to look when a day seems wrong: was the punch made, on which reader,
 * how was it verified, whose ID was it? (ClorTime's Transaction view.)
 */
export default function Transactions() {
  const [filters, setFilters] = useState({ from: todayIst(), to: todayIst(), employeeId: '', deviceId: '', unmatched: '' });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [devices, setDevices] = useState([]);
  const [photo, setPhoto] = useState(null);
  /* Who an unmatched reader ID is — answered once, from here; their later punches match by themselves. */
  const matchId = async (pin, employeeId) => {
    if (!employeeId) return;
    const who = people.find((p) => p.id === employeeId)?.name || 'them';
    try {
      const r = await matchPunches(pin, employeeId);
      notify.success(`Reader ID ${pin} is ${who}: ${r.matched} ${r.matched === 1 ? 'punch' : 'punches'} matched, ${r.days} ${r.days === 1 ? 'day' : 'days'} worked out.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not matched.'));
    }
  };
  const showPhoto = async (t) => {
    try {
      const r = await getPunchPhoto(t.photoId);
      setPhoto({ src: r.photo, caption: `${t.employeeName || t.pin} · ${t.localTime}${t.siteName ? ` · ${t.siteName}` : ''}` });
    } catch (e) {
      notify.error(String(e?.message || 'The photo could not be loaded.'));
    }
  };

  const load = useCallback(() => {
    listTransactions(filters).then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load transactions.')));
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
                  { key: 'siteName', label: 'Site (phone)' },
                  { key: 'latitude', label: 'Latitude' },
                  { key: 'longitude', label: 'Longitude' },
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
      <LoadFailed message={loadError} onRetry={load} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={6} />
      ) : !data.transactions.length ? (
        <EmptyState title="No punches" description="No reader sent a punch in this range." />
      ) : (
        <div className="ui-card overflow-hidden">
          {data.truncated ? <p className="ui-caption px-4 pt-3">Showing the latest {data.transactions.length} of {data.total}. Narrow the dates or export to see the rest.</p> : null}
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
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
                  <th scope="col" className="ui-th">Where</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap tabular-nums">{t.localTime}</td>
                    <td className="ui-col-entity">
                      {t.employeeName || (
                        <span className="flex flex-col gap-1">
                          <span className="ui-caption" style={{ color: 'rgb(var(--warn-ink))' }}>
                            Not matched{t.nameOnReader ? ` · “${t.nameOnReader}” on the reader` : ''}
                          </span>
                          <select className="ui-select ui-btn-sm !w-auto" value="" onChange={(e) => matchId(t.pin, e.target.value)} aria-label={`Who is reader ID ${t.pin}?`}>
                            <option value="">Who is ID {t.pin}?</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
                          </select>
                        </span>
                      )}
                    </td>
                    <td className="ui-mono">{t.pin}</td>
                    <td className="ui-col-h-center">
                      {t.kind ? (
                        <span className={`ui-pill ${t.kind === 'IN' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{t.kind}</span>
                      ) : (
                        <span className="ui-caption" title={`The reader sent punch state ${t.state}: no in/out key pressed. The day counts the first punch as in and the last as out.`}>auto</span>
                      )}
                    </td>
                    <td>{t.verify}</td>
                    <td>{t.deviceName}</td>
                    <td className="ui-col-meta whitespace-nowrap">{t.shiftDate || (t.employeeId ? '—' : 'once matched')}</td>
                    <td className="whitespace-nowrap">
                      {t.latitude != null ? (
                        <span className="inline-flex items-center gap-2">
                          <a className="ui-link inline-flex items-center gap-1" href={`https://www.openstreetmap.org/?mlat=${t.latitude}&mlon=${t.longitude}#map=18/${t.latitude}/${t.longitude}`} target="_blank" rel="noreferrer" title={t.accuracyM != null ? `Accurate to about ${Math.round(t.accuracyM)} m` : undefined}>
                            <MapPin size={14} aria-hidden="true" />{t.siteName || 'Map'}
                          </a>
                          {t.photoId ? (
                            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Selfie with ${t.employeeName || t.pin}'s punch at ${t.localTime}`} onClick={() => showPhoto(t)}>
                              <Camera size={14} aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <span className="ui-caption">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {photo ? (
        <Modal onClose={() => setPhoto(null)} title="Punch selfie" maxWidthClass="max-w-md">
          <figure className="space-y-2">
            <img src={photo.src} alt={`Selfie: ${photo.caption}`} className="mx-auto max-h-[60vh] rounded-md" />
            <figcaption className="ui-caption text-center">{photo.caption}</figcaption>
          </figure>
        </Modal>
      ) : null}
    </div>
  );
}
