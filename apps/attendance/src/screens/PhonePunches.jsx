import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import RangePresets from '@ui/components/ui/RangePresets';
import { Ban, Camera, ExternalLink, MapPin, Navigation, Smartphone, Users } from '@ui/components/ui/lineIcons';
import ApproveActions from '@ui/components/ui/ApproveActions';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { getPhonePunches, getPunchPhoto, reviewFieldPunch, setFieldPunchApproval, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { latestPlaces, placeOf } from '../components/round41';
import { errorWords, dayTimeText } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';

/**
 * Punches from phones, the way readers are watched: who punched, from which
 * work site, how far from its centre and how accurate the location was, with
 * the selfie if one was taken — and the attempts the server refused (outside
 * every site, a rough location, too soon after the last), which otherwise
 * leave no trace.
 */
const REFUSED = {
  OUTSIDE: 'Outside the punch areas',
  ROUGH_LOCATION: 'Location not accurate enough',
  NO_LOCATION: 'No location',
  NO_SITE: 'No punch area set up',
  TOO_SOON: 'Less than a minute after the last',
  BAD_PHOTO: 'Selfie not usable',
  PHONE_OFF: 'Phone punch switched off',
};
const TABS = [
  { value: 'accepted', label: 'Recorded', tone: 'paid' },
  { value: 'refused', label: 'Refused', tone: 'overdue' },
  { value: 'field', label: 'Field', tone: 'partial' },
  /* Round 41, teammap B: each person's last place and time, as a list. */
  { value: 'latest', label: 'Where now', tone: 'all' },
];
const kindLabel = (p) => (p.kind === 'IN' ? 'In' : p.kind === 'OUT' ? 'Out' : '—');
const reviewLabel = (p) => (p.review === 'PENDING' ? 'Waiting' : p.review === 'REJECTED' ? 'Refused' : 'Counts');
const COLUMNS = {
  time: (p) => String(p.time || '').slice(0, 10),
  employee: (p) => p.name,
  kind: kindLabel,
  site: (p) => p.site,
  review: reviewLabel,
  why: (r) => REFUSED[r.code] || 'Refused',
};
const metres = (m) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const mapUrl = (lat, lon) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;


/* What Export writes: the rows on screen, as shown (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'name', label: 'Employee' },
  { key: 'kind', label: 'In or out', value: (r) => kindLabel(r) },
  { key: 'site', label: 'Site', value: (r) => r.site || '' },
  { key: 'address', label: 'Where', value: (r) => r.address || '' },
  { key: 'nearest', label: 'Nearest site', value: (r) => (r.nearest ? `${r.nearest.name} (${metres(r.nearest.distance)})` : '') },
  { key: 'distance', label: 'From centre', value: (r) => (r.distance != null ? metres(r.distance) : '') },
  { key: 'accuracy', label: 'Accuracy', value: (r) => (r.accuracy != null ? `±${metres(r.accuracy)}` : '') },
  { key: 'review', label: 'Status', value: (r) => r.review || (r.code ? REFUSED[r.code] || 'Refused' : '') },
  { key: 'message', label: 'Why refused', value: (r) => r.message || '' },
  { key: 'latitude', label: 'Latitude' },
  { key: 'longitude', label: 'Longitude' },
];
export default function PhonePunches({ menuLabel } = {}) {
  const [range, setRange] = useState({ from: todayIst(), to: todayIst() });
  const [tab, setTab] = useState('accepted');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null);
  const latest = useMemo(() => latestPlaces(data?.accepted), [data]);
  const counts = useMemo(() => ({ accepted: data?.accepted.length || 0, refused: data?.refused.length || 0, field: data?.summary.field || 0, latest: latest.length }), [data, latest]);
  const inTab = useMemo(() => {
    if (!data) return [];
    if (tab === 'refused') return data.refused;
    if (tab === 'latest') return latest;
    return tab === 'field' ? data.accepted.filter((p) => p.outside) : data.accepted;
  }, [data, tab, latest]);
  const search = useListSearch(inTab, ['time', 'name', 'site', 'address', 'message']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const load = useCallback(() => {
    getPhonePunches(range).then((d) => { setData(d); setError(''); }).catch((e) => setError(errorWords(e, 'load phone punches')));
  }, [range]);
  useEffect(() => { load(); }, [load]);
  const review = async (p, approve) => {
    try {
      await reviewFieldPunch(p.id, approve);
      notify.success(approve ? `${p.name}'s punch at ${dayTimeText(p.time)} counts now.` : `${p.name}'s punch was refused; it stays on record.`);
      load();
    } catch (e) {
      notify.error(errorWords(e, 'do that'));
    }
  };
  const toggleApproval = async (on) => {
    try {
      await setFieldPunchApproval(on);
      notify.success(on ? 'Field punches now wait for approval.' : 'Field punches now count at once.');
      load();
    } catch (e) {
      notify.error(errorWords(e, 'make the change'));
    }
  };
  const view = async (p) => {
    try {
      const r = await getPunchPhoto(p.photoId);
      setPhoto({ src: r.photo, caption: `${p.name} · ${dayTimeText(p.time)}${p.site ? ` · ${p.site}` : ''}` });
    } catch (e) {
      notify.error(errorWords(e, 'load the selfie'));
    }
  };

  const tools = (p) => (
    <>
      {p.photoId ? <button type="button" className="ui-icon-btn" aria-label={`${p.name}'s selfie`} title="Selfie" onClick={() => view(p)}><Camera size={14} aria-hidden="true" /></button> : null}
      {p.latitude != null ? <a className="ui-icon-btn" href={mapUrl(p.latitude, p.longitude)} target="_blank" rel="noreferrer" aria-label={`Where ${p.name} punched, on a map`} title="On a map"><MapPin size={14} aria-hidden="true" /></a> : null}
    </>
  );
  const empty = (colSpan, icon, title, description) => (
    <tr>
      <td colSpan={colSpan}>
        {inTab.length ? (
          <EmptyState kind="filtered" totalCount={inTab.length} title="No punches match" description="Nothing in this tab matches the search or the column filters." />
        ) : (
          <EmptyState icon={icon} title={title} description={description} />
        )}
      </td>
    </tr>
  );

  return (
    <DocumentListShell
      entity="reader"
      title={menuLabel || 'Phone punches'}
      moreItems={[exportMenuItem('Export')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Phone punches', fileName: 'Phone punches', label: 'punch/punches', columns: EXPORT_COLUMNS, rows: rows });
      }}
      description="Punches made from phones, where they were made, and the attempts that were refused."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search phone punches…', label: 'Search phone punches' }}
      countLine={countItems(data
          ? [
              { label: 'Punches', value: data.summary.punches, count: true, tone: 'all', Icon: Smartphone },
              { label: 'People', value: data.summary.people, count: true, tone: 'paid', Icon: Users },
              { label: 'With a selfie', value: data.summary.withSelfie, count: true, tone: 'sent', Icon: Camera },
              { label: 'Refused', value: data.summary.refused, count: true, tone: 'overdue', Icon: Ban, hint: data.summary.outside ? `${data.summary.outside} outside the sites` : null, onSelect: () => setTab('refused') },
              { label: 'Field punches', value: data.summary.field || 0, count: true, tone: 'partial', Icon: Navigation, hint: data.summary.waiting ? `${data.summary.waiting} waiting for approval` : null, onSelect: () => setTab('field') },
            ]
          : null)}
      tabs={TABS}
      statusValue={tab}
      statusCounts={counts}
      onStatusChange={setTab}
      tabsLabel="Phone punches"
      tabsExtras={
        <>
          <RangePresets from={range.from} to={range.to} maxTo={todayIst()} onPick={(f, t) => setRange((r) => ({ ...r, from: f, to: t }))} />
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={range.to} max={todayIst()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
          {data ? (
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="ui-checkbox" checked={data.fieldPunchApproval !== false} onChange={(e) => toggleApproval(e.target.checked)} /> Field punches wait for approval
            </label>
          ) : null}
        </>
      }
    >
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : tab === 'latest' ? (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <th className="ui-col-grow" scope="col">Last place</th>
                <ColumnHeader label="In or out" col="kind" state={filters} />
                <ColumnHeader label="Time" col="time" state={filters} type="date" />
                <th scope="col"><span className="sr-only">Selfie and map</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? empty(5, Users, 'No one punched from a phone', 'Each person who punched from a phone in these days shows here once, with the place and time of their last punch.') : rows.map((p) => (
                <tr key={p.employeeId || p.id}>
                  <td className="ui-col-entity" data-phone="name">{p.name}</td>
                  <td className="ui-col-grow whitespace-normal min-w-[12rem]" data-phone="sub">{placeOf(p) ? <span className="ui-punch-place" title={placeOf(p)}><MapPin size={13} aria-hidden="true" className="ui-punch-pin" />{placeOf(p)}</span> : <span className="ui-caption">Place not named</span>}</td>
                  <td data-phone="tag">{kindLabel(p)}</td>
                  <td className="ui-col-date whitespace-nowrap tabular-nums" data-phone="key">{p.time}</td>
                  <td className="ui-col-meta" data-phone="act"><span className="flex items-center justify-end gap-1">{tools(p)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'field' ? (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <ColumnHeader label="Time" col="time" state={filters} type="date" />
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <ColumnHeader label="In or out" col="kind" state={filters} />
                <th className="ui-col-grow" scope="col">Where</th>
                <th scope="col">Nearest site</th>
                <ColumnHeader label="Status" col="review" state={filters} align="center" />
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? empty(7, Navigation, 'No field punches', 'People set to Field under Portal access can punch from anywhere; their punches show here with the address.') : rows.map((p) => (
                <tr key={p.id}>
                  <td className="ui-col-date whitespace-nowrap tabular-nums" data-phone="key">{p.time}</td>
                  <td className="ui-col-entity" data-phone="name">{p.name}</td>
                  <td>{kindLabel(p)}</td>
                  <td className="ui-col-grow whitespace-normal min-w-[12rem]" data-phone="sub"><span className="ui-punch-place" title={p.address || ''}>{p.address ? <><MapPin size={13} aria-hidden="true" className="ui-punch-pin" />{p.address}</> : <span className="ui-caption">Address not found</span>}</span><span className="ui-caption">{p.accuracy != null ? `±${metres(p.accuracy)}` : ''}</span></td>
                  <td>{p.nearest ? <span>{p.nearest.name}<span className="ui-caption"> · {metres(p.nearest.distance)} away</span></span> : <span className="ui-caption">—</span>}</td>
                  <td className="ui-col-h-center" data-phone="tag"><ExceptionTag label={p.review === 'PENDING' || p.review === 'REJECTED' ? reviewLabel(p) : ''} normal={reviewLabel(p)} tone={p.review === 'REJECTED' ? 'neg' : 'warn'} /></td>
                  <td className="ui-col-meta" data-phone="act">
                    <span className="flex items-center justify-end gap-1">
                      {tools(p)}
                      {p.review === 'PENDING' ? (
                        <ApproveActions what={`${p.name}'s punch`} onApprove={() => review(p, true)} onReject={() => review(p, false)} approveTitle="Count this punch" rejectTitle="Refuse (it stays on record)" />
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'accepted' ? (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <ColumnHeader label="Time" col="time" state={filters} type="date" />
                <ColumnHeader label="Employee" col="employee" state={filters}  className="ui-col-grow" />
                <ColumnHeader label="In or out" col="kind" state={filters} />
                <ColumnHeader label="Site" col="site" state={filters} />
                <th scope="col" className="ui-num">From centre</th>
                <th scope="col" className="ui-num">Accuracy</th>
                <th scope="col"><span className="sr-only">Selfie and map</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? empty(7, Smartphone, 'No phone punches', 'Nobody punched from a phone in these days. Phone punching is switched on per person under Portal access.') : rows.map((p) => (
                <tr key={p.id}>
                  <td className="ui-col-date whitespace-nowrap tabular-nums" data-phone="key">{p.time}</td>
                  <td className="ui-col-entity" data-phone="name">{p.name}</td>
                  <td data-phone="tag">{kindLabel(p)}</td>
                  <td data-phone="sub">{p.site ? <span className="ui-punch-place"><MapPin size={13} aria-hidden="true" className="ui-punch-pin" />{p.site}</span> : <span className="ui-caption">—</span>}</td>
                  <td className="ui-num">{metres(p.distance)}{p.radius ? <span className="ui-caption"> / {metres(p.radius)}</span> : null}</td>
                  <td className="ui-num">{p.accuracy != null ? `±${metres(p.accuracy)}` : '—'}</td>
                  <td className="ui-col-meta" data-phone="act"><span className="flex items-center justify-end gap-1">{tools(p)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <ColumnHeader label="Time" col="time" state={filters} type="date" />
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <ColumnHeader label="Why refused" col="why" state={filters}  className="ui-col-grow" />
                <th scope="col">Nearest site</th>
                <th scope="col" className="ui-num">Accuracy</th>
                <th scope="col"><span className="sr-only">Map</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? empty(6, Ban, 'Nothing refused', 'Every phone punch in these days was inside a punch area. Punches CLOR refuses (outside every punch area, location not accurate enough, or within a minute of the last one) are listed here.') : rows.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-date whitespace-nowrap tabular-nums" data-phone="key">{r.time}</td>
                  <td className="ui-col-entity" data-phone="name">{r.name}</td>
                  <td data-phone="sub"><span className="ui-pill ui-pill-warn mr-1.5">{REFUSED[r.code] || 'Refused'}</span><span className="ui-caption">{r.message}</span></td>
                  <td>{r.nearest ? <span>{r.nearest.name}<span className="ui-caption"> · {metres(r.nearest.distance)} away (allowed {metres(r.nearest.radius)})</span></span> : <span className="ui-caption">—</span>}</td>
                  <td className="ui-num">{r.accuracy != null ? `±${metres(r.accuracy)}` : '—'}</td>
                  <td className="ui-col-meta text-end" data-phone="act">{r.latitude != null ? <a className="ui-icon-btn" href={mapUrl(r.latitude, r.longitude)} target="_blank" rel="noreferrer" aria-label="On a map" title="On a map"><ExternalLink size={14} aria-hidden="true" /></a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer open={Boolean(photo)} onClose={() => setPhoto(null)} title="Selfie" description={photo?.caption || ''} widthClass="w-[min(28rem,96vw)]">
        {photo ? <img src={photo.src} alt={photo.caption} className="w-full rounded-lg" /> : null}
      </Drawer>
    </DocumentListShell>
  );
}
