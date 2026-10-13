import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A ledger statement says the same day on every machine it leaves.
 *
 * The three exports used to build a `Date` from the stored `2026-12-09` and
 * then ask the browser what shape a date is. Two things went wrong at once: a
 * bare ISO date parses as UTC midnight, so west of Greenwich the row printed
 * the eighth; and `toLocaleDateString()` on a US-locale machine printed
 * 12/9/2026, which is read here as the twelfth of September.
 *
 * These tests read the bytes the user actually receives — the CSV text, the
 * strings drawn into the PDF, the HTML written to the print window — rather
 * than the helper underneath them, because the helper was never the part that
 * was wrong.
 */

/* The two dates that swap meaning between the conventions. */
const ROWS = [
  { date: '2026-12-09', particulars: 'Opening entry', voucherType: 'Journal', voucherNo: 'JV-1', debit: 1000, credit: 0, runningBalance: 1000 },
  { date: '2026-09-12', particulars: 'Second entry', voucherType: 'Journal', voucherNo: 'JV-2', debit: 0, credit: 250, runningBalance: 750 },
];

const ARGS = {
  companyName: 'Shree Balaji Traders',
  ledgerName: 'Sundry Debtors',
  openingBalance: 0,
  closingBalance: 750,
  rows: ROWS,
  columns: null,
};

/* --- capture what each export hands over, without touching the disk --- */

let csvText = '';
let pdfLines = [];
let htmlText = '';

const autoTableSpy = vi.fn((doc, opts) => {
  for (const row of opts.body || []) pdfLines.push(row.join(' | '));
});

vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor() { this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } }; }
    setFontSize() {}
    setFont() {}
    setTextColor() {}
    text(t) { pdfLines.push(String(t)); }
    save() {}
  },
}));
vi.mock('jspdf-autotable', () => ({ default: (...a) => autoTableSpy(...a) }));

beforeEach(() => {
  csvText = '';
  pdfLines = [];
  htmlText = '';

  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
  globalThis.Blob = class {
    constructor(parts) { csvText = parts.join(''); }
  };
  vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  vi.stubGlobal('open', () => ({
    document: { open: () => {}, write: (h) => { htmlText += h; }, close: () => {} },
    focus: () => {},
    print: () => {},
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CSV export', () => {
  it('writes the row dates as dd/mm/yyyy', async () => {
    const { exportLedgerToExcel } = await import('./ledgerExport');
    exportLedgerToExcel({ ...ARGS, fileName: 'ledger' });

    expect(csvText).toContain('09/12/2026');   // 9 December
    expect(csvText).toContain('12/09/2026');   // 12 September
    /* The US shape of the same day, and the day the UTC-midnight bug produced. */
    expect(csvText).not.toContain('12/9/2026');
    expect(csvText).not.toContain('08/12/2026');
  });

  it('leaves the CSV shape alone — delimiter, line ending, BOM, column order', async () => {
    const { exportLedgerToExcel } = await import('./ledgerExport');
    exportLedgerToExcel({ ...ARGS, fileName: 'ledger' });

    expect(csvText.startsWith('﻿')).toBe(true);
    expect(csvText).toContain('\r\n');
    const header = csvText.split('\r\n').find((l) => l.startsWith('Date,'));
    expect(header).toBe('Date,Particulars,Voucher Type,Voucher No,Narration,Debit,Credit,Running Balance');
    /* Amounts stay numeric, unquoted and unformatted. */
    expect(csvText).toMatch(/09\/12\/2026,Opening entry,Journal,JV-1,,1000,0,1000/);
  });
});

describe('PDF export', () => {
  it('draws the row dates as dd/mm/yyyy', async () => {
    const { exportLedgerToPdf } = await import('./ledgerExport');
    await exportLedgerToPdf({ ...ARGS, fileName: 'ledger.pdf' });
    const all = pdfLines.join('\n');

    expect(all).toContain('09/12/2026');
    expect(all).toContain('12/09/2026');
    expect(all).not.toContain('12/9/2026');
    expect(all).not.toContain('08/12/2026');
  });
});

describe('HTML / print export', () => {
  it('writes the row dates as dd/mm/yyyy', async () => {
    const { printLedger } = await import('./ledgerExport');
    printLedger(ARGS);

    expect(htmlText).toContain('09/12/2026');
    expect(htmlText).toContain('12/09/2026');
    expect(htmlText).not.toContain('12/9/2026');
    expect(htmlText).not.toContain('08/12/2026');
  });
});

describe('the three exports agree', () => {
  it('renders one date the same way in CSV, PDF and HTML', async () => {
    const { exportLedgerToExcel, exportLedgerToPdf, printLedger } = await import('./ledgerExport');
    exportLedgerToExcel({ ...ARGS, fileName: 'ledger' });
    await exportLedgerToPdf({ ...ARGS, fileName: 'ledger.pdf' });
    printLedger(ARGS);

    /* The bug this guards: screen 09/12/2026, PDF 12/09/2026, CSV 12/9/2026. */
    for (const out of [csvText, pdfLines.join('\n'), htmlText]) {
      expect(out).toContain('09/12/2026');
      expect(out).toContain('12/09/2026');
    }
  });

  it('heads all three with the same "as of" day', async () => {
    const { exportLedgerToExcel, exportLedgerToPdf, printLedger } = await import('./ledgerExport');
    exportLedgerToExcel({ ...ARGS, fileName: 'ledger' });
    await exportLedgerToPdf({ ...ARGS, fileName: 'ledger.pdf' });
    printLedger(ARGS);

    const { formatDateIn, localDateIso } = await import('./dates');
    const today = formatDateIn(localDateIso());
    expect(today).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    expect(csvText).toContain(`As of,${today}`);
    expect(pdfLines.join('\n')).toContain(`As of: ${today}`);
    expect(htmlText).toContain(`As of: ${today}`);
  });
});
