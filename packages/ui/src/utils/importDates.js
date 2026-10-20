/**
 * A date from a spreadsheet, as YYYY-MM-DD — or null when it cannot be read.
 *
 * Imports asked for YYYY-MM-DD and refused everything else, but an Indian
 * sheet says 15/10/2026, 15-10-2026, 15.10.26 or 15-Oct-2026, and Excel saved
 * as CSV can leave the serial number (46310). Day comes first, as India
 * writes it; a value that is not a real calendar day is refused rather than
 * rolled over (31/02 is not 3 March).
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export function toIsoDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})[\s/.,-]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const word = m[2].toLowerCase();
    const month = MONTHS[word] ?? MONTHS[word.slice(0, 3)];
    return month ? iso(+m[3], month, +m[1]) : null;
  }
  /* Excel's day count from 1899-12-30, for the years an attendance sheet can hold. */
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n >= 36526 && n <= 73051) {
      const t = new Date(Date.UTC(1899, 11, 30) + n * 86_400_000);
      return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
  }
  return null;
}

/**
 * Rows with their date columns rewritten to YYYY-MM-DD where they could be
 * read. A value that cannot be read is left as typed, so the server's
 * row-by-row verdict names it.
 */
export function normaliseDateColumns(rows, keys) {
  return rows.map((row) => {
    const out = { ...row };
    for (const key of keys) {
      if (out[key] == null || String(out[key]).trim() === '') continue;
      const read = toIsoDate(out[key]);
      if (read) out[key] = read;
    }
    return out;
  });
}
