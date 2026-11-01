import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { listGeofences } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Stand where the employees will stand and see what their phone will see.
 *
 * ClorTime's "Test Punch" recorded a punch as an administrator to check the
 * geofences. This records nothing: it takes this device's position, measures
 * it against every work site and says which site, how far, and whether a
 * punch from here would be accepted. That answers the question HR actually
 * has — "is the radius right?" — without putting a test punch in anyone's
 * attendance.
 */
function metresBetween(a, b) {
  const R = 6371e3;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
const metres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export default function SiteCheck() {
  const [sites, setSites] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [position, setPosition] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const watchRef = useRef(null);

  const load = useCallback(() => listGeofences().then(setSites).catch((e) => setLoadError(e)), []);
  useEffect(() => { load(); }, [load]);

  const start = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('This browser cannot give a location.');
      return;
    }
    setLocating(true);
    const use = (p) => {
      setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      setLocating(false);
    };
    navigator.geolocation.getCurrentPosition(use, () => {}, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 });
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      use,
      (err) => {
        setLocating(false);
        setPosition((current) => {
          if (!current) setLocationError(err.code === 1 ? 'Location is blocked for this site in the browser.' : 'The location could not be found yet. Try outdoors, or on a phone.');
          return current;
        });
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
    );
  };
  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation?.clearWatch(watchRef.current); }, []);

  const rows = useMemo(() => {
    if (!sites || !position) return [];
    return sites
      .map((site) => ({ site, distance: metresBetween(position, site) }))
      .map((r) => ({ ...r, inside: r.distance <= r.site.radiusMeters }))
      .sort((a, b) => a.distance - b.distance);
  }, [sites, position]);

  return (
    <div className="space-y-3">
      <PageHeader
        entity="location"
        title="Punch area check"
        description="Stand where staff will punch and see whether this spot is inside a punch area. Nothing is recorded."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={start} disabled={locating}>
            <LocateFixed size={16} aria-hidden="true" /> {position ? 'Check again' : 'Use my location'}
          </button>
        }
      />
      <div className="pb-8 space-y-3">
        {loadError ? <LoadFailed error={loadError} onRetry={() => { setLoadError(null); load(); }} /> : !sites ? <SkeletonCard /> : (
          <>
            {locating && !position ? <p className="ui-caption" role="status">Finding this device’s location…</p> : null}
            {locationError ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{locationError}</p> : null}
            {position ? (
              <p className="ui-caption">
                This device: {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)} · accurate to about {metres(position.accuracy)}{locating ? ', improving…' : ''}
              </p>
            ) : null}
            <div className="ui-card overflow-hidden">
              <div className="ui-table-scroll">
                <table className="ui-table ui-table-sticky w-full">
                  <thead>
                    <tr>
                      <th className="ui-col-grow" scope="col">Punch area</th>
                      <th scope="col" className="ui-num">Radius</th>
                      <th scope="col" className="ui-num">Distance from here</th>
                      <th scope="col" className="ui-col-h-center">A punch here</th>
                    </tr>
                  </thead>
                  <tbody className="ui-rows">
                    {!sites.length ? (
                      <tr>
                        <td colSpan={4}>
                          <EmptyState icon={MapPin} title="No punch areas yet" description="Add one under Settings → Punch Areas; then come back here to test its radius." />
                        </td>
                      </tr>
                    ) : (position ? rows : sites.map((site) => ({ site }))).map((r) => (
                      <tr key={r.site.id}>
                        <td className="ui-col-entity">{r.site.name}</td>
                        <td className="ui-num">{metres(r.site.radiusMeters)}</td>
                        <td className="ui-num">{r.distance != null ? metres(r.distance) : '—'}</td>
                        <td className="ui-col-h-center">
                          {r.distance == null ? <span className="ui-caption">Use my location</span> : r.inside
                            ? <span className="ui-pill ui-pill-pos">Accepted</span>
                            : <span className="ui-pill ui-pill-neg">Outside by {metres(r.distance - r.site.radiusMeters)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
