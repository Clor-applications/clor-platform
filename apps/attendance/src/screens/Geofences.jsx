import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe, LocateFixed, MapPin, Plus, Search, Users } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import { createGeofence, deleteGeofence, listGeofences, placeAt, searchPlaces, updateGeofence } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { usePermissions } from '@ui/permissions/usePermissions';
import WebClockSettings from '../components/WebClockSettings';

/* The map library (Leaflet, ~150 KB) loads with this drawer, not with the app every user downloads. */
const SiteMap = lazy(() => import('../components/SiteMap'));

const mapLink = (f) => `https://www.openstreetmap.org/?mlat=${f.latitude}&mlon=${f.longitude}#map=17/${f.latitude}/${f.longitude}`;

/**
 * Work sites for phone punches (ClorTime's geofences): a point and a radius. A
 * phone punch counts only inside one — the person's own site if HR tied them
 * to one, else any active site for everyone or for their area.
 */
const TABS = [
  { value: 'ACTIVE', label: 'Active', tone: 'paid' },
  { value: 'INACTIVE', label: 'Inactive', tone: 'cancelled' },
  { value: '', label: 'All', tone: 'all' },
];
const kind = (f) => (f.isActive ? 'ACTIVE' : 'INACTIVE');
const COLUMNS = {
  name: (f) => f.name,
  where: (f) => f.address || `${f.latitude}, ${f.longitude}`,
  for: (f) => (f.areaName ? `${f.areaName} area` : 'Everyone'),
};
const BLANK = { name: '', address: '', latitude: '', longitude: '', radiusMeters: 200, areaId: '', isActive: true };

export default function Geofences() {
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [areas, setAreas] = useState([]);
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('ACTIVE');
  /* Where a browser clock-in may come from sits beside where a phone punch may (audit #6). */
  const [webClock, setWebClock] = useState(false);
  const perms = usePermissions();
  const canEditPortal = Boolean(perms?.isAdmin) || Boolean(perms?.permissions?.has?.('ATTENDANCE::Employee Portal::EDIT'));
  const load = useCallback(() => {
    listGeofences().then((v) => { setAll(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load sites.')));
  }, []);
  useEffect(() => {
    load();
    listStructure('areas').then(setAreas).catch(() => setAreas([]));
  }, [load]);

  const counts = useMemo(() => {
    const c = { '': (all || []).length };
    for (const f of all || []) c[kind(f)] = (c[kind(f)] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((f) => !status || kind(f) === status), [all, status]);
  const search = useListSearch(inTab, ['name', 'address', 'areaName']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const figures = useMemo(() => {
    const live = (all || []).filter((f) => f.isActive);
    return {
      active: live.length,
      everyone: live.filter((f) => !f.areaName).length,
      area: live.filter((f) => f.areaName).length,
      tied: (all || []).reduce((a, f) => a + Number(f.people || 0), 0),
    };
  }, [all]);
  const add = () => setEditing({ ...BLANK });

  return (
    <DocumentListShell
      entity="location"
      title="Punch areas"
      description="Where a phone punch counts: within the radius of an area. Not People's work sites, which are the company's legal establishments."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search punch areas…', label: 'Search punch areas' }}
      moreItems={[{ key: 'webClock', label: 'Clock-in from a browser', Icon: Globe }]}
      onMoreSelect={(k) => { if (k === 'webClock') setWebClock(true); }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={add}>
          <Plus size={16} aria-hidden="true" /> New site
        </button>
      }
      cards={[
        { label: 'Active sites', value: figures.active, count: true, tone: 'paid', Icon: MapPin },
        { label: 'For everyone', value: figures.everyone, count: true, tone: 'sent', Icon: LocateFixed },
        { label: 'For one area', value: figures.area, count: true, tone: 'partial', Icon: LocateFixed },
        { label: 'Tied to a site', value: figures.tied, count: true, tone: 'all', Icon: Users },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Site status"
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Site" col="name" state={filters} />
                <ColumnHeader label="Where" col="where" state={filters}  className="ui-col-grow" />
                <th scope="col" className="ui-num">Radius</th>
                <ColumnHeader label="For" col="for" state={filters} />
                <th scope="col" className="ui-num">Tied to it</th>
                <th scope="col" className="ui-col-h-center">Active</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={6}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No sites match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={MapPin}
                        title={status === 'INACTIVE' ? 'No inactive punch areas' : 'No punch areas'}
                        description={status === 'INACTIVE' ? 'Try another tab.' : 'Add the office, the factory gate or a client site: search for its address and check the pin on the map.'}
                        routes={status === 'INACTIVE' ? undefined : [{ label: 'New site', description: 'Search for its address and check the pin on the map.', onSelect: add }]}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((f) => (
                  <tr key={f.id} className="ui-row-click" onClick={() => setEditing({ ...f, address: f.address || '', areaId: f.areaId || '' })}>
                    <td className="ui-col-entity">{f.name}</td>
                    <td className="ui-col-grow max-w-[1px]" onClick={(e) => e.stopPropagation()}><a className="ui-link block truncate text-sm font-normal" href={mapLink(f)} target="_blank" rel="noreferrer" title={f.address || `${f.latitude}, ${f.longitude}`}>{f.address || <span className="ui-mono text-xs">{f.latitude.toFixed(5)}, {f.longitude.toFixed(5)}</span>}</a></td>
                    <td className="ui-num">{f.radiusMeters} m</td>
                    <td>{f.areaName ? `${f.areaName} area` : 'Everyone'}</td>
                    <td className="ui-num">{f.people}</td>
                    <td className="ui-col-h-center">{f.isActive ? '✓' : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {webClock ? <WebClockSettings canEdit={canEditPortal} onClose={() => setWebClock(false)} /> : null}
      {editing ? <SiteForm initial={editing} areas={areas} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </DocumentListShell>
  );
}

/** Type an address or a place name; pick from what the map service suggests. A typed position or a pasted map link works too. */
function PlaceSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ q: '', places: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return undefined;
    let live = true;
    const t = setTimeout(() => {
      setBusy(true);
      searchPlaces(term)
        .then((places) => { if (live) { setFound({ q: term, places }); setActive(places.length ? 0 : -1); } })
        .catch(() => { if (live) setFound({ q: term, places: [] }); })
        .finally(() => { if (live) setBusy(false); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const places = q.trim().length >= 3 && found.q === q.trim() ? found.places : [];
  const pick = (p) => {
    onPick(p);
    setQ(p.source === 'typed' ? q : p.label);
    setOpen(false);
  };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(places.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open && places[active]) { e.preventDefault(); pick(places[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const showList = open && q.trim().length >= 3;
  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} aria-hidden="true" className="ui-subtle pointer-events-none absolute start-3 top-1/2 -translate-y-1/2" />
        <input
          id="site-search"
          className="ui-input w-full !ps-9"
          role="combobox"
          aria-expanded={showList}
          aria-controls="site-search-list"
          aria-activedescendant={showList && active >= 0 ? `site-opt-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={key}
          placeholder="Building, street, area or city — e.g. Peenya Industrial Area, Bengaluru"
        />
      </div>
      {showList ? (
        <ul id="site-search-list" role="listbox" className="ui-card absolute inset-x-0 top-full z-[var(--z-drawer-popover)] mt-1 max-h-72 overflow-auto p-1 shadow-lg">
          {places.length ? places.map((p, i) => (
            <li
              key={`${p.latitude},${p.longitude},${i}`}
              id={`site-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm ${i === active ? 'bg-[rgb(var(--accent-soft))]' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActive(i)}
            >
              <MapPin size={15} aria-hidden="true" className="ui-subtle mt-0.5 shrink-0" />
              <span className="min-w-0"><span className="block font-medium">{p.label}</span>{p.detail ? <span className="ui-caption block truncate">{p.detail}</span> : null}</span>
            </li>
          )) : <li className="ui-caption px-2.5 py-2">{busy || found.q !== q.trim() ? 'Searching…' : 'Nothing found. Try the area and city, or drop the pin on the map.'}</li>}
        </ul>
      ) : null}
    </div>
  );
}

function SiteForm({ initial, areas, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [locating, setLocating] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const lat = form.latitude === '' ? NaN : Number(form.latitude);
  const lon = form.longitude === '' ? NaN : Number(form.longitude);
  const placed = Number.isFinite(lat) && Number.isFinite(lon);

  /* After the pin is moved by hand, say what is there, so the address follows the pin. */
  const lookup = useRef(0);
  const moveTo = useCallback((la, lo, address) => {
    const n = ++lookup.current;
    setForm((f) => ({ ...f, latitude: la.toFixed(6), longitude: lo.toFixed(6), ...(address !== undefined ? { address } : {}) }));
    if (address === undefined) {
      placeAt(la.toFixed(6), lo.toFixed(6))
        .then((p) => { if (n === lookup.current && p?.address) setForm((f) => ({ ...f, address: p.address })); })
        .catch(() => {});
    }
  }, []);

  const here = () => {
    if (!navigator.geolocation) return notify.error('This browser cannot give a location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        moveTo(p.coords.latitude, p.coords.longitude);
        notify.success(`Pin placed where you are (accurate to about ${Math.round(p.coords.accuracy)} m).`);
      },
      () => {
        setLocating(false);
        notify.error('The location could not be read. Allow location for this site, or search for the address.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  const save = async (e) => {
    e.preventDefault();
    if (!placed) return notify.error('Find the place first: search for its address, or tap the map.');
    const body = {
      name: form.name,
      address: form.address || null,
      latitude: lat,
      longitude: lon,
      radiusMeters: Number(form.radiusMeters),
      areaId: form.areaId || null,
      isActive: form.isActive !== false,
    };
    try {
      if (form.id) await updateGeofence(form.id, body);
      else await createGeofence(body);
      notify.success('Site saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${form.name}?`, message: 'Only a site nobody has punched at can be deleted. Otherwise switch it off.', confirmLabel: 'Delete' }))) return;
    try {
      await deleteGeofence(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  return (
    <Drawer
      widthClass="w-[min(44rem,96vw)]"
      open
      onClose={onClose}
      title={form.id ? form.name : 'New punch area'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="site-form" className="ui-btn ui-btn-primary">Save</button>
        </>
      }
    >
      <form id="site-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={set('name')} placeholder="e.g. Head office" /></label>
        <div className="sm:col-span-2 space-y-2">
          <label htmlFor="site-search" className="ui-label">Find the place *</label>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 basis-full sm:basis-auto"><PlaceSearch onPick={(p) => moveTo(p.latitude, p.longitude, p.source === 'typed' ? undefined : [p.label, p.detail].filter(Boolean).join(', '))} /></div>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={here} disabled={locating}><LocateFixed size={16} aria-hidden="true" /> {locating ? 'Finding…' : 'Use where I am'}</button>
          </div>
          <Suspense fallback={<div className="clor-site-map ui-skel" aria-hidden="true" />}>
            <SiteMap latitude={lat} longitude={lon} radius={Number(form.radiusMeters) || 200} onMove={(la, lo) => moveTo(la, lo)} />
          </Suspense>
          <p className="ui-caption">{placed ? 'Drag the pin to the gate or the building’s centre. The circle is where a phone punch counts.' : 'Search above, or tap the map where the site is.'}</p>
          {form.address ? <p className="text-sm"><MapPin size={14} aria-hidden="true" className="ui-subtle me-1 inline" />{form.address}</p> : null}
        </div>
        <div className="block sm:col-span-2">
          <label htmlFor="site-radius" className="ui-label">Punches count within</label>
          <div className="flex items-center gap-3">
            <input id="site-radius" type="range" min={25} max={1000} step={25} className="min-w-0 flex-1 accent-[rgb(var(--accent))]" value={Math.min(1000, Number(form.radiusMeters) || 200)} onChange={set('radiusMeters')} aria-describedby="site-radius-help" />
            <span className="flex items-center gap-1"><input type="number" min={25} max={5000} className="ui-input !w-24 text-end tabular-nums" required value={form.radiusMeters} onChange={set('radiusMeters')} aria-label="Radius in metres" /> <span className="ui-caption">m</span></span>
          </div>
          <span id="site-radius-help" className="ui-caption">100–300 m suits most offices; phones indoors are often 20–50 m out.</span>
        </div>
        <label className="block">
          <span className="ui-label">For</span>
          <select className="ui-select w-full" value={form.areaId} onChange={set('areaId')}>
            <option value="">Everyone</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name} area only</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="ui-checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
        </label>
        <details className="sm:col-span-2 text-sm">
          <summary className="ui-caption cursor-pointer">Exact position</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="ui-label">Latitude</span><input className="ui-input w-full ui-mono" inputMode="decimal" value={form.latitude} onChange={set('latitude')} placeholder="12.975700" /></label>
            <label className="block"><span className="ui-label">Longitude</span><input className="ui-input w-full ui-mono" inputMode="decimal" value={form.longitude} onChange={set('longitude')} placeholder="77.606100" /></label>
            {placed ? <a className="ui-link sm:col-span-2" href={mapLink({ latitude: lat, longitude: lon })} target="_blank" rel="noreferrer">Open in OpenStreetMap</a> : null}
          </div>
        </details>
      </form>
    </Drawer>
  );
}
