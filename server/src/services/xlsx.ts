import { deflateRawSync } from 'node:zlib';

/**
 * One sheet as an Excel workbook (.xlsx), with nothing but Node.
 *
 * The server had CSV and no Excel: every workbook so far was built in the
 * browser. A file another product imports (a payroll's attendance upload) is
 * built here so the figures in it are the server's, and it needs no more than
 * this: a header row, text cells and number cells. Text is written inline
 * (no shared-strings part), which Excel, LibreOffice and the common import
 * libraries all read.
 */

export type XlsxCell = string | number | null | undefined;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of these files (deflate), as the .xlsx container wants it. */
export function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  /* A fixed date (1 Jan 2000): the same rows give the same bytes. */
  const DOS_TIME = 0;
  const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(f.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

/* XML 1.0 has no place for control characters other than tab, line feed and carriage return. */
const xml = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A1, B1 … Z1, AA1: the cell reference Excel expects on every cell. */
export const cellRef = (col: number, row: number) => {
  let n = col + 1;
  let letters = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    letters = String.fromCharCode(65 + r) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row + 1}`;
};

const sheetName = (name: string) => (name.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Sheet1').slice(0, 31);

/**
 * A workbook with one sheet. The first row is the header (bold); a number
 * stays a number so the other product reads 26.5 as 26.5, a string stays text
 * so an employee code keeps its leading zeros.
 */
export function xlsxBuffer(input: { sheet: string; headers: string[]; rows: XlsxCell[][] }): Buffer {
  const cell = (v: XlsxCell, c: number, r: number, style = '') => {
    const ref = cellRef(c, r);
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
  };
  const lines = [
    `<row r="1">${input.headers.map((h, c) => cell(h, c, 0, ' s="1"')).join('')}</row>`,
    ...input.rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, c, i + 1)).join('')}</row>`),
  ];
  const widths = input.headers.map((h, c) => {
    const longest = Math.max(h.length, ...input.rows.slice(0, 500).map((r) => String(r[c] ?? '').length));
    return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(48, Math.max(8, longest + 2))}" customWidth="1"/>`;
  });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = [
    {
      name: '[Content_Types].xml',
      data: `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName(input.sheet))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `${head}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.join('')}</cols><sheetData>${lines.join('')}</sheetData></worksheet>`,
    },
  ];
  return zip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })));
}
