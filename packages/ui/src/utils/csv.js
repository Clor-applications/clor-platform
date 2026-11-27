import Papa from 'papaparse';

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
  const csv = '\ufeff' + Papa.unparse(data.map((row) => row.map(csvSafeValue)), { newline: '\r\n' });
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
 * A note row in an import template: `# …` in the first cell and nothing after
 * it. CLOR's People and Attendance templates explain each column this way
 * (server: services/importTemplates.ts), and a file filled in under them comes
 * back with the notes still on top.
 */
export const isCommentRow = (cells) => {
  const filled = (Array.isArray(cells) ? cells : []).map((c) => String(c ?? '').trim()).filter(Boolean);
  return filled.length === 1 && String(cells[0] ?? '').trim().startsWith('#');
};

/**
 * Parses CSV text into objects keyed by the header row.
 * Handles quoted fields, embedded commas/newlines and doubled quotes — the
 * three things a spreadsheet actually produces. `skipComments` leaves out
 * a template's note rows (isCommentRow), so the heading row is found under them.
 */
export function parseCsv(text, { skipComments = false } = {}) {
  const src = String(text || '').replace(/^\ufeff/, '');
  const rows = Papa.parse(src, { delimiter: ',' }).data;
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== '') && !(skipComments && isCommentRow(r)));
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
