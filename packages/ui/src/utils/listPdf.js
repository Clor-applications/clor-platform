/**
 * A list screen, on paper.
 *
 * The same rows and the same columns the screen is showing — not a fresh query.
 * An export that quietly widens the filter produces a document that disagrees
 * with the screen it came from, and the person holding it has no way to tell
 * which one is right.
 *
 * jsPDF loads on demand: it is ~100KB gzipped and only matters the moment
 * somebody exports.
 */
import { notify } from '../components/ui/notify';

const loadPdf = async () => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
};

const cellValue = (col, row) => {
  const raw = typeof col.value === 'function' ? col.value(row) : row?.[col.key];
  if (raw === null || raw === undefined) return '';
  return typeof raw === 'number' ? raw.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(raw);
};

/**
 * `subtitle` carries what is currently filtering the view. Printing it is the
 * difference between "our invoices" and "our invoices for August, unpaid".
 */
export async function exportListPdf({ title, subtitle = '', fileName, columns, rows, footNote = '', metaLines = [], footerRows = [], reportStyle = 'default' }) {
  if (!Array.isArray(rows) || !rows.length) {
    notify.error('Nothing to export in the current view.');
    return;
  }
  try {
    const { jsPDF, autoTable } = await loadPdf();
    const cols = (columns || []).filter(Boolean);
    // Landscape once the table is wide enough that portrait would squeeze the
    // figures into two lines each.
    const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });

    const polished = reportStyle === 'statement';
    let startY = 56;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(polished ? 16 : 14);
    doc.setTextColor(15, 23, 42);
    doc.text(String(metaLines[0] || title || 'Export'), 40, 40);
    const details = metaLines.length ? metaLines.slice(1) : (subtitle ? [subtitle] : []);
    if (details.length) {
      doc.setFontSize(9);
      details.forEach((line, index) => {
        const isLedgerTitle = polished && String(line).startsWith('Ledger Statement');
        doc.setTextColor(isLedgerTitle ? 15 : 100, isLedgerTitle ? 23 : 116, isLedgerTitle ? 42 : 139);
        doc.setFont('helvetica', isLedgerTitle ? 'bold' : 'normal');
        doc.text(String(line), 40, 58 + (index * 13));
      });
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      startY = 92 + ((details.length - 1) * 13);
    }

    const bodyRows = rows.map((row) => cols.map((c) => cellValue(c, row)));
    const tailRows = footerRows.map((row) => cols.map((c) => cellValue(c, row)));

    autoTable(doc, {
      startY,
      head: [cols.map((c) => c.label)],
      body: [...bodyRows, ...tailRows],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, fillColor: [255, 255, 255], lineColor: [226, 232, 240], lineWidth: polished ? 0.35 : 0.15 },
      headStyles: polished
        ? { fillColor: [245, 247, 250], textColor: [15, 23, 42], fontStyle: 'bold', lineColor: [226, 232, 240], lineWidth: 0.6 }
        : { fillColor: [245, 245, 244], textColor: 40, fontStyle: 'bold' },
      columnStyles: cols.reduce((acc, c, i) => {
        if (c.align === 'right') acc[i] = { halign: 'right' };
        return acc;
      }, {}),
      margin: { left: 40, right: 40 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index >= bodyRows.length) {
          data.cell.styles.fillColor = [245, 247, 250];
          data.cell.styles.textColor = [15, 23, 42];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.lineColor = [226, 232, 240];
          data.cell.styles.lineWidth = 0.5;
        }
      },
    });

    if (footNote) {
      const y = (doc.lastAutoTable?.finalY || 80) + 16;
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(String(footNote), 40, y);
    }

    doc.save(`${fileName || 'export'}.pdf`);
    notify.success(`${rows.length} row(s) exported to PDF.`);
  } catch (err) {
    // A failed export must say so. Silently doing nothing reads as a dead
    // button, and the next thing tried is usually clicking it again.
    notify.error(`PDF export failed: ${String(err?.message || err)}`);
  }
}

export default exportListPdf;
