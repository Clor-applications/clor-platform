import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * A work site on a map: the pin is the centre, the circle is where a phone
 * punch counts. Drag the pin or tap the map to move it. OpenStreetMap tiles,
 * credited as its licence asks. With no position yet it shows India.
 */
const PIN = L.divIcon({
  className: 'clor-site-pin',
  html: '<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true"><path d="M14 1C6.8 1 1 6.7 1 13.8 1 23.4 14 37 14 37s13-13.6 13-23.2C27 6.7 21.2 1 14 1z" style="fill: rgb(var(--accent))" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="4.5" fill="#fff"/></svg>',
  iconSize: [28, 38],
  iconAnchor: [14, 37],
});

export default function SiteMap({ latitude, longitude, radius, onMove, className = '' }) {
  const box = useRef(null);
  const map = useRef(null);
  const pin = useRef(null);
  const ring = useRef(null);
  const moved = useRef(onMove);
  useEffect(() => {
    moved.current = onMove;
  }, [onMove]);

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([21, 78.9], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(m);
    m.on('click', (e) => moved.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    /* The drawer animates open; size the map once it has its final width. */
    const t = setTimeout(() => m.invalidateSize(), 250);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(box.current);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
      m.remove();
      map.current = null;
      pin.current = null;
      ring.current = null;
    };
  }, []);

  const has = Number.isFinite(latitude) && Number.isFinite(longitude);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!has) {
      pin.current?.remove();
      ring.current?.remove();
      pin.current = null;
      ring.current = null;
      return;
    }
    const at = [latitude, longitude];
    if (!pin.current) {
      pin.current = L.marker(at, { icon: PIN, draggable: true, keyboard: true, title: 'Site centre — drag to move', alt: 'Site centre' }).addTo(m);
      pin.current.on('dragend', () => {
        const p = pin.current.getLatLng();
        moved.current?.(p.lat, p.lng);
      });
      ring.current = L.circle(at, { radius: radius || 200, className: 'clor-site-ring', weight: 2 }).addTo(m);
      m.setView(at, 17);
      m.fitBounds(ring.current.getBounds(), { padding: [24, 24], maxZoom: 18 });
    } else {
      pin.current.setLatLng(at);
      ring.current.setLatLng(at);
      /* A place picked far away: go there; a nudge nearby: just keep it in view. */
      if (!m.getBounds().pad(-0.15).contains(at)) m.setView(at, Math.max(m.getZoom(), 16));
    }
  }, [has, latitude, longitude]); // eslint-disable-line react-hooks/exhaustive-deps -- radius follows separately

  useEffect(() => {
    if (!ring.current || !map.current) return;
    ring.current.setRadius(radius || 200);
    /* Keep the whole circle in view when it grows. */
    const b = ring.current.getBounds();
    if (!map.current.getBounds().contains(b)) map.current.fitBounds(b, { padding: [24, 24] });
  }, [radius]);

  return <div ref={box} className={`clor-site-map ${className}`} role="application" aria-label="Map of the work site. Drag the pin or tap the map to move the centre." />;
}

