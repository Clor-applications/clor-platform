/**
 * A small RFC 4180 CSV reader.
 *
 * Written rather than pulled in because the surface actually needed is narrow,
 * and because the failure that matters — a quoted field containing a comma,
 * a newline, or an escaped quote — is exactly what a naive `split(',')` gets
 * wrong on real accounting exports (party names with commas, addresses with
 * newlines).
 */

export type CsvRow = Record<string, string>;

/** Splits CSV text into rows of raw cells, honouring quotes and embedded newlines. */
export function parseCsvCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Normalise line endings first so CRLF files behave like LF ones.
  const src = String(text ?? '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        // "" inside a quoted field is a literal quote.
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  // Whatever is left after the last newline is still a row, unless the file
  // simply ended with one.
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses CSV into objects keyed by header.
 *
 * Headers are lower-cased and trimmed so "Invoice No", "invoice no" and
 * "INVOICE NO " are the same column — an import that rejects a file over
 * header capitalisation is an import nobody uses twice.
 */
export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const cells = parseCsvCells(text).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!cells.length) return { headers: [], rows: [] };

  const headers = cells[0].map((h) => String(h).trim().toLowerCase());
  const rows = cells.slice(1).map((cols) => {
    const obj: CsvRow = {};
    headers.forEach((h, idx) => {
      obj[h] = String(cols[idx] ?? '').trim();
    });
    return obj;
  });

  return { headers, rows };
}

/** Quotes a cell only when it needs it. */
const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const head = headers.map(cell).join(',');
  const body = rows.map((r) => headers.map((h) => cell(r[h])).join(','));
  return [head, ...body].join('\n');
}
