/**
 * A small PDF writer for letters (docs/people/02-PRD.md DOC-04): A4 pages of
 * Helvetica text, nothing else. Written by hand so the server carries no PDF
 * dependency; the content streams are left uncompressed, so the text of a
 * letter can be read back from the file (and asserted in tests).
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const FONT_SIZE = 11;
const LEADING = 16;
const TITLE_SIZE = 14;
/* Helvetica averages about half an em per character; a conservative wrap width. */
const CHARS_PER_LINE = Math.floor((PAGE_W - 2 * MARGIN) / (FONT_SIZE * 0.52));

/** Characters outside WinAnsi are swapped for what Helvetica can show. */
const ascii = (s: string) =>
  s
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/–|—/g, '-')
    .replace(/…/g, '...')
    .replace(/₹/g, 'Rs. ')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ]/g, '?');
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Wrap one paragraph into lines; an empty paragraph is a blank line. */
function wrap(paragraph: string): string[] {
  if (!paragraph.trim()) return [''];
  const out: string[] = [];
  for (const raw of paragraph.split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      if (line && line.length + 1 + w.length > CHARS_PER_LINE) {
        out.push(line);
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    out.push(line);
  }
  return out;
}

export type PdfText = { title: string; paragraphs: string[]; footer?: string };

/** The PDF bytes for a title and paragraphs, over as many pages as they need. */
export function textPdf(doc: PdfText): Buffer {
  const lines: Array<{ text: string; size: number; bold?: boolean }> = [{ text: ascii(doc.title), size: TITLE_SIZE, bold: true }, { text: '', size: FONT_SIZE }];
  for (const p of doc.paragraphs) for (const l of wrap(ascii(p))) lines.push({ text: l, size: FONT_SIZE });
  const perPage = Math.floor((PAGE_H - 2 * MARGIN - 20) / LEADING);
  const pages: Array<typeof lines> = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pagesId = objects.length + 1 + pages.length * 2; /* the Pages object comes after every page and stream */
  const pageIds: number[] = [];
  pages.forEach((pageLines, index) => {
    let y = PAGE_H - MARGIN;
    const ops: string[] = ['BT'];
    for (const l of pageLines) {
      ops.push(`/${l.bold ? 'F2' : 'F1'} ${l.size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm (${escape(l.text)}) Tj`);
      y -= l.size > FONT_SIZE ? LEADING + 6 : LEADING;
    }
    const footer = `${doc.footer ? `${ascii(doc.footer)}  -  ` : ''}Page ${index + 1} of ${pages.length}`;
    ops.push(`/F1 8 Tf 1 0 0 1 ${MARGIN} ${(MARGIN - 20).toFixed(2)} Tm (${escape(footer)}) Tj`);
    ops.push('ET');
    const stream = ops.join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  const pagesObj = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  if (pagesObj !== pagesId) throw new Error('pdf: object numbering drifted');
  const catalog = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
