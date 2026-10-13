/**
 * CSV in and out, dependency-free.
 *
 * Exports are CSV rather than .xlsx for the same reason as ledgerExport: the
 * xlsx packages on npm carry unfixed advisories, and an unformatted grid loses
 * nothing in CSV. A UTF-8 BOM keeps ₹ intact when Excel opens the file.
 */

/**
 * A cell a spreadsheet will not execute.
 *
 * Excel, LibreOffice and Google Sheets treat a value beginning `=`, `+`, `-`,
 * `@`, tab or carriage return as a formula, and this product's exports are
 * files it hands to an accountant to open on their own machine. A customer
 * saved as `=cmd|'/c calc'!A1` is a name in this app and a command on theirs —
 * and the person who typed it is not the person who opens the file.
 *
 * Prefixed with an apostrophe, which every spreadsheet reads as "this is text"
 * and does not display.
 *
 * A number is left alone. `-500` is a credit, not an injection, and quoting it
 * would turn every negative figure in the book into text that will not sum —
 * so the guard applies only where the value is not a number to begin with.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export const csvSafeValue = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (!FORMULA_START.test(s)) return s;
  if (s.trim() !== '' && Number.isFinite(Number(s))) return s;
  return `'${s}`;
};

const cell = (v) => {
  const s = csvSafeValue(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** rows: array of objects. columns: [{ key, label }]. */
export function downloadCsv({ fileName, columns, rows, prefixRows = [], footerRows = [] }) {
  const cols = Array.isArray(columns) ? columns : [];
  const data = [
    ...(Array.isArray(prefixRows) ? prefixRows : []),
    ...(prefixRows?.length ? [[], []] : []),
    cols.map((c) => c.label ?? c.key),
    ...(Array.isArray(rows) ? rows : []).map((r) => cols.map((c) => (typeof c.value === 'function' ? c.value(r) : r?.[c.key]))),
    ...(Array.isArray(footerRows) ? footerRows.map((r) => cols.map((c) => (typeof c.value === 'function' ? c.value(r) : r?.[c.key]))) : []),
  ];
  const csv = '\ufeff' + data.map((row) => row.map(cell).join(',')).join('\r\n');
  const safe = `${String(fileName || 'export').replace(/[\\/:*?"<>|]+/g, '-')}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A header-only CSV the user fills in and imports back. */
export function downloadCsvTemplate({ fileName, columns, sample }) {
  downloadCsv({ fileName, columns, rows: Array.isArray(sample) ? sample : sample ? [sample] : [] });
}

/**
 * Parses CSV text into objects keyed by the header row.
 * Handles quoted fields, embedded commas/newlines and doubled quotes — the
 * three things a spreadsheet actually produces.
 */
export function parseCsv(text) {
  const src = String(text || '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => String(h).trim());
  const out = nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = String(r[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows: out };
}

/** Reads a File as text (import file pickers). */
export const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsText(file);
  });
