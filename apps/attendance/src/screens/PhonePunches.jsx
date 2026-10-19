import React, { useCallback, useEffect, useState } from 'react';
import { Camera, ExternalLink, MapPin } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { getPhonePunches, getPunchPhoto, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Punches from phones, the way readers are watched: who punched, from which
 * work site, how far from its centre and how accurate the location was, with
 * the selfie if one was taken — and the attempts the server refused (outside
 * every site, a rough location, too soon after the last), which otherwise
 * leave no trace.
 */
const REFUSED = {
  OUTSIDE: 'Outside the work sites',
  ROUGH_LOCATION: 'Location too rough',
  NO_LOCATION: 'No location',
  NO_SITE: 'No work site set up',
  TOO_SOON: 'Less than a minute after the last',
  BAD_PHOTO: 'Selfie not usable',
  PHONE_OFF: 'Phone punch switched off',
};
const metres = (m) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const mapUrl = (lat, lon) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;

export default function PhonePunches() {
  const [range, setRange] = useState({ from: todayIst(), to: todayIst() });
  const [tab, setTab] = useState('accepted');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null);
  const load = useCallback(() => {
    getPhonePunches(range).then((d) => { setData(d); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load phone punches.')));
  }, [range]);
  useEffect(() => { load(); }, [load]);
  const view = async (p) => {
    try {
      const r = await getPunchPhoto(p.photoId);
      setPhoto({ src: r.photo, caption: `${p.name} · ${p.time}${p.site ? ` · ${p.site}` : ''}` });
    } catch (e) {
      notify.error(String(e?.message || 'The selfie could not be loaded.'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Phone punches"
        description="Punches made from phones, where they were made, and the attempts that were refused."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="ui-input !w-auto" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
            <input type="date" className="ui-input !w-auto" value={range.to} max={todayIst()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
          </div>
        }
      />
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Punches" value={data.summary.punches} />
            <StatTile label="People" value={data.summary.people} />
            <StatTile label="With a selfie" value={data.summary.withSelfie} />
            <StatTile label="Refused" value={data.summary.refused} tone={data.summary.refused ? 'warn' : 'neutral'} hint={data.summary.outside ? `${data.summary.outside} outside the sites` : null} />
          </div>
          <div role="tablist" className="flex gap-1">
            <button type="button" role="tab" aria-selected={tab === 'accepted'} className="ui-segment" onClick={() => setTab('accepted')}>Recorded {data.accepted.length}</button>
            <button type="button" role="tab" aria-selected={tab === 'refused'} className="ui-segment" onClick={() => setTab('refused')}>Refused {data.refused.length}</button>
          </div>
          {tab === 'accepted' ? (
            data.accepted.length ? (
              <div className="ui-card overflow-hidden">
                <div className="overflow-x-auto ui-table-scroll ui-table-fit">
                  <table className="ui-table w-full">
                    <thead><tr><th className="ui-th">Time</th><th className="ui-th">Employee</th><th className="ui-th">In or out</th><th className="ui-th">Site</th><th className="ui-th text-end">From centre</th><th className="ui-th text-end">Accuracy</th><th className="ui-th"><span className="sr-only">Selfie and map</span></th></tr></thead>
                    <tbody>
                      {data.accepted.map((p) => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap tabular-nums">{p.time}</td>
                          <td className="ui-col-entity">{p.name}</td>
                          <td>{p.kind === 'IN' ? 'In' : p.kind === 'OUT' ? 'Out' : '—'}</td>
                          <td>{p.site || <span className="ui-caption">—</span>}</td>
                          <td className="text-end tabular-nums">{metres(p.distance)}{p.radius ? <span className="ui-caption"> / {metres(p.radius)}</span> : null}</td>
                          <td className="text-end tabular-nums">{p.accuracy != null ? `±${metres(p.accuracy)}` : '—'}</td>
                          <td className="whitespace-nowrap text-end">
                            {p.photoId ? <button type="button" className="ui-icon-btn" aria-label={`${p.name}'s selfie`} title="Selfie" onClick={() => view(p)}><Camera size={16} aria-hidden="true" /></button> : null}
                            {p.latitude != null ? <a className="ui-icon-btn" href={mapUrl(p.latitude, p.longitude)} target="_blank" rel="noreferrer" aria-label={`Where ${p.name} punched, on a map`} title="On a map"><MapPin size={16} aria-hidden="true" /></a> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState title="No phone punches" description="Nobody punched from a phone in these days. Phone punching is switched on per person under Portal access." />
            )
          ) : data.refused.length ? (
            <div className="ui-card overflow-hidden">
              <div className="overflow-x-auto ui-table-scroll ui-table-fit">
                <table className="ui-table w-full">
                  <thead><tr><th className="ui-th">Time</th><th className="ui-th">Employee</th><th className="ui-th">Why refused</th><th className="ui-th">Nearest site</th><th className="ui-th text-end">Accuracy</th><th className="ui-th"><span className="sr-only">Map</span></th></tr></thead>
                  <tbody>
                    {data.refused.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap tabular-nums">{r.time}</td>
                        <td className="ui-col-entity">{r.name}</td>
                        <td><span className="ui-pill ui-pill-warn mr-1.5">{REFUSED[r.code] || r.code}</span><span className="ui-caption">{r.message}</span></td>
                        <td>{r.nearest ? <span>{r.nearest.name}<span className="ui-caption"> · {metres(r.nearest.distance)} away (allowed {metres(r.nearest.radius)})</span></span> : <span className="ui-caption">—</span>}</td>
                        <td className="text-end tabular-nums">{r.accuracy != null ? `±${metres(r.accuracy)}` : '—'}</td>
                        <td className="text-end">{r.latitude != null ? <a className="ui-icon-btn" href={mapUrl(r.latitude, r.longitude)} target="_blank" rel="noreferrer" aria-label="On a map" title="On a map"><ExternalLink size={16} aria-hidden="true" /></a> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState title="Nothing refused" description="Every phone punch in these days was inside a work site." />
          )}
        </>
      )}
      <Drawer open={Boolean(photo)} onClose={() => setPhoto(null)} title="Selfie" description={photo?.caption || ''} widthClass="w-[min(28rem,96vw)]">
        {photo ? <img src={photo.src} alt={photo.caption} className="w-full rounded-lg" /> : null}
      </Drawer>
    </div>
  );
}
