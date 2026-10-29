import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { excelSerialToIso, readXlsx } from '../packages/ui/src/utils/xlsx';

/*
 * A minimal workbook built byte by byte: the reader must take it as Excel
 * writes it (deflated parts) and as some tools do (stored parts).
 */
function zip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text, stored] of files) {
    const raw = enc.encode(text);
    const data = stored ? raw : deflateRawSync(raw);
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, stored ? 0 : 8, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30); local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, stored ? 0 : 8, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end]);
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const workbook = () => zip([
  ['xl/workbook.xml', `<workbook ${NS}><sheets><sheet name="People" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', true],
  ['xl/sharedStrings.xml', `<sst ${NS}><si><t>Employee ID</t></si><si><t>Name</t></si><si><t>Joining date</t></si><si><r><t>Rohan </t></r><r><t>Mehta</t></r></si></sst>`],
  ['xl/styles.xml', `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`],
  ['xl/worksheets/sheet1.xml', `<worksheet ${NS}><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>IM-901</t></is></c><c r="B2" t="s"><v>3</v></c><c r="D2" s="1"><v>46329</v></c></row>
    <row r="3"/>
  </sheetData></worksheet>`],
]);

/* A time sheet: In as a time of day (h:mm, built-in format 20) and a punch log's date-and-time cell (format 22). */
const timeSheet = () => zip([
  ['xl/workbook.xml', `<workbook ${NS}><sheets><sheet name="Days" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', true],
  ['xl/styles.xml', `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="165" formatCode="hh:mm AM/PM"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="20"/><xf numFmtId="22"/><xf numFmtId="165"/></cellXfs></styleSheet>`],
  ['xl/worksheets/sheet1.xml', `<worksheet ${NS}><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>In</t></is></c><c r="B1" t="inlineStr"><is><t>Punch</t></is></c><c r="C1" t="inlineStr"><is><t>Out</t></is></c></row>
    <row r="2"><c r="A2" s="1"><v>0.3784722</v></c><c r="B2" s="2"><v>46329.3784722</v></c><c r="C2" s="3"><v>0.7569444</v></c></row>
  </sheetData></worksheet>`],
]);

describe('reading an Excel workbook', () => {
  it('reads time cells as HH:MM and date-and-time cells as both, not as 30 December 1899', async () => {
    const sheet = await readXlsx(timeSheet());
    expect(sheet.rows).toEqual([['09:05', '2026-11-03 09:05', '18:10']]);
  });

  it('turns Excel day numbers into dates', () => {
    expect(excelSerialToIso(46329)).toBe('2026-11-03');
    expect(excelSerialToIso(1)).toBe('1899-12-31');
  });

  it('reads the first sheet: shared and inline strings, a date-formatted cell, a skipped column, and drops empty rows', async () => {
    const sheet = await readXlsx(workbook());
    expect(sheet.headers).toEqual(['Employee ID', 'Name', '', 'Joining date']);
    expect(sheet.rows).toEqual([['IM-901', 'Rohan Mehta', '', '2026-11-03']]);
  });

  it('says plainly when the file is not a workbook', async () => {
    await expect(readXlsx(new Blob(['Name,Code\nA,1']))).rejects.toThrow(/not an Excel workbook/);
  });
});
