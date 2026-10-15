import React, { useCallback, useEffect, useState } from 'react';
import { LocateFixed, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import { createGeofence, deleteGeofence, listGeofences, updateGeofence } from '../api/attendance';

const mapLink = (f) => `https://www.openstreetmap.org/?mlat=${f.latitude}&mlon=${f.longitude}#map=17/${f.latitude}/${f.longitude}`;

/**
 * Work sites for phone punches (ClorTime's geofences): a point and a radius. A
 * phone punch counts only inside one — the person's own site if HR tied them
 * to one, else any active site for everyone or for their area.
 */
export default function Geofences() {
  const [rows, setRows] = useState(null);
  const [areas, setAreas] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => {
    listGeofences().then(setRows).catch((e) => notify.error(String(e?.message || 'Could not load sites.')));
  }, []);
  useEffect(() => {
    load();
    listStructure('areas').then(setAreas).catch(() => setAreas([]));
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Work sites"
        description="Where a phone punch counts: within the radius of a site."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ name: '', latitude: '', longitude: '', radiusMeters: 200, areaId: '', isActive: true })}>
            <Plus size={16} aria-hidden="true" /> New site
          </button>
        }
      />
      {!rows ? (
        <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="No work sites" description="Add the office, the factory gate or a client site. Standing there, “Use where I am” fills in the position." />
      ) : (
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Site</th>
                <th scope="col" className="ui-th">Position</th>
                <th scope="col" className="ui-th text-end">Radius</th>
                <th scope="col" className="ui-th">For</th>
                <th scope="col" className="ui-th text-end">Tied to it</th>
                <th scope="col" className="ui-th ui-col-h-center">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td className="ui-col-entity"><button type="button" className="ui-link" onClick={() => setEditing({ ...f, areaId: f.areaId || '' })}>{f.name}</button></td>
                  <td className="font-mono text-xs"><a className="ui-link" href={mapLink(f)} target="_blank" rel="noreferrer">{f.latitude.toFixed(5)}, {f.longitude.toFixed(5)}</a></td>
                  <td className="text-end tabular-nums">{f.radiusMeters} m</td>
                  <td>{f.areaName ? `${f.areaName} area` : 'Everyone'}</td>
                  <td className="text-end tabular-nums">{f.people}</td>
                  <td className="ui-col-h-center">{f.isActive ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <SiteForm initial={editing} areas={areas} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

function SiteForm({ initial, areas, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [locating, setLocating] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const here = () => {
    if (!navigator.geolocation) return notify.error('This browser cannot give a location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setForm((f) => ({ ...f, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }));
        notify.success(`Position set (accurate to about ${Math.round(p.coords.accuracy)} m).`);
      },
      () => {
        setLocating(false);
        notify.error('The location could not be read. Allow location for this site, or type the position in.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  const save = async (e) => {
    e.preventDefault();
    const body = {
      name: form.name,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
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
      open
      onClose={onClose}
      title={form.id ? form.name : 'New work site'}
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
        <label className="block"><span className="ui-label">Latitude *</span><input className="ui-input w-full font-mono" required inputMode="decimal" value={form.latitude} onChange={set('latitude')} placeholder="12.975700" /></label>
        <label className="block"><span className="ui-label">Longitude *</span><input className="ui-input w-full font-mono" required inputMode="decimal" value={form.longitude} onChange={set('longitude')} placeholder="77.606100" /></label>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={here} disabled={locating}><LocateFixed size={14} aria-hidden="true" /> {locating ? 'Finding…' : 'Use where I am'}</button>
          {form.latitude && form.longitude ? <a className="ui-link text-sm" href={mapLink(form)} target="_blank" rel="noreferrer">See it on a map</a> : null}
          <span className="ui-caption w-full">Or copy the position from a map app: long-press the spot, then copy the two numbers.</span>
        </div>
        <label className="block">
          <span className="ui-label">Radius (metres) *</span>
          <input type="number" min={25} max={5000} className="ui-input w-full" required value={form.radiusMeters} onChange={set('radiusMeters')} />
          <span className="ui-caption">100–300 m suits most offices; phones indoors are often 20–50 m out.</span>
        </label>
        <label className="block">
          <span className="ui-label">For</span>
          <select className="ui-select w-full" value={form.areaId} onChange={set('areaId')}>
            <option value="">Everyone</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name} area only</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
        </label>
      </form>
    </Drawer>
  );
}
