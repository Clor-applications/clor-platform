import React, { useEffect, useState } from 'react';

import { fetchSharedInvoice } from '../../api/share';
import { amountInWordsInr } from '@ui/utils/money';

/**
 * The invoice as the customer sees it, having followed a link.
 *
 * They have no account here and never will, so this renders before anything
 * that asks anyone to sign in. Nothing on it links back into the application:
 * a customer who followed a reminder wants to see what they owe, not to be
 * offered a login for their supplier's books.
 *
 * Black on white, like the printed copy. See DESIGN.md, which exempts printed
 * documents from the app's theme.
 */

const inr = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(
    Number(v || 0)
  );

const Shell = ({ children }) => (
  <div className="ui-min-h-viewport bg-gray-100 px-4 py-10">
    <div className="mx-auto max-w-3xl">{children}</div>
  </div>
);

export default function SharedInvoice({ token }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchSharedInvoice(token)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setFailed(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failed) {
    return (
      <Shell>
        <div className="rounded-xl bg-white p-8 text-center text-gray-900 shadow-sm">
          <h1 className="text-lg font-semibold">This link is no longer available</h1>
          <p className="mt-2 text-sm text-gray-600">
            It may have been withdrawn or replaced. Please ask for a fresh copy of the invoice.
          </p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-600 shadow-sm">Loading…</div>
      </Shell>
    );
  }

  const { from, to, invoice } = data;
  const showTax = invoice.gstTotal > 0;

  return (
    <Shell>
      <div className="overflow-hidden rounded-xl bg-white text-gray-900 shadow-sm">
        <div className="border-b-2 border-gray-900 p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-2xl font-extrabold">{from.name}</div>
              {from.address ? <div className="text-xs text-gray-600">{from.address}</div> : null}
              {from.gstin ? <div className="text-xs text-gray-600">GSTIN: {from.gstin}</div> : null}
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold tracking-wide">TAX INVOICE</div>
              <div className="mt-2 text-xs text-gray-600">No: {invoice.number}</div>
              <div className="text-xs text-gray-600">Date: {invoice.date}</div>
              {invoice.dueDate ? <div className="text-xs text-gray-600">Due: {invoice.dueDate}</div> : null}
            </div>
          </div>
        </div>

        <div className="border-b-2 border-gray-900 p-4">
          <div className="text-xs font-semibold uppercase">Bill To</div>
          <div className="mt-1 font-semibold">{to.name || '—'}</div>
          {to.gstin ? <div className="text-xs text-gray-600">GSTIN: {to.gstin}</div> : null}
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b-2 border-gray-900">
              <th className="w-8 px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="w-16 px-3 py-2 text-right">Qty</th>
              <th className="w-24 px-3 py-2 text-right">Rate</th>
              {showTax ? <th className="w-16 px-3 py-2 text-right">Tax %</th> : null}
              <th className="w-28 px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((l, idx) => (
              <tr key={idx} className="border-b border-gray-300">
                <td className="px-3 py-2 align-top">{idx + 1}</td>
                <td className="px-3 py-2 align-top">{l.description || '—'}</td>
                <td className="px-3 py-2 text-right align-top tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2 text-right align-top tabular-nums">{inr(l.rate)}</td>
                {showTax ? <td className="px-3 py-2 text-right align-top tabular-nums">{l.gstRate}%</td> : null}
                <td className="px-3 py-2 text-right align-top tabular-nums">{inr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-2 border-t-2 border-gray-900">
          <div className="border-r-2 border-gray-900 p-4 text-xs">
            <div className="font-semibold uppercase text-gray-700">Amount in words</div>
            <div className="mt-1">{amountInWordsInr(invoice.total)}</div>
          </div>
          <div className="p-4 text-sm">
            <div className="flex justify-between py-0.5">
              <span>Taxable value</span>
              <span className="tabular-nums">{inr(invoice.subtotal)}</span>
            </div>
            {invoice.cgstTotal > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>CGST</span>
                <span className="tabular-nums">{inr(invoice.cgstTotal)}</span>
              </div>
            ) : null}
            {invoice.sgstTotal > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>SGST</span>
                <span className="tabular-nums">{inr(invoice.sgstTotal)}</span>
              </div>
            ) : null}
            {invoice.igstTotal > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>IGST</span>
                <span className="tabular-nums">{inr(invoice.igstTotal)}</span>
              </div>
            ) : null}
            <div className="mt-2 flex justify-between border-t-2 border-gray-900 pt-2 text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{inr(invoice.total)}</span>
            </div>
            {invoice.paidAmount > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>Received</span>
                <span className="tabular-nums">− {inr(invoice.paidAmount)}</span>
              </div>
            ) : null}
            {/* The figure the reminder is about, said last and said loudest. */}
            <div className="mt-1 flex justify-between text-base font-bold">
              <span>Amount due</span>
              <span className="tabular-nums">{inr(invoice.dueAmount)}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-500">
        This is a read-only copy shared by {from.name || 'the supplier'}.
      </p>
    </Shell>
  );
}
