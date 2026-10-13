import { getDocSettings } from '@ui/utils/docSettings';
import React, { useMemo, useState } from 'react';
import { Printer, Download, Share2 } from 'lucide-react';

import { formatMoney } from '@ui/utils/money';
import { notify } from '@ui/components/ui/notify';
import { getCompanyGstProfile } from '@ui/utils/gst';
import { returnableLines } from '@ui/utils/returns';

/**
 * A purchase bill as a document.
 *
 * The vendor's bill is the source record for a purchase, so opening one should
 * show the paper, not a form: who billed whom, what arrived, what tax applied,
 * and what has since gone back on a debit note. Print, download and share sit
 * beside it because that is what people do with a bill they are querying.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const BillPreview = ({ db, currentCompany, bill }) => {
  // Terms are stored per document type and were only ever printed on the
  // invoice, so a bill could hold terms that nothing put on the page.
  const billTerms = String(getDocSettings(db, currentCompany)?.templates?.bill?.termsText || '').trim();
  const [busy, setBusy] = useState('');

  const vendor = useMemo(
    () => (db?.vendors || []).find((v) => String(v.id) === String(bill?.vendorId)) || null,
    [db?.vendors, bill?.vendorId]
  );

  const { gstin: companyGstin, state: companyState } = getCompanyGstProfile(currentCompany);

  const returned = useMemo(
    () => returnableLines(bill, db?.debitNotes || [], 'originalBillId'),
    [bill, db?.debitNotes]
  );

  const returnedValue = useMemo(() => {
    return (db?.debitNotes || [])
      .filter((dn) => String(dn?.originalBillId ?? '') === String(bill?.id ?? ''))
      .filter((dn) => String(dn?.status || '').toLowerCase() !== 'cancelled')
      .reduce((t, dn) => t + (Number(dn.total) || 0), 0);
  }, [db?.debitNotes, bill?.id]);

  const lines = bill?.items || [];

  /** The printable document, standalone so print and download share one source. */
  const documentHtml = useMemo(() => {
    const rows = lines
      .map((l, i) => {
        const qty = Number(l.quantity) || 0;
        const rate = Number(l.rate) || 0;
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(l.description || l.itemName || '')}${l.batchNo ? `<div class="sub">Batch ${esc(l.batchNo)}${l.expiryDate ? ` · exp ${esc(l.expiryDate)}` : ''}</div>` : ''}</td>
          <td>${esc(l.hsnSac || '')}</td>
          <td class="r">${qty}</td>
          <td class="r">${rate.toFixed(2)}</td>
          <td class="r">${Number(l.gstRate || 0)}%</td>
          <td class="r">${(qty * rate).toFixed(2)}</td>
        </tr>`;
      })
      .join('');

    const taxRows = [
      ['Taxable value', Number(bill?.subtotal || 0)],
      ...(Number(bill?.cgstTotal || 0) ? [['CGST', Number(bill.cgstTotal)]] : []),
      ...(Number(bill?.sgstTotal || 0) ? [['SGST', Number(bill.sgstTotal)]] : []),
      ...(Number(bill?.igstTotal || 0) ? [['IGST', Number(bill.igstTotal)]] : []),
    ]
      .map(([label, v]) => `<tr><td>${esc(label)}</td><td class="r">${v.toFixed(2)}</td></tr>`)
      .join('');

    return `<!doctype html><html><head><meta charset="utf-8">
      <title>${esc(bill?.number || 'Purchase Bill')}</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;color:#111;margin:28px}
        h1{font-size:20px;margin:0 0 2px}
        .muted{color:#666}
        .head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111;padding-bottom:12px}
        .parties{display:flex;gap:32px;margin-top:16px}
        .parties>div{flex:1}
        .label{text-transform:uppercase;font-size:10px;letter-spacing:.06em;color:#666;margin-bottom:4px}
        table{border-collapse:collapse;width:100%;margin-top:16px}
        th,td{border:1px solid #d5d5d5;padding:6px 8px;text-align:left;vertical-align:top}
        th{background:#f4f4f4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        .r{text-align:right}
        .sub{font-size:10px;color:#666;margin-top:2px}
        .totals{width:280px;margin-left:auto;margin-top:12px}
        .totals td{border:none;padding:3px 0}
        .grand{border-top:1px solid #111;font-weight:700;font-size:14px}
        .note{margin-top:18px;padding:8px 10px;background:#fff6ed;border:1px solid #f6c99b}
        .sign{margin-top:48px;display:flex;justify-content:space-between}
      .terms { margin-top:10px; border:1px solid #999; border-radius:4px; padding:6px 8px; font-size:10px; color:#444; }
      .terms-h { font-weight:700; text-transform:uppercase; color:#222; margin-bottom:2px; }
      </style></head><body>
      <div class="head">
        <div>
          <h1>${esc(currentCompany?.name || '')}</h1>
          ${companyGstin ? `<div class="muted">GSTIN: ${esc(companyGstin)}</div>` : ''}
          ${companyState ? `<div class="muted">${esc(companyState)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:700">PURCHASE BILL</div>
          <div class="muted">No: ${esc(bill?.number || '')}</div>
          <div class="muted">Date: ${esc(bill?.date || '')}</div>
          ${bill?.dueDate ? `<div class="muted">Due: ${esc(bill.dueDate)}</div>` : ''}
        </div>
      </div>

      <div class="parties">
        <div>
          <div class="label">Billed by (vendor)</div>
          <div style="font-weight:600">${esc(bill?.vendorName || '')}</div>
          ${bill?.vendorGstin ? `<div class="muted">GSTIN: ${esc(bill.vendorGstin)}</div>` : ''}
          ${vendor?.billingAddress?.line1 ? `<div class="muted">${esc(vendor.billingAddress.line1)}</div>` : ''}
          ${vendor?.billingAddress?.state ? `<div class="muted">${esc(vendor.billingAddress.state)}</div>` : ''}
        </div>
        <div>
          <div class="label">Reference</div>
          <div>Vendor bill no: ${esc(bill?.refNo || '—')}</div>
          <div>Vendor bill date: ${esc(bill?.refDate || '—')}</div>
          <div>Place of supply: ${esc(bill?.placeOfSupplyState || '—')}</div>
          ${bill?.reverseCharge ? '<div>Reverse charge: Yes</div>' : ''}
        </div>
      </div>

      <table>
        <thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="muted">No lines</td></tr>'}</tbody>
      </table>

      <table class="totals">
        ${taxRows}
        <tr class="grand"><td>Total</td><td class="r">${Number(bill?.total || 0).toFixed(2)}</td></tr>
        ${Number(bill?.paidAmount || 0) ? `<tr><td>Paid</td><td class="r">${Number(bill.paidAmount).toFixed(2)}</td></tr>` : ''}
        ${returnedValue ? `<tr><td>Debit notes</td><td class="r">-${returnedValue.toFixed(2)}</td></tr>` : ''}
      </table>

      ${
        returnedValue
          ? `<div class="note">${esc(returned.fullyReturned ? 'Fully returned' : 'Partly returned')} — debit notes of ${returnedValue.toFixed(2)} have been raised against this bill.</div>`
          : ''
      }

      ${billTerms ? `<div class="terms"><div class="terms-h">Terms &amp; Conditions</div>${esc(billTerms).replace(/\n/g, '<br/>')}</div>` : ''}

      <div class="sign"><div>Received by ____________________</div><div>For ${esc(currentCompany?.name || '')}</div></div>
      </body></html>`;
  }, [bill, lines, currentCompany, companyGstin, companyState, vendor, returnedValue, returned.fullyReturned, billTerms]);

  const print = () => {
    const w = window.open('', '_blank');
    if (!w) {
      notify.error('Allow pop-ups to print this bill.');
      return;
    }
    w.document.write(documentHtml);
    w.document.close();
    w.focus();
    w.print();
  };

  const download = () => {
    const blob = new Blob([documentHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bill?.number || 'purchase-bill'}.html`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success('Downloaded — open it and print to PDF if you need one.');
  };

  const share = async () => {
    const summary = `${currentCompany?.name || ''} — purchase bill ${bill?.number || ''} from ${bill?.vendorName || ''}, ${formatMoney(Number(bill?.total || 0), currentCompany)} dated ${bill?.date || ''}.`;
    setBusy('share');
    try {
      if (navigator.share) {
        await navigator.share({ title: `Bill ${bill?.number || ''}`, text: summary });
      } else {
        await navigator.clipboard.writeText(summary);
        notify.success('Bill summary copied — paste it wherever you need.');
      }
    } catch {
      // A cancelled share is not a failure.
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={print} className="ui-btn ui-btn-secondary">
          <Printer size={16} aria-hidden="true" /> Print
        </button>
        <button type="button" onClick={download} className="ui-btn ui-btn-secondary">
          <Download size={16} aria-hidden="true" /> Download
        </button>
        <button type="button" onClick={share} disabled={busy === 'share'} className="ui-btn ui-btn-secondary">
          <Share2 size={16} aria-hidden="true" /> Share
        </button>
      </div>

      <div className="border rounded-xl overflow-hidden bg-white">
        <iframe
          title={`Bill ${bill?.number || ''}`}
          srcDoc={documentHtml}
          className="w-full"
          style={{ height: '70vh', border: 0 }}
        />
      </div>
    </div>
  );
};

export default BillPreview;
