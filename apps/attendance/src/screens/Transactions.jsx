import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Fingerprint, MapPin, Router, Users, UserX } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import Modal from '@ui/components/ui/Modal';
import { getPunchPhoto, listDevices, listEmployees, listTransactions, matchPunches, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'IN', label: 'In', tone: 'paid' },
  { value: 'OUT', label: 'Out', tone: 'sent' },
  { value: 'AUTO', label: 'Auto', tone: 'cancelled' },
];
const directionOf = (t) => t.kind || 'AUTO';
const COLUMNS = {
  time: (t) => String(t.localTime || '').slice(0, 10),
  employee: (t) => t.employeeName || 'Not matched',
  pin: (t) => t.pin,
  verify: (t) => t.verify,
  reader: (t) => t.deviceName,
  shiftDate: (t) => t.shiftDate,
};
const EXPORT_COLUMNS = [
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
];

/**
 * Every punch exactly as a reader sent it — before it is paired into a day.
 * Where to look when a day seems wrong: was the punch made, on which reader,
 * how was it verified, whose ID was it? (ClorTime's Transaction view.)
 */
/* `title`: the same log is Punches under Attendance and Punch Transactions under Readers. */
export default function Transactions({ title = 'Punch transactions' }) {
  const [filters, setFilters] = useState({ from: todayIst(), to: todayIst(), employeeId: '', deviceId: '', unmatched: '' });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [devices, setDevices] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [direction, setDirection] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
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

  /* The work-code column only when a reader sent one; most never do. */
  const anyWorkCode = Boolean(data?.transactions?.some((t) => t.workCode));

  const all = useMemo(() => data?.transactions || [], [data]);
  const counts = useMemo(() => {
    const c = { '': all.length };
    for (const t of all) c[directionOf(t)] = (c[directionOf(t)] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => all.filter((t) => !direction || directionOf(t) === direction), [all, direction]);
  const search = useListSearch(inTab, ['localTime', 'employeeName', 'employeeCode', 'pin', 'nameOnReader', 'deviceName', 'verify', 'siteName']);
  const columns = useColumnFilters();
  const rows = columns.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useResetPage(setPage, [direction, search.query, filters]);
  const figures = useMemo(() => ({
    punches: all.length,
    people: new Set(all.map((t) => t.employeeId).filter(Boolean)).size,
    readers: new Set(all.map((t) => t.deviceName).filter(Boolean)).size,
    unmatched: all.filter((t) => !t.employeeId).length,
  }), [all]);

  return (
    <DocumentListShell
      entity="reader"
      title={title}
      description="Every punch as the readers sent it, before it becomes a day."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search punches…', label: 'Search transactions' }}
      moreItems={[exportMenuItem('Export transactions')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Transactions', subtitle: `${filters.from} to ${filters.to}`, fileName: `Transactions ${filters.from} to ${filters.to}`, label: 'punch/punches', columns: EXPORT_COLUMNS, rows });
      }}
      cards={[
        { label: 'Punches', value: figures.punches, count: true, tone: 'all', Icon: Fingerprint },
        { label: 'People', value: figures.people, count: true, tone: 'paid', Icon: Users },
        { label: 'Readers', value: figures.readers, count: true, tone: 'sent', Icon: Router },
        { label: 'Not matched', value: figures.unmatched, count: true, tone: 'outstanding', Icon: UserX, onSelect: () => setFilters((f) => ({ ...f, unmatched: f.unmatched === 'true' ? '' : 'true' })) },
      ]}
      tabs={TABS}
      statusValue={direction}
      statusCounts={counts}
      onStatusChange={setDirection}
      tabsLabel="Direction"
      tabsExtras={
        <>
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={filters.from} max={filters.to} onChange={set('from')} aria-label="From" />
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={filters.to} max={todayIst()} onChange={set('to')} aria-label="To" />
          <select className="ui-select ui-ctl-compact !w-auto" value={filters.employeeId} onChange={set('employeeId')} aria-label="Employee" disabled={filters.unmatched === 'true'}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="ui-select ui-ctl-compact !w-auto" value={filters.deviceId} onChange={set('deviceId')} aria-label="Reader">
            <option value="">All readers</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={filters.unmatched === 'true'} onChange={(e) => setFilters((f) => ({ ...f, unmatched: e.target.checked ? 'true' : '' }))} /> Unmatched only
          </label>
        </>
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          {data.truncated ? <p className="ui-caption px-4 pt-3">Showing the latest {data.transactions.length} of {data.total}. Narrow the dates or export to see the rest.</p> : null}
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Time" col="time" state={columns} type="date" />
                  <ColumnHeader label="Employee" col="employee" state={columns}  className="ui-col-grow" />
                  <ColumnHeader label="Reader ID" col="pin" state={columns} />
                  <th scope="col" className="ui-col-h-center">Direction</th>
                  <ColumnHeader label="Verified by" col="verify" state={columns} />
                  {anyWorkCode ? <th scope="col" className="hidden md:table-cell">Work code</th> : null}
                  <ColumnHeader label="Reader" col="reader" state={columns} />
                  <ColumnHeader label="Counted on" col="shiftDate" state={columns} type="date" />
                  <th scope="col">Where</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={anyWorkCode ? 9 : 8}>
                      {all.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length || all.length} title="No punches match" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={Fingerprint}
                          title="No punches"
                          description="Every punch as the readers sent it, before it becomes a day. No reader sent a punch in this range; widen the dates."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((t) => (
                    <tr key={t.id}>
                      <td className="ui-col-date whitespace-nowrap tabular-nums">{t.localTime}</td>
                      <td className="ui-col-entity">
                        {t.employeeName || (
                          <span className="flex flex-col gap-1">
                            <span className="ui-caption" style={{ color: 'rgb(var(--warn-ink))' }}>
                              Not matched{t.nameOnReader ? ` · “${t.nameOnReader}” on the reader` : ''}
                            </span>
                            <select className="ui-select ui-ctl-compact !w-auto" value="" onChange={(e) => matchId(t.pin, e.target.value)} aria-label={`Who is reader ID ${t.pin}?`}>
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
                      {anyWorkCode ? <td className="ui-mono hidden md:table-cell">{t.workCode || ''}</td> : null}
                      <td>{t.deviceName}</td>
                      <td className="ui-col-date whitespace-nowrap">{t.shiftDate || (t.employeeId ? '—' : 'once matched')}</td>
                      <td className="ui-col-meta whitespace-nowrap">
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
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="punches" />
        </>
      )}
      {photo ? (
        <Modal onClose={() => setPhoto(null)} title="Punch selfie" maxWidthClass="max-w-md">
          <figure className="space-y-2">
            <img src={photo.src} alt={`Selfie: ${photo.caption}`} className="mx-auto max-h-[60vh] rounded-lg-md" />
            <figcaption className="ui-caption text-center">{photo.caption}</figcaption>
          </figure>
        </Modal>
      ) : null}
    </DocumentListShell>
  );
}

/* Punches under Attendance: the same log, titled as the menu names it. */
export const Punches = (props) => <Transactions {...props} title="Punches" />;
