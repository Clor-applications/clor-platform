import { guardedRequest } from './outbound.js';

/**
 * Addresses to positions for work sites, so nobody has to know a latitude.
 * Photon (komoot's OpenStreetMap search, made for search-as-you-type) answers
 * first; Nominatim, OpenStreetMap's own, is the fallback and is held to its
 * one-request-a-second policy. Answers are cached a day: the same office is
 * looked up again and again, and both services ask to be spared repeats.
 * A typed position ("12.97, 77.59") or a pasted map link is read directly.
 */
export type Place = { label: string; detail: string; latitude: number; longitude: number; source: 'photon' | 'nominatim' | 'typed' };

const PHOTON = () => process.env.GEOCODE_PHOTON_URL || 'https://photon.komoot.io';
const NOMINATIM = () => process.env.GEOCODE_NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const UA = 'CLOR/1.0 (work-site search; https://clor.in)';
const TTL = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; v: any }>();
const cached = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = await fn();
  if (v == null || (Array.isArray(v) && !v.length)) return v; // a miss or an outage is not remembered
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), v });
  return v;
};
let nominatimNext = 0;
const nominatimTurn = async () => {
  const wait = nominatimNext - Date.now();
  nominatimNext = Math.max(Date.now(), nominatimNext) + 1100;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
};

const okPos = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** "12.9716, 77.5946", or a Google / OpenStreetMap / Apple link carrying the position. */
export function typedPosition(q: string): Place | null {
  const s = q.trim();
  const pats = [
    /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, // google.com/maps/...@lat,lon,17z
    /[?&](?:q|query|ll|sll|daddr)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, // google place data
    /[?&]mlat=(-?\d{1,2}\.\d+)&mlon=(-?\d{1,3}\.\d+)/, // openstreetmap.org
    /#map=\d+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (okPos(lat, lon)) return { label: `${round(lat)}, ${round(lon)}`, detail: 'Position as typed', latitude: round(lat), longitude: round(lon), source: 'typed' };
    }
  }
  return null;
}

const photonLabel = (p: any) => {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const label = p.name || street || p.locality || p.district || p.city || p.county || p.state || '';
  const detail = [p.name && street && street !== p.name ? street : null, p.locality, p.district, p.city, p.state, p.postcode, p.country]
    .filter((x, i, a) => x && x !== label && a.indexOf(x) === i)
    .join(', ');
  return { label: String(label), detail };
};

async function photonSearch(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const bias = near && okPos(near.lat, near.lon) ? near : { lat: 21.0, lon: 78.9 }; // India, unless the company already has a site elsewhere
  const url = `${PHOTON()}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=${bias.lat}&lon=${bias.lon}&location_bias_scale=0.3`;
  const res = await guardedRequest('GET', url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 6_000 });
  if (res.status !== 200) throw new Error(`photon ${res.status}`);
  const j: any = JSON.parse(res.text || '{}');
  return (j.features || [])
    .map((f: any) => {
      const [lon, lat] = f.geometry?.coordinates || [];
      return { ...photonLabel(f.properties || {}), latitude: round(Number(lat)), longitude: round(Number(lon)), source: 'photon' as const };
    })
    .filter((p: Place) => p.label && okPos(p.latitude, p.longitude));
}

async function nominatimSearch(q: string): Promise<Place[]> {
  await nominatimTurn();
  const res = await guardedRequest('GET', `${NOMINATIM()}/search?format=jsonv2&addressdetails=0&limit=6&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' }, timeoutMs: 8_000 });
  if (res.status !== 200) throw new Error(`nominatim ${res.status}`);
  const rows: any[] = JSON.parse(res.text || '[]');
  return rows
    .map((r) => {
      const parts = String(r.display_name || '').split(', ');
      return { label: r.name || parts[0] || '', detail: parts.slice(r.name ? 0 : 1).filter((x) => x !== r.name).join(', '), latitude: round(Number(r.lat)), longitude: round(Number(r.lon)), source: 'nominatim' as const };
    })
    .filter((p) => p.label && okPos(p.latitude, p.longitude));
}

export async function searchPlaces(raw: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, 200);
  const typed = typedPosition(q);
  if (typed) return [typed];
  if (q.length < 3) return [];
  const nearKey = near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : '';
  return cached(`s|${q.toLowerCase()}|${nearKey}`, async () => {
    try {
      const r = await photonSearch(q, near);
      if (r.length) return r;
    } catch {
      /* fall through to Nominatim */
    }
    return nominatimSearch(q).catch(() => []);
  });
}

/** What is at a point — shown when the pin is moved, and kept as the site's address. */
export async function placeAt(lat: number, lon: number): Promise<{ address: string } | null> {
  if (!okPos(lat, lon)) return null;
  return cached(`r|${lat.toFixed(5)},${lon.toFixed(5)}`, async () => {
    try {
      const res = await guardedRequest('GET', `${PHOTON()}/reverse?lat=${lat}&lon=${lon}&lang=en&limit=1`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 6_000 });
      if (res.status === 200) {
        const f = JSON.parse(res.text || '{}').features?.[0];
        if (f) {
          const { label, detail } = photonLabel(f.properties || {});
          return { address: [label, detail].filter(Boolean).join(', ') };
        }
      }
    } catch {
      /* fall through */
    }
    try {
      await nominatimTurn();
      const res = await guardedRequest('GET', `${NOMINATIM()}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' }, timeoutMs: 8_000 });
      if (res.status === 200) {
        const j = JSON.parse(res.text || '{}');
        if (j.display_name) return { address: String(j.display_name) };
      }
    } catch {
      /* nothing */
    }
    return null;
  });
}

export const clearGeocodeCache = () => cache.clear();
