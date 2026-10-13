import { getDocSettings } from '@ui/utils/docSettings';
import React, { useMemo, useRef, useState } from 'react';
import { Printer, Download } from 'lucide-react';

import { formatMoney } from '@ui/utils/money';
import { notify } from '@ui/components/ui/notify';

/**
 * The expense voucher as a document: what an accountant expects to see when
 * they click an expense — header, party, the expense ledgers charged, tax
 * split and totals — printable and downloadable as PDF.
 */
const ExpenseVoucherDoc = ({ expense, currentCompany, terms = '' }) => {
  const company = currentCompany || {};
  const lines = useMemo(() => {
    if (Array.isArray(expense?.lines) && expense.lines.length) return expense.lines;
    // Vouchers written before the ledger grid carry a single implicit line.
    const amount = Number(expense?.subtotal ?? expense?.taxableTotal ?? expense?.amount ?? 0);
    return [
      {
        ledgerName: expense?.category || 'Expense',
        description: expense?.description || '',
        amount,
        gstRate: Number(expense?.gstRate ?? 0),
        gstAmount: Number(expense?.gstTotal ?? 0),
        lineTotal: Number(expense?.total ?? amount),
      },
    ];
  }, [expense]);

  const isIntra = String(expense?.taxType || '') !== 'IGST';

  return (
    <div className="bg-white text-gray-900 p-6 rounded-xl border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-bold">{company?.name || 'Company'}</div>
          {company?.gstin ? <div className="text-xs text-gray-500">GSTIN: {company.gstin}</div> : null}
          {company?.address ? <div className="text-xs text-gray-500">{company.address}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">Expense Voucher</div>
          <div className="text-xs text-gray-500">No: {expense?.number || '-'}</div>
          <div className="text-xs text-gray-500">Date: {expense?.date || '-'}</div>
          {expense?.status ? <div className="text-xs text-gray-500">Status: {expense.status}</div> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded-lg p-4 mt-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-700 uppercase">Paid To</div>
          <div className="text-sm font-semibold">{expense?.vendorName || '—'}</div>
          {expense?.vendorGstin ? <div className="text-xs text-gray-500">GSTIN: {expense.vendorGstin}</div> : null}
          {expense?.placeOfSupplyState ? (
            <div className="text-xs text-gray-500">Place of supply: {expense.placeOfSupplyState}</div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-gray-500">Vendor Inv No</div>
            <div className="font-medium">{expense?.refNo || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Vendor Inv Date</div>
            <div className="font-medium">{expense?.refDate || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Due Date</div>
            <div className="font-medium">{expense?.dueDate || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Paid</div>
            <div className="font-medium">{formatMoney(Number(expense?.paidAmount ?? 0), currentCompany)}</div>
          </div>
        </div>
      </div>

      {expense?.description ? (
        <div className="mt-3 text-sm">
          <span className="text-xs text-gray-500 uppercase mr-2">Narration</span>
          {expense.description}
        </div>
      ) : null}

      <div className="border rounded-lg overflow-hidden mt-4">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Expense Ledger</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">GST %</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">GST</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-sm">{l.ledgerName || '-'}</td>
                <td className="px-3 py-2 text-sm">{l.description || '-'}</td>
                <td className="px-3 py-2 text-sm text-right">{formatMoney(Number(l.amount || 0), currentCompany)}</td>
                <td className="px-3 py-2 text-sm text-right">{Number(l.gstRate || 0)}%</td>
                <td className="px-3 py-2 text-sm text-right">{formatMoney(Number(l.gstAmount || 0), currentCompany)}</td>
                <td className="px-3 py-2 text-sm text-right font-medium">{formatMoney(Number(l.lineTotal || 0), currentCompany)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mt-4">
        <div className="w-full md:w-80 border rounded-lg p-4 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">Taxable value</span>
            <span className="font-medium">{formatMoney(Number(expense?.subtotal ?? expense?.taxableTotal ?? 0), currentCompany)}</span>
          </div>
          {isIntra ? (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">CGST</span>
                <span className="font-medium">{formatMoney(Number(expense?.cgstTotal ?? 0), currentCompany)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">SGST</span>
                <span className="font-medium">{formatMoney(Number(expense?.sgstTotal ?? 0), currentCompany)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between">
              <span className="text-gray-600">IGST</span>
              <span className="font-medium">{formatMoney(Number(expense?.igstTotal ?? 0), currentCompany)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 mt-2 font-bold">
            <span>Total</span>
            <span>{formatMoney(Number(expense?.total ?? 0), currentCompany)}</span>
          </div>
        </div>
      </div>

      {terms ? (
        <div className="mt-6 border rounded-lg p-3 text-xs text-gray-600 whitespace-pre-line">
          <div className="font-semibold uppercase text-gray-700 mb-1">Terms &amp; Conditions</div>
          {terms}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-8 mt-10 text-xs text-gray-500">
        <div className="border-t pt-2">Prepared by</div>
        <div className="border-t pt-2 text-right">Authorised signatory</div>
      </div>
    </div>
  );
};

/** Voucher with the Print / Download chrome around it. */
export default function ExpenseVoucher({ expense, currentCompany, db = null }) {
  // Terms were stored for the expense voucher and printed by nothing.
  const terms = String(
    (db ? getDocSettings(db, currentCompany) : null)?.templates?.expense?.termsText || ''
  ).trim();
  const previewRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const no = String(expense?.number || '').trim();

  const doPrint = () => {
    try {
      const prevTitle = document.title;
      if (no) document.title = no;
      document.body.classList.add('print-mode');
      const cleanup = () => {
        document.body.classList.remove('print-mode');
        document.title = prevTitle;
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
      window.setTimeout(cleanup, 1200);
    } catch {
      // ignore
    }
  };

  const doDownload = async () => {
    const el = previewRef.current;
    if (!el || downloading) return;
    setDownloading(true);
    const prevTitle = document.title;
    const base = (no || 'expense').replace(/[\\/:*?"<>|]/g, '-').trim() || 'expense';
    try {
      if (no) document.title = no;
      document.body.classList.add('print-mode');
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      await new Promise((resolve) => {
        doc.html(el, {
          x: 18,
          y: 18,
          width: 559,
          windowWidth: Math.max(el.scrollWidth || 0, 980),
          margin: [18, 18, 18, 18],
          autoPaging: 'text',
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          callback: () => resolve(),
        });
      });
      doc.save(`${base}.pdf`);
    } catch {
      notify.error('Unable to generate PDF. Please try again.');
    } finally {
      document.body.classList.remove('print-mode');
      document.title = prevTitle;
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="ui-muted text-sm">{no ? `Expense ${no}` : 'Expense voucher'}</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={doPrint} className="ui-btn ui-btn-secondary">
            <Printer size={16} /> Print
          </button>
          <button type="button" onClick={doDownload} disabled={downloading} className="ui-btn ui-btn-primary">
            <Download size={16} /> {downloading ? 'Preparing…' : 'Download'}
          </button>
        </div>
      </div>

      <div ref={previewRef}>
        <ExpenseVoucherDoc expense={expense} currentCompany={currentCompany} terms={terms} />
      </div>
    </div>
  );
}
