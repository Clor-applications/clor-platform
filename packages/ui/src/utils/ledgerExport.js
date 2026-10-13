import { csvSafeValue } from './csv';
import { formatDateIn, localDateIso } from './dates';

/**
 * jsPDF loads on demand: it is ~100KB of gzip that only matters the moment
 * someone exports, and it was riding in the first-paint bundle.
 */
const loadPdf = async () => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
};

const safeNum = (n) => {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const r2 = (n) => Math.round(safeNum(n) * 100) / 100;

const DEFAULT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'particulars', label: 'Particulars' },
  { key: 'voucherType', label: 'Voucher Type' },
  { key: 'voucherNo', label: 'Voucher No' },
  { key: 'narration', label: 'Narration' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'runningBalance', label: 'Running Balance' },
];

const normalizeColumns = (columns) => {
  const cols = Array.isArray(columns) ? columns : null;
  if (!cols || cols.length === 0) return DEFAULT_COLUMNS;
  return cols
    .map((c) => {
      if (!c) return null;
      if (typeof c === 'string') return { key: c, label: c };
      const key = String(c.key || '').trim();
      if (!key) return null;
      return { key, label: String(c.label || key) };
    })
    .filter(Boolean);
};

const isNumericKey = (k) => {
  const key = String(k || '').trim();
  return ['debit', 'credit', 'runningBalance', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'total'].includes(key);
};

const cellValue = (row, key) => {
  const r = row || {};
  const k = String(key || '').trim();
  /*
   * The stored ISO date, in the product's format — the same call the ledger
   * screen makes, so an exported row and the row it was exported from cannot
   * disagree. It used to go through `new Date(r.date)`, which reads a bare
   * date as UTC midnight and hands back the previous day west of Greenwich,
   * and then through `toLocaleDateString()`, which asked the reader's machine
   * what shape a date is. A statement filed from could say either.
   */
  if (k === 'date') return formatDateIn(r?.date);
  if (k === 'particulars') return String(r?.particulars || '');
  if (k === 'voucherType') return String(r?.voucherType || '');
  if (k === 'voucherNo') return String(r?.voucherNo || '');
  if (k === 'narration') return String(r?.narration || '');
  if (k === 'partyName') return String(r?.partyName || '');
  if (k === 'partyGstin') return String(r?.partyGstin || '');
  if (k === 'partyPan') return String(r?.partyPan || '');
  if (k === 'partyBillingAddress') return String(r?.partyBillingAddress || '');
  if (k === 'partyShippingAddress') return String(r?.partyShippingAddress || '');
  if (k === 'placeOfSupply') return String(r?.placeOfSupply || '');
  if (k === 'itemsSummary') return String(r?.itemsSummary || '');
  if (k === 'reference') return String(r?.reference || '');
  if (k === 'cashBank') return String(r?.cashBank || '');

  if (isNumericKey(k)) return r2(r?.[k]);
  return String(r?.[k] ?? '');
};

/** Quotes a CSV cell only when it needs it. */
/* The same guard the other export uses — see csvSafeValue. */
const csvCell = (v) => {
  const t = csvSafeValue(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * Spreadsheet export, as CSV rather than .xlsx.
 *
 * The xlsx package carried a high-severity advisory with no fixed release on
 * npm, and the one alternative tried (exceljs) shipped its own vulnerable
 * transitive dependencies — trading one advisory for four. This export was
 * always an unformatted grid, so CSV with a UTF-8 BOM loses nothing but the
 * file extension: Excel opens it with columns split and the ₹ sign intact,
 * and the export path now carries zero dependencies.
 */
export const exportLedgerToExcel = ({
  companyName,
  companyAddress = '',
  ledgerName,
  periodFrom = '',
  periodTo = '',
  openingBalance,
  closingBalance,
  rows,
  fileName,
  columns,
}) => {
  const cols = normalizeColumns(columns);

  const data = [
    ['Company', companyName || ''],
    ['Address', companyAddress || ''],
    ['Ledger Statement of', ledgerName || ''],
    ['Period', `${periodFrom ? formatDateIn(periodFrom) : 'Beginning'} to ${periodTo ? formatDateIn(periodTo) : formatDateIn(localDateIso())}`],
    ['As of', formatDateIn(localDateIso())],
    ['Opening Balance', r2(openingBalance)],
    [], [],
    cols.map((c) => c.label),
    ...(Array.isArray(rows) ? rows : []).map((r) =>
      cols.map((c) => {
        const v = cellValue(r, c.key);
        return isNumericKey(c.key) ? r2(v) : v;
      })
    ),
    cols.map((c) => c.key === 'particulars' ? 'Closing Balance' : c.key === 'runningBalance' ? r2(closingBalance) : ''),
  ];

  // BOM first: without it Excel guesses the encoding and mangles ₹.
  const csv = '\ufeff' + data.map((row) => row.map(csvCell).join(',')).join('\r\n');

  const base = String(fileName || `${ledgerName || 'ledger'}`).replace(/\.xlsx?$/i, '');
  const safeName = `${base.replace(/[\\/:*?"<>|]+/g, '-')}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const exportLedgerToPdf = async ({
  companyName,
  companyAddress = '',
  ledgerName,
  periodFrom = '',
  periodTo = '',
  openingBalance,
  closingBalance,
  rows,
  fileName,
  columns,
}) => {
  const { jsPDF, autoTable } = await loadPdf();
  const cols = normalizeColumns(columns);
  const orientation = cols.length > 8 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });

  const marginX = 40;
  let y = 40;

  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(companyName || 'Company', marginX, y);
  y += 18;

  if (companyAddress) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(String(companyAddress), marginX, y);
    y += 14;
  }

  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Ledger Statement of ${ledgerName || ''}`.trim(), marginX, y);
  y += 14;

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Period: ${periodFrom ? formatDateIn(periodFrom) : 'Beginning'} to ${periodTo ? formatDateIn(periodTo) : formatDateIn(localDateIso())}`, marginX, y);
  y += 14;
  doc.text(`As of: ${formatDateIn(localDateIso())}`, marginX, y);
  y += 14;
  doc.text(`Opening Balance: ${r2(openingBalance)}`, marginX, y);
  y += 32;

  const body = (Array.isArray(rows) ? rows : []).map((r) =>
    cols.map((c) => {
      const v = cellValue(r, c.key);
      if (isNumericKey(c.key)) return r2(v) ? r2(v).toFixed(2) : '';
      return String(v || '');
    })
  );
  body.push(cols.map((c) => c.key === 'particulars' ? 'Closing Balance' : c.key === 'runningBalance' ? r2(closingBalance).toFixed(2) : ''));

  autoTable(doc, {
    startY: y,
    head: [cols.map((c) => c.label)],
    body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak', fillColor: [255, 255, 255], textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.35 },
    headStyles: { fillColor: [245, 247, 250], textColor: [15, 23, 42], fontStyle: 'bold', lineColor: [226, 232, 240], lineWidth: 0.6 },
    didParseCell: (data) => {
      if (!data?.column) return;
      const col = cols[data.column.index];
      if (!col) return;
      if (isNumericKey(col.key)) data.cell.styles.halign = 'right';
      if (data.section === 'body' && data.row.index === body.length - 1) {
        data.cell.styles.fillColor = [245, 247, 250];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.lineWidth = 0.6;
      }
    },
  });

  const safeName = String(fileName || `${ledgerName || 'ledger'}.pdf`).replace(/[\\/:*?"<>|]+/g, '-');
  doc.save(safeName);
};

export const printLedger = ({ companyName, companyAddress = '', ledgerName, periodFrom = '', periodTo = '', openingBalance, closingBalance, rows, columns }) => {
  const safe = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // `arguments` is not bound inside an arrow function, and this module is ESM
  // (so strict mode): reading it threw ReferenceError on the first line of real
  // work, meaning printing a ledger never worked at all. The columns it was
  // reaching for are simply another property of the destructured argument.
  const cols = normalizeColumns(columns);

  const headerHtml = cols
    .map((c) => {
      const cls = isNumericKey(c.key) ? ' class="right"' : '';
      return `<th${cls}>${safe(c.label)}</th>`;
    })
    .join('');

  const htmlRows = (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const tds = cols
        .map((c) => {
          const v = cellValue(r, c.key);
          if (isNumericKey(c.key)) return `<td class="right">${r2(v) ? r2(v).toFixed(2) : ''}</td>`;
          return `<td>${safe(String(v || ''))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  const closingCells = cols.map((c) => {
    if (c.key === 'particulars') return '<td>Closing Balance</td>';
    if (c.key === 'runningBalance') return `<td class="right">${r2(closingBalance).toFixed(2)}</td>`;
    return '<td></td>';
  }).join('');

  const w = window.open('', '_blank');
  if (!w) return;

  w.document.open();
  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safe(ledgerName || 'Ledger')}</title>
  <style>
    body{font-family: Inter,Arial,sans-serif; margin: 24px; color:#0f172a;}
    h1{font-size:18px; margin:0 0 5px;}
    .address{font-size:11px;color:#64748b;margin-bottom:10px;}
    h2{font-size:14px; margin:0 0 7px; font-weight:700; color:#0f172a;}
    .meta{font-size:11px; margin:0 0 28px; color:#64748b;}
    table{width:100%; border-collapse:collapse; font-size:11px;}
    th,td{border:1px solid #e2e8f0; padding:7px; vertical-align:top;}
    th{background:#f5f7fa;color:#0f172a;text-align:left;font-weight:700;}
    tfoot td{background:#f5f7fa;color:#0f172a;font-weight:700;}
    .right{text-align:right;}
  </style>
</head>
<body>
  <h1>${safe(companyName || '')}</h1>
  ${companyAddress ? `<div class="address">${safe(companyAddress)}</div>` : ''}
  <h2>Ledger Statement of ${safe(ledgerName || '')}</h2>
  <div class="meta">Period: ${safe(periodFrom ? formatDateIn(periodFrom) : 'Beginning')} to ${safe(periodTo ? formatDateIn(periodTo) : formatDateIn(localDateIso()))} &nbsp; | &nbsp; As of: ${safe(formatDateIn(localDateIso()))} &nbsp; | &nbsp; Opening: ${r2(openingBalance).toFixed(2)}</div>
  <table>
    <thead>
      <tr>
        ${headerHtml}
      </tr>
    </thead>
    <tbody>
      ${htmlRows}
    </tbody>
    <tfoot><tr>${closingCells}</tr></tfoot>
  </table>
</body>
</html>`);
  w.document.close();
  w.focus();
  w.print();
};
