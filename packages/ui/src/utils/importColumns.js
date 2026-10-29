/**
 * A spreadsheet's own headings, matched to an import's columns.
 *
 * Imports asked for the template's keys (employeeCode, checkIn) and found none
 * in a real attendance sheet, which says "Emp Code", "In Time", "Out". A
 * heading matches a column by its key, its label (without the hint in
 * brackets) or one of its other names, ignoring case, spaces and punctuation.
 * Headings that match nothing are left out, as extra columns always were.
 */

const norm = (s) => String(s ?? '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');

/** heading → column key, for the headings that match a column; the first heading to claim a column keeps it. */
export function matchColumns(headers, columns) {
  const byName = new Map();
  for (const c of columns) {
    for (const name of [c.key, c.label, ...(c.aliases || [])]) {
      const n = norm(name);
      if (n && !byName.has(n)) byName.set(n, c.key);
    }
  }
  const taken = new Set();
  const out = new Map();
  for (const h of headers) {
    const key = byName.get(norm(h));
    if (key && !taken.has(key)) {
      out.set(h, key);
      taken.add(key);
    }
  }
  return out;
}

/** Rows keyed by column key: from objects keyed by heading (the CSV reader) or arrays in heading order (the Excel reader). */
export function rowsByColumn(headers, rows, mapping) {
  return rows.map((r) => {
    const out = {};
    headers.forEach((h, i) => {
      const key = mapping.get(h);
      if (!key) return;
      const v = Array.isArray(r) ? r[i] : r[h];
      out[key] = v == null ? '' : String(v).trim();
    });
    return out;
  });
}

/**
 * A time of day as HH:MM, or null when it cannot be read: 9:30, 09.30, 0930,
 * 9:30 pm, 09:30:15, Excel's fraction of a day (0.395833) and a date with a
 * time (2026-10-15 09:30, as a punch log writes it).
 */
export function toHHMM(value) {
  let s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  const withDate = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}[ t]+(.+)$/.exec(s);
  if (withDate) s = withDate[1].trim();
  if (/^0?\.\d+$|^0$/.test(s)) {
    const minutes = Math.round(Number(s) * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2})(?:[:.](\d{2})|(\d{2}))?(?:[:.]\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  const half = m[4]?.[0];
  if (half) {
    if (h < 1 || h > 12) return null;
    if (half === 'p' && h !== 12) h += 12;
    if (half === 'a' && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Rows with their time columns rewritten to HH:MM where they could be read; the rest left as typed, for the check to name. */
export function normaliseTimeColumns(rows, keys) {
  return rows.map((row) => {
    const out = { ...row };
    for (const key of keys) {
      if (out[key] == null || String(out[key]).trim() === '') continue;
      const read = toHHMM(out[key]);
      if (read) out[key] = read;
    }
    return out;
  });
}

/* How attendance sheets write a day's status, to the words CLOR uses. */
const STATUS_WORDS = new Map([
  ['p', 'PRESENT'], ['pr', 'PRESENT'], ['present', 'PRESENT'],
  ['a', 'ABSENT'], ['ab', 'ABSENT'], ['absent', 'ABSENT'],
  ['hd', 'HALF_DAY'], ['half', 'HALF_DAY'], ['halfday', 'HALF_DAY'], ['½', 'HALF_DAY'],
  ['l', 'ON_LEAVE'], ['lv', 'ON_LEAVE'], ['leave', 'ON_LEAVE'], ['onleave', 'ON_LEAVE'],
  ['wo', 'WEEKLY_OFF'], ['off', 'WEEKLY_OFF'], ['weeklyoff', 'WEEKLY_OFF'],
  ['ho', 'HOLIDAY'], ['hol', 'HOLIDAY'], ['holiday', 'HOLIDAY'],
]);

/** A status as a sheet writes it (P, A, HD, Leave, WO) as CLOR's word; anything else as typed. */
export const toStatus = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return STATUS_WORDS.get(s.toLowerCase().replace(/[\s_-]+/g, '')) || s;
};
