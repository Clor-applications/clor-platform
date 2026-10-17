/**
 * A CSV as a spreadsheet saves it (RFC 4180: quotes, doubled quotes, commas
 * and line breaks inside quotes), to rows of objects keyed by the header.
 * Semicolons and tabs are taken as separators when the header has no commas,
 * which is how Excel saves in some locales and how reader software exports.
 */
export function parseCsv(text: string, maxRows = 20_000): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = firstLine.includes(',') ? ',' : firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) table.push(row);
      row = [];
      if (table.length > maxRows) break;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) table.push(row);
  }
  if (!table.length) return { headers: [], rows: [] };
  const headers = table[0].map((h) => h.trim());
  const rows = table.slice(1, maxRows + 1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows };
}
