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
/* Excel's built-in date and time formats. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

async function inflate(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
    if (DATE_FORMAT_IDS.has(id)) return true;
    /* A custom format is a date when it has day, month or year codes outside quoted text. */
    const code = (custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
    return /[dmy]/i.test(code) && !/^[#0.,%\s]*$/.test(code);
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
    const cells = [];
    for (const c of all(row, 'c')) {
      const type = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(all(c, 'is')[0]);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = v;
      else if (v !== '' && isDate[Number(c.getAttribute('s') || 0)]) value = excelSerialToIso(v);
      else value = v;
      cells[columnIndex(c.getAttribute('r') || '')] = String(value).trim();
    }
    grid.push(Array.from(cells, (x) => x ?? ''));
  }
  const filled = grid.filter((r) => r.some((x) => x));
  if (!filled.length) return { headers: [], rows: [] };
  const width = Math.max(...filled.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return { headers: pad(filled[0]), rows: filled.slice(1).map(pad) };
}
