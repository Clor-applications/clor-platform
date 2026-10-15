import { randomInt } from 'node:crypto';

/**
 * The employee portal's pure rules, after ClorTime (server.js portal-invite,
 * routes/mobile_attendance.js). No database here, so each is tested alone.
 */

/** No 0/O, 1/I: read out over a phone or copied from paper without mistakes. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const CODE_TTL_MS = 24 * 3_600_000;

export const newActivationCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
/** "abcd-efgh", " ABCD EFGH " and "ABCDEFGH" are the same code. */
export const normaliseCode = (s: unknown) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Shown as ABCD-EFGH. */
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** A password the person chose: 8+ characters, with a letter and a digit. */
export const passwordProblem = (p: unknown): string | null => {
  const s = String(p || '');
  if (s.length < 8) return 'Use at least 8 characters.';
  if (s.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Use at least one letter and one digit.';
  return null;
};

/** Metres between two points on the earth (haversine). */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const validPosition = (lat: unknown, lon: unknown) =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** A phone fix rougher than this cannot tell inside the gate from across the road. */
export const MAX_ACCURACY_M = 150;

type Fence = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };

/**
 * Which site a position is inside. The nearest one it is inside wins; if it is
 * inside none, the nearest one and how far, for the message.
 */
export function matchFence<T extends Fence>(pos: { latitude: number; longitude: number }, fences: T[]) {
  let inside: { fence: T; distance: number } | null = null;
  let nearest: { fence: T; distance: number } | null = null;
  for (const fence of fences) {
    const distance = distanceMeters(pos, fence);
    if (!nearest || distance < nearest.distance) nearest = { fence, distance };
    if (distance <= fence.radiusMeters && (!inside || distance < inside.distance)) inside = { fence, distance };
  }
  return { inside, nearest };
}

export const describeDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Punch selfies: JPEG or PNG only, by their first bytes rather than what the phone says; 2 MB at most. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export function decodePhoto(input: unknown): { mime: string; data: Buffer } | { error: string } | null {
  if (input == null || input === '') return null;
  const s = String(input);
  const b64 = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { error: 'The photo could not be read.' };
  const data = Buffer.from(b64, 'base64');
  if (!data.length) return { error: 'The photo could not be read.' };
  if (data.length > PHOTO_MAX_BYTES) return { error: 'The photo is larger than 2 MB.' };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', data };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', data };
  return { error: 'The photo must be a JPEG or PNG.' };
}

/** Phone punches alternate: in, out, in… from the shift day's last punch. */
export const nextDirection = (punches: Array<{ kind: string | null }>): 'IN' | 'OUT' => {
  if (!punches.length) return 'IN';
  const last = punches[punches.length - 1].kind;
  if (last === 'IN') return 'OUT';
  if (last === 'OUT') return 'IN';
  return punches.length % 2 ? 'OUT' : 'IN';
};

/** Two taps on the button are one punch. */
export const MIN_GAP_MS = 60_000;
