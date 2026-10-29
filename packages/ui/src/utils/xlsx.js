/**
 * Reads the first worksheet of an .xlsx file in the browser, with no library.
 *
 * An .xlsx is a zip of XML parts. The zip is walked from its central
 * directory; deflated parts go through the browser's own DecompressionStream;
 * the XML is read with DOMParser. Shared strings, inline strings, numbers,
 * booleans and dates (cells whose number format is a date, by the workbook's
 * own styles) are understood. Formulas give their cached value. What comes
 * back has the same shape as the CSV reader's: a header row and rows as
 * arrays, so the import does not care which file it was given.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/* Excel's built-in date and time formats: dates, times of day, and the one that is both. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 27, 30, 36, 50, 57]);
const TIME_FORMAT_IDS = new Set([18, 19, 20, 21, 45, 46, 47]);
const DATETIME_FORMAT_IDS = new Set([22]);
/* Limits a hand-made or hostile file cannot get past: Excel's own last column, and far more rows and bytes than an import takes. */
const MAX_COLUMNS = 16_384;
const MAX_ROWS = 5_000;
const MAX_INFLATED = 50_000_000;

/* Inflated in pieces, stopping once a part grows past what any real sheet needs (a zip bomb stops here, not in the tab's memory). */
async function inflate(bytes) {
  const reader = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_INFLATED) { await reader.cancel(); throw new Error('That workbook is too large to read here. Save the sheet as CSV and upload that.'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The zip's parts by name, each read only when asked for. */
function zipEntries(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not an Excel workbook (.xlsx).');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const names = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== SIG_CENTRAL) throw new Error('That workbook is damaged.');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = names.decode(buf.subarray(at + 46, at + 46 + nameLen));
    entries.set(name, async () => {
      if (view.getUint32(local, true) !== SIG_LOCAL) throw new Error('That workbook is damaged.');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error('That workbook uses a compression this reader does not know.');
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function xmlOf(entries, name) {
  const read = entries.get(name);
  if (!read) return null;
  return new DOMParser().parseFromString(new TextDecoder().decode(await read()), 'application/xml');
}

/* Elements by local name, whatever namespace prefix the writer used. */
const all = (node, tag) => (node ? [...node.getElementsByTagNameNS('*', tag)] : []);
const textOf = (node) => all(node, 't').map((t) => t.textContent || '').join('');

const columnIndex = (ref) => {
  let n = 0;
  for (const ch of String(ref).replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/* Excel counts days from 30 Dec 1899 (its 1900 leap-year quirk included). */
export const excelSerialToIso = (serial) => new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serial) * 86_400_000)).toISOString().slice(0, 10);

/* A time of day is the fraction of the day: 0.375 is 09:00. Rounded to the minute, as a time sheet means it. */
export const excelFractionToHHMM = (serial) => {
  const minutes = Math.round((Number(serial) % 1) * 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

async function firstSheetPath(entries) {
  const book = await xmlOf(entries, 'xl/workbook.xml');
  const rels = await xmlOf(entries, 'xl/_rels/workbook.xml.rels');
  const sheet = all(book, 'sheet')[0];
  const rid = sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet?.getAttribute('r:id');
  const target = all(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

async function dateStyles(entries) {
  const styles = await xmlOf(entries, 'xl/styles.xml');
  const custom = new Map(all(styles, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '']));
  const xfs = all(all(styles, 'cellXfs')[0], 'xf');
  return xfs.map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') || 0);
    if (DATE_FORMAT_IDS.has(id)) return 'date';
    if (TIME_FORMAT_IDS.has(id)) return 'time';
    if (DATETIME_FORMAT_IDS.has(id)) return 'datetime';
    /* A custom format: day or year codes make a date, hour or second codes a time; "m" is minutes beside an hour and a month otherwise. Quoted text and [colour] codes do not count. */
    const code = (custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
    if (/^[#0.,%\s]*$/.test(code)) return null;
    const time = /[hs]/i.test(code);
    const date = /[dy]/i.test(code) || (!time && /m/i.test(code));
    return date && time ? 'datetime' : date ? 'date' : time ? 'time' : null;
  });
}

/** { headers: string[], rows: string[][] } from the first sheet; the first non-empty row is the header. */
export async function readXlsx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = zipEntries(buf);
  const shared = all(await xmlOf(entries, 'xl/sharedStrings.xml'), 'si').map(textOf);
  const isDate = await dateStyles(entries).catch(() => []);
  const sheet = await xmlOf(entries, await firstSheetPath(entries));
  if (!sheet) throw new Error('That workbook has no sheet to read.');
  const grid = [];
  for (const row of all(sheet, 'row')) {
    if (grid.length >= MAX_ROWS) break;
    const cells = [];
    for (const c of all(row, 'c')) {
      const type = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(all(c, 'is')[0]);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = v;
      else if (v !== '' && isDate[Number(c.getAttribute('s') || 0)]) {
        const kind = isDate[Number(c.getAttribute('s') || 0)];
        /* A time sheet's In and Out are times of day; a punch log's one cell is the date and the time. */
        value = kind === 'time' ? excelFractionToHHMM(v) : kind === 'datetime' ? `${excelSerialToIso(Math.floor(Number(v)))} ${excelFractionToHHMM(v)}` : excelSerialToIso(v);
      }
      else value = v;
      /* A cell without a reference is the next one along (allowed by the format). */
      const ref = c.getAttribute('r');
      const col = ref ? columnIndex(ref) : cells.length;
      if (col < 0 || col >= MAX_COLUMNS) continue;
      cells[col] = String(value).trim();
    }
    grid.push(Array.from(cells, (x) => x ?? ''));
  }
  const filled = grid.filter((r) => r.some((x) => x));
  if (!filled.length) return { headers: [], rows: [] };
  const width = filled.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return { headers: pad(filled[0]), rows: filled.slice(1).map(pad) };
}
