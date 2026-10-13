import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

import { ACCENT_OPTIONS, getDocSettings } from '@ui/utils/docSettings';
import { amountInWordsInr, formatMoney } from '@ui/utils/money';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { getInvoicePrintSettings } from '@ui/utils/invoicePrintSettings';
import {
  getInvoicePrefs,
  isInvoicePrefOn,
  getCustomFields,
  getInvoicePaymentDetails,
  listBankAccounts,
  buildUpiPaymentUri,
} from '@ui/utils/invoicePrefs';

const InfoRow = ({ label, value, right = false }) => {
  if (!value) return null;
  return (
    <div className={`text-sm ${right ? 'text-right' : ''}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium text-gray-900">{value}</div>
    </div>
  );
};

/**
 * The deduction the customer will make, stated under the total.
 *
 * Under it, not inside it: the invoice is raised for the total and the
 * receivable is the total. This says what will actually be paid, so nobody has
 * to work out later why the remittance was short.
 */
const TdsLines = ({ invoice, currentCompany, cls = '' }) => {
  const amount = Number(invoice?.tdsAmount || 0);
  if (!(amount > 0)) return null;
  const code = String(invoice?.tdsSection || '').trim();
  const rate = Number(invoice?.tdsRate || 0);
  const net = Math.max(0, Number(invoice?.total || 0) - amount);
  return (
    <>
      <div className={`flex justify-between ${cls}`}>
        <span>Less: TDS{code ? ` ${code}` : ''}{rate ? ` @ ${rate}%` : ''}</span>
        <span>− {formatMoney(amount, currentCompany)}</span>
      </div>
      <div className={`flex justify-between font-bold ${cls}`}>
        <span>Net payable</span>
        <span>{formatMoney(net, currentCompany)}</span>
      </div>
    </>
  );
};

const batchNote = (l) =>
  String(l?.batchNo || '').trim()
    ? `Batch ${String(l.batchNo).trim()}${String(l?.expiryDate || '').trim() ? ` · Exp ${String(l.expiryDate).trim()}` : ''}`
    : '';

const InvoicePreview = ({ db, currentCompany, invoice }) => {
  const docSettings = useMemo(() => getDocSettings(db, currentCompany), [db, currentCompany]);
  const printSettings = useMemo(() => getInvoicePrintSettings(docSettings), [docSettings]);
  const printOn = (key) => printSettings.options[key] !== false;

  // Signed e-invoice QR, rendered from the JWT the IRP returned.
  const [irnQrDataUrl, setIrnQrDataUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    const apply = (v) => {
      if (!cancelled) setIrnQrDataUrl(v);
    };
    const src = invoice?.irnSignedQr;
    if (!src) {
      Promise.resolve().then(() => apply(''));
    } else {
      QRCode.toDataURL(String(src), { margin: 1, width: 192 })
        .then(apply)
        .catch(() => apply(''));
    }
    return () => {
      cancelled = true;
    };
  }, [invoice?.irnSignedQr]);
  /**
   * The same preferences the form obeys.
   *
   * A field switched off has to leave the paper as well as the screen — a
   * printed invoice that carries a field the form no longer offers is a field
   * nobody can correct.
   */
  const prefs = useMemo(() => getInvoicePrefs(currentCompany), [currentCompany]);
  const prefOn = (key) => isInvoicePrefOn(prefs, key);
  const customFields = useMemo(() => getCustomFields(currentCompany), [currentCompany]);
  const payment = useMemo(() => getInvoicePaymentDetails(currentCompany), [currentCompany]);
  const bankAccount = useMemo(() => {
    if (!prefOn('bankQr') || !payment.bankAccountId) return null;
    return listBankAccounts(db, currentCompany?.id).find((a) => a.id === String(payment.bankAccountId)) || null;
    // prefOn is derived from prefs; listing is cheap and only runs on a change.
  }, [db, currentCompany?.id, payment.bankAccountId, prefs]);

  /**
   * The UPI QR carries the amount, so it only appears on a finalised invoice.
   * A draft's total can still change, and a code that pays the wrong amount is
   * worse than no code at all.
   */
  const upiUri = useMemo(() => {
    if (!prefOn('bankQr') || !payment.showQr) return '';
    if (String(invoice?.status || '').trim() === 'Draft') return '';
    return buildUpiPaymentUri({
      upiId: payment.upiId,
      payeeName: payment.payeeName || currentCompany?.name,
      amount: Number(invoice?.total ?? 0),
      invoiceNumber: invoice?.number,
    });
  }, [prefs, payment, invoice?.status, invoice?.total, invoice?.number, currentCompany?.name]);

  const [upiQrDataUrl, setUpiQrDataUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    const apply = (v) => {
      if (!cancelled) setUpiQrDataUrl(v);
    };
    if (!upiUri) {
      Promise.resolve().then(() => apply(''));
    } else {
      QRCode.toDataURL(upiUri, { margin: 1, width: 192 }).then(apply).catch(() => apply(''));
    }
    return () => {
      cancelled = true;
    };
  }, [upiUri]);

  const printedCustomFields = (where) =>
    customFields
      .filter((f) => f.printPlacement === where)
      .map((f) => ({ ...f, value: (invoice?.customFields || {})[f.key] }))
      .filter((f) => f.value !== undefined && f.value !== '' && f.value !== null)
      .map((f) => ({ ...f, value: f.value === true ? 'Yes' : f.value === false ? 'No' : String(f.value) }));

  /**
   * The reference and statutory numbers, as `InfoRow`s. Shared so every
   * template shows the same set — a field the company switched on should not
   * depend on which paper design they picked.
   */
  const referenceLines = () => {
    if (!printOn('documentReferences')) return [];
    const rows = [];
    const push = (label, value) => {
      const v = String(value ?? '').trim();
      if (v) rows.push({ label, value: v });
    };
    if (prefOn('customerRef')) {
      push('Ref No.', invoice?.refNo);
      push('Ref Date', invoice?.refDate);
    }
    if (prefOn('lut')) push('LUT', invoice?.lutNumber || company?.lutNumber);
    if (prefOn('iec')) push('IEC', invoice?.iecNumber || company?.iecNumber);
    if (prefOn('shippingBill')) {
      push('Shipping bill', [invoice?.shippingBillNo, invoice?.shippingBillDate].filter(Boolean).join(' · '));
      push('Port code', invoice?.portCode);
    }
    if (prefOn('foreignCurrency') && invoice?.invoiceCurrency) {
      push('Currency', `${invoice.invoiceCurrency}${invoice?.exchangeRate ? ` @ ${invoice.exchangeRate}` : ''}`);
    }
    if (prefOn('ewayBill')) push('E-way bill', invoice?.ewbNo);
    if (prefOn('transporter')) {
      push('Transporter', invoice?.transporterName);
      push('Vehicle no.', invoice?.vehicleNo);
    }
    if (prefOn('lrNumber')) push('LR / GR no.', [invoice?.lrNumber, invoice?.lrDate].filter(Boolean).join(' · '));
    if (prefOn('packages')) push('Packages', invoice?.packageDetails);
    if (prefOn('servicePeriod') && (invoice?.servicePeriodFrom || invoice?.servicePeriodTo)) {
      push('Service period', [invoice?.servicePeriodFrom, invoice?.servicePeriodTo].filter(Boolean).join(' to '));
    }
    if (prefOn('project')) push('Project / site', invoice?.projectName);
    if (prefOn('workOrder')) push('Work order', [invoice?.workOrderNo, invoice?.raBillNo].filter(Boolean).join(' · '));
    if (prefOn('timesheetRef')) push('Timesheet', invoice?.timesheetRef);
    if (prefOn('drugLicence')) push('Drug licence', company?.drugLicenceNo);
    if (prefOn('salesman')) push('Salesperson', invoice?.salesmanName);
    printedCustomFields('header').forEach((f) => push(f.label, f.value));
    return rows;
  };

  /** The same list as `referenceLines`, laid out for the InfoRow grid. */
  const referenceRows = () => (
    <>
      {referenceLines().map((r) => (
        <InfoRow key={r.label} label={r.label} value={r.value} right />
      ))}
    </>
  );

  /** Where to send the money. Nothing renders when there is nothing to say. */
  const paymentBlock = () => {
    if (!printOn('paymentDetails') || (!bankAccount && !upiQrDataUrl)) return null;
    return (
      <div className="flex items-start justify-between gap-3 border rounded-lg p-3">
        <div className="min-w-0 text-xs text-gray-700">
          <div className="font-semibold uppercase text-gray-700">Payment</div>
          {bankAccount ? (
            <>
              <div className="font-medium text-gray-900">{bankAccount.bankName || bankAccount.name}</div>
              <div>A/c {bankAccount.accountNumber}</div>
              {bankAccount.ifsc ? <div>IFSC {bankAccount.ifsc}</div> : null}
              {bankAccount.branch ? <div>{bankAccount.branch}</div> : null}
            </>
          ) : null}
          {payment.upiId ? <div>UPI {payment.upiId}</div> : null}
        </div>
        {upiQrDataUrl ? (
          <div className="flex-shrink-0 text-center">
            <img src={upiQrDataUrl} alt="UPI payment QR" className="h-24 w-24" />
            <div className="text-[10px] text-gray-500 mt-0.5">Scan to pay</div>
          </div>
        ) : null}
      </div>
    );
  };

  const templateId = String(docSettings?.templates?.invoice?.templateId || 'classic');
  const accentId = String(docSettings?.templates?.invoice?.accentId || 'blue');
  const accent = ACCENT_OPTIONS.find((a) => a.id === accentId) || ACCENT_OPTIONS[0];

  const company = currentCompany || {};
  const companyLogo = (className = 'h-14 w-14') => company?.logo ? (
    <img
      src={company.logo}
      alt={`${company?.name || 'Company'} logo`}
      className={`${className} shrink-0 object-contain`}
    />
  ) : null;
  const customer = useMemo(() => {
    const id = invoice?.customerId ? parseInt(invoice.customerId) : null;
    if (!id) return null;
    return (db.customers || []).find((c) => c.companyId === company.id && c.id === id) || null;
  }, [db, company.id, invoice?.customerId]);

  /*
   * The item masters, indexed the way the pickers index them.
   *
   * This compared companyId with `===` while every picker compares it as a
   * number, so a book whose ids arrived from the server as strings matched in
   * the picker and missed here: the item could be chosen onto a line and then
   * had no name on the document. A line falls back to its own recorded name
   * below, but the index should not be the thing that is wrong.
   */
  const itemsById = useMemo(() => {
    const map = new Map();
    (db.items || [])
      .filter((i) => Number(i.companyId) === Number(company.id))
      .forEach((i) => map.set(String(i.id), i));
    return map;
  }, [db, company.id]);

  const lines = Array.isArray(invoice?.items) ? invoice.items : [];
  const itemLabel = (item, line) => {
    const name = String(item?.name || line?.name || line?.description || '').trim();
    const code = String(item?.code || line?.itemCode || '').trim();
    if (printSettings.itemNameStyle === 'code') return code || name;
    if (printSettings.itemNameStyle === 'both') return [code, name].filter(Boolean).join(' — ');
    return name || code;
  };

  const customerAddress = useMemo(() => {
    const addr = customer?.billingAddress || customer?.shippingAddress || {};
    const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode, addr.country]
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    return parts.join(', ');
  }, [customer]);

  const codeForStateName = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    for (const [code, stateName] of Object.entries(GST_STATE_BY_CODE || {})) {
      if (String(stateName || '').trim().toLowerCase() === trimmed.toLowerCase()) return code;
    }
    return '';
  };

  const companyAddress = useMemo(() => {
    const parts = [company?.address, company?.city, company?.state, company?.country]
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    return parts.join(', ');
  }, [company?.address, company?.city, company?.state, company?.country]);

  /**
   * The paper is painted here, not by whoever renders this.
   *
   * Everything below is deliberately raw gray-on-white — a printed invoice does
   * not follow the app theme, and DESIGN.md exempts this file for that reason.
   * But the exemption only works if something actually puts white behind it,
   * and this root never did: it inherited a transparent background, so in dark
   * mode `text-gray-900` was near-black ink on a near-black surface. The
   * customer name, place of supply, tax type and status were all invisible —
   * the labels survived only because gray-500 is light enough to show.
   *
   * Four of the five places that render this passed no background of their own.
   * Painting it on the document itself makes every one of them correct, and
   * matches ExpenseVoucher, which has always done this.
   */
  const content = (
    <div className="bg-white text-gray-900 rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {companyLogo()}
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900">{company?.name || 'Company'}</div>
            {printOn('companyAddress') && companyAddress ? <div className="text-xs text-gray-500">{companyAddress}</div> : null}
          {(printOn('companyPhone') && company?.phone) || (printOn('companyEmail') && company?.email) || (printOn('companyWebsite') && company?.website) ? (
            <div className="text-xs text-gray-500">
              {[printOn('companyPhone') ? company.phone : '', printOn('companyEmail') ? company.email : '', printOn('companyWebsite') ? company.website : ''].filter(Boolean).join(' · ')}
            </div>
          ) : null}
          {printOn('companyGstin') && company?.gstin ? <div className="text-xs text-gray-500">GSTIN: {company.gstin}</div> : null}
          {printOn('companyPan') && company?.pan ? <div className="text-xs text-gray-500">PAN: {company.pan}</div> : null}
          {printOn('companyCin') && company?.cin ? <div className="text-xs text-gray-500">CIN: {company.cin}</div> : null}
          {printOn('companyUdyam') && company?.udyamNumber ? <div className="text-xs text-gray-500">Udyam: {company.udyamNumber}{company?.enterpriseType ? ` · ${company.enterpriseType}` : ''}</div> : null}
            {printOn('companyActivity') && company?.activityType ? <div className="text-xs text-gray-500">Activity: {company.activityType}</div> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-gray-900">{printSettings.title}</div>
          {printSettings.subtitle ? <div className="text-xs text-gray-500">{printSettings.subtitle}</div> : null}
          <div className="text-xs text-gray-500">No: {invoice?.number || '-'}</div>
          <div className="text-xs text-gray-500">Date: {invoice?.date || '-'}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded-lg p-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-700 uppercase">Bill To</div>
          <div className="text-sm font-semibold text-gray-900">{invoice?.customerName || customer?.displayName || customer?.name || '-'}</div>
          {printOn('customerAddress') && customerAddress ? <div className="text-xs text-gray-500">{customerAddress}</div> : null}
          {printOn('customerGstin') && invoice?.customerGstin ? <div className="text-xs text-gray-500">GSTIN: {invoice.customerGstin}</div> : null}
          {printOn('customerPan') && (invoice?.customerPan || customer?.pan) ? <div className="text-xs text-gray-500">PAN: {invoice?.customerPan || customer?.pan}</div> : null}
          {printOn('customerState') && (customer?.state || customer?.billingAddress?.state) ? <div className="text-xs text-gray-500">State: {customer?.state || customer?.billingAddress?.state}</div> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InfoRow label="Due Date" value={invoice?.dueDate || ''} right />
          {printOn('placeOfSupply') ? <InfoRow label="Place of Supply" value={invoice?.placeOfSupplyState || ''} right /> : null}
          <InfoRow label="Tax Type" value={invoice?.taxType ? String(invoice.taxType).replace('_', ' / ') : ''} right />
          <InfoRow label="Status" value={invoice?.status || ''} right />
          {referenceRows()}
        </div>
      </div>

      {prefOn('reverseCharge') && invoice?.reverseCharge ? (
        <div className="text-xs font-semibold text-gray-700">Tax payable on reverse charge</div>
      ) : null}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
              {printOn('quantity') ? <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th> : null}
              {printOn('rate') ? <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rate</th> : null}
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-500">
                  No line items
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => {
                const item = l?.itemId ? itemsById.get(String(l.itemId)) : null;
                const name = itemLabel(item, l);
                const qty = Number(l?.quantity ?? 0);
                const rate = Number(l?.rate ?? 0);
                const total = Number(l?.lineTotal ?? l?.amount ?? 0);
                return (
                  <tr key={idx}>
                    <td className="px-3 py-2 text-sm text-gray-900">{name || '-'}{printOn('batchDetails') && batchNote(l) ? <div className="text-[10px] text-gray-500">{batchNote(l)}</div> : null}</td>
                    {printOn('quantity') ? <td className="px-3 py-2 text-sm text-right">{Number.isFinite(qty) ? qty : '-'}</td> : null}
                    {printOn('rate') ? <td className="px-3 py-2 text-sm text-right">{formatMoney(Number.isFinite(rate) ? rate : 0, currentCompany)}</td> : null}
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatMoney(Number.isFinite(total) ? total : 0, currentCompany)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <div className="w-full md:w-80 border rounded-lg p-4 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium">{formatMoney(Number(invoice?.subtotal ?? 0), currentCompany)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">GST</span>
            <span className="font-medium">{formatMoney(Number(invoice?.gstTotal ?? 0), currentCompany)}</span>
          </div>
          {prefOn('invoiceDiscount') && Number(invoice?.invoiceDiscountApplied ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span className="text-gray-600">Invoice discount</span>
              <span className="font-medium">− {formatMoney(Number(invoice.invoiceDiscountApplied), currentCompany)}</span>
            </div>
          ) : null}
          {prefOn('otherCharges') && Number(invoice?.otherChargesTotal ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span className="text-gray-600">Other charges</span>
              <span className="font-medium">{formatMoney(Number(invoice.otherChargesTotal), currentCompany)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t pt-2 mt-2 font-bold">
            <span>Total</span>
            <span>{formatMoney(Number(invoice?.total ?? 0), currentCompany)}</span>
          </div>
          <TdsLines invoice={invoice} currentCompany={currentCompany} />
          {printOn('amountInWords') && prefOn('amountInWords') ? (
            <div className="border-t pt-2 mt-2 text-xs text-gray-600">{amountInWordsInr(Number(invoice?.total ?? 0))}</div>
          ) : null}
        </div>
      </div>

      {paymentBlock()}

      {invoice?.irn ? (
        <div className="flex items-start justify-between gap-3 border rounded-lg p-3">
          <div className="min-w-0 text-xs text-gray-700">
            <div className="font-semibold uppercase">e-Invoice</div>
            <div className="break-all font-mono">IRN: {invoice.irn}</div>
            {invoice.irnAckNo ? <div>Ack: {invoice.irnAckNo} · {invoice.irnAckDate || ''}</div> : null}
            {invoice.irnStatus === 'CANCELLED' ? <div className="font-semibold">IRN CANCELLED</div> : null}
          </div>
          {irnQrDataUrl ? <img src={irnQrDataUrl} alt="Signed e-invoice QR" className="h-24 w-24 flex-shrink-0" /> : null}
        </div>
      ) : null}
      {prefOn('shipTo') && invoice?.shipToAddress ? (
        <div className="border rounded-lg p-3 text-xs text-gray-700">
          <span className="font-semibold uppercase">Ship to ({invoice.shipToAddress.code}):</span>{' '}
          {[invoice.shipToAddress.label, invoice.shipToAddress.line1, invoice.shipToAddress.city, invoice.shipToAddress.state, invoice.shipToAddress.pincode]
            .filter(Boolean)
            .join(', ')}
        </div>
      ) : null}
      {printOn('terms') && prefOn('terms') && String(docSettings?.templates?.invoice?.termsText || '').trim() ? (
        <div className="border rounded-lg p-3 text-xs text-gray-600 whitespace-pre-line">
          <div className="font-semibold uppercase text-gray-700 mb-1">Terms &amp; Conditions</div>
          {docSettings.templates.invoice.termsText}
        </div>
      ) : null}
      {printedCustomFields('terms').length ? (
        <div className="border rounded-lg p-3 text-xs text-gray-600">
          {printedCustomFields('terms').map((f) => (
            <div key={f.key}>
              <span className="font-semibold text-gray-700">{f.label}:</span> {f.value}
            </div>
          ))}
        </div>
      ) : null}
      {printOn('declaration') && prefOn('declaration') && String(docSettings?.templates?.invoice?.declarationText || '').trim() ? (
        <div className="border rounded-lg p-3 text-xs text-gray-600 whitespace-pre-line">
          {docSettings.templates.invoice.declarationText}
        </div>
      ) : null}
      {printOn('jurisdiction') && printSettings.jurisdictionText ? <div className="text-xs text-gray-600">{printSettings.jurisdictionText}</div> : null}
      {printOn('preparedBy') && printSettings.preparedByText ? <div className="text-xs text-gray-600">Prepared / verified by: {printSettings.preparedByText}</div> : null}
      {printOn('footerNote') && printSettings.footerText ? <div className="text-xs text-center text-gray-500">{printSettings.footerText}</div> : null}
    </div>
  );

  if (templateId === 'modern') {
    return (
      <div className="printable space-y-4" data-invoice-preview>
        <div className="flex items-stretch gap-3">
          <div className={`w-2 rounded-lg ${accent.barClass}`} />
          <div className="flex-1">{content}</div>
        </div>
      </div>
    );
  }

  if (templateId === 'minimal') {
    return <div className="printable space-y-4" data-invoice-preview>{content}</div>;
  }

  if (templateId === 'compact') {
    return (
      <div className="printable space-y-3" data-invoice-preview>
        <div className="border rounded-lg overflow-hidden">
          <div className={`h-2 ${accent.barClass}`} />
          <div className="p-3">{content}</div>
        </div>
      </div>
    );
  }

  if (templateId === 'bold') {
    return (
      <div className="printable space-y-3" data-invoice-preview>
        <div className={`rounded-lg p-3 text-white ${accent.barClass}`}>
          <div className="flex items-center justify-between">
            <div className="font-bold">{company?.name || 'Company'}</div>
            <div className="text-sm font-semibold">{printSettings.title}</div>
          </div>
          <div className="text-xs opacity-95">No: {invoice?.number || '-'}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">{content}</div>
      </div>
    );
  }

  if (templateId === 'classic') {
    const wholeMoney = (value) => formatMoney(Math.round(Number(value || 0)), currentCompany).replace(/\.00$/, '');
    const wholeNumber = (value) => Math.round(Number(value || 0)).toLocaleString('en-IN');
    const hasBatchDetails = printOn('batchDetails') && lines.some((line) => batchNote(line));
    const hasPartNumbers = printOn('partNumber') && lines.some((line) => {
      const item = line?.itemId ? itemsById.get(String(line.itemId)) : null;
      return String(line?.partNumber || item?.partNumber || '').trim();
    });
    const hasTransport = printOn('dispatchDetails') && Boolean(
      invoice?.transporterName || invoice?.vehicleNo || invoice?.lrNumber || invoice?.lrDate
    );
    const hasReference = printOn('documentReferences') && Boolean(invoice?.refNo || invoice?.refDate);
    const hasOrder = printOn('orderDetails') && Boolean(invoice?.orderNumber || invoice?.workOrderNo);
    const taxRows = Array.from(lines.reduce((map, line) => {
      const item = line?.itemId ? itemsById.get(String(line.itemId)) : null;
      const hsn = String(line?.hsnSac || item?.hsnSac || 'Unclassified');
      const current = map.get(hsn) || { hsn, taxable: 0, rate: Number(line?.gstRate || 0), cgst: 0, sgst: 0, igst: 0, tax: 0 };
      current.taxable += Number(line?.taxableAmount ?? line?.amount ?? 0);
      current.cgst += Number(line?.cgstAmount || 0);
      current.sgst += Number(line?.sgstAmount || 0);
      current.igst += Number(line?.igstAmount || 0);
      current.tax += Number(line?.gstAmount ?? (Number(line?.cgstAmount || 0) + Number(line?.sgstAmount || 0) + Number(line?.igstAmount || 0)));
      map.set(hsn, current);
      return map;
    }, new Map()).values());
    const ship = invoice?.shipToAddress;
    const shipText = ship ? [ship.label, ship.line1, ship.line2, ship.city, ship.state, ship.pincode].filter(Boolean).join(', ') : '';
    const headerCell = 'px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-white';
    const valueCell = 'px-2 py-2 text-xs text-gray-800 align-top';
    return (
      <div className="printable mx-auto max-w-[980px] bg-white text-gray-900" data-invoice-preview>
        <div className={`h-2 ${accent.barClass}`} />
        <div className={printSettings.margin === 'compact' ? 'p-4 space-y-3' : 'p-6 space-y-4'}>
          <header className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-4 min-w-0">
              {companyLogo()}
              <div className="min-w-0">
                <div className="text-xl font-bold">{company?.name || 'Company'}</div>
                {printOn('companyAddress') && companyAddress ? <div className="text-xs text-gray-600">{companyAddress}</div> : null}
                <div className="text-xs text-gray-600">
                  {[printOn('companyPhone') ? company?.phone : '', printOn('companyEmail') ? company?.email : '', printOn('companyWebsite') ? company?.website : ''].filter(Boolean).join(' · ')}
                </div>
                <div className="text-xs text-gray-600">
                  {[printOn('companyGstin') && company?.gstin ? `GSTIN: ${company.gstin}` : '', printOn('companyPan') && company?.pan ? `PAN: ${company.pan}` : '', printOn('companyCin') && company?.cin ? `CIN: ${company.cin}` : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-extrabold tracking-wide text-slate-900">{printSettings.title}</div>
              {printSettings.subtitle ? <div className="text-xs text-gray-500">{printSettings.subtitle}</div> : null}
              <div className="mt-2 text-xs font-semibold">{printSettings.copyLabel}</div>
            </div>
          </header>

          <section className="rounded-lg border overflow-hidden">
            <div className="bg-slate-100 px-3 py-1.5 text-xs font-bold text-center">Invoice details</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 p-3 text-xs">
              <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Invoice no.</b><span>{invoice?.number || '-'}</span></div>
              {hasTransport && invoice?.transporterName ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Transporter</b><span>{invoice.transporterName}</span></div> : <div />}
              <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Invoice date</b><span>{invoice?.date || '-'}</span></div>
              {hasTransport && invoice?.vehicleNo ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Vehicle no.</b><span>{invoice.vehicleNo}</span></div> : <div />}
              {hasReference ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Reference</b><span>{[invoice?.refNo, invoice?.refDate].filter(Boolean).join(' · ')}</span></div> : null}
              {hasTransport && (invoice?.lrNumber || invoice?.lrDate) ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>LR / GR</b><span>{[invoice?.lrNumber, invoice?.lrDate].filter(Boolean).join(' · ')}</span></div> : null}
              {printOn('documentReferences') ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Due date</b><span>{invoice?.dueDate || '—'}</span></div> : null}
              {hasOrder ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Order</b><span>{invoice?.orderNumber || invoice?.workOrderNo}</span></div> : null}
            </div>
          </section>

          <section className={`grid ${printOn('consignee') && shipText ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            <div className="rounded-lg border p-3 text-xs">
              <div className="font-bold uppercase text-gray-500 mb-2">Bill to</div>
              <div className="font-semibold text-sm">{invoice?.customerName || customer?.displayName || customer?.name || '-'}</div>
              {printOn('customerAddress') && customerAddress ? <div className="mt-1 text-gray-600">{customerAddress}</div> : null}
              {printOn('customerGstin') && invoice?.customerGstin ? <div className="mt-1">GSTIN: {invoice.customerGstin}</div> : null}
              {printOn('customerPan') && (invoice?.customerPan || customer?.pan) ? <div>PAN: {invoice?.customerPan || customer?.pan}</div> : null}
              {printOn('placeOfSupply') ? <div>Place of supply: {invoice?.placeOfSupplyState || '—'}</div> : null}
            </div>
            {printOn('consignee') && shipText ? (
              <div className="rounded-lg border p-3 text-xs">
                <div className="font-bold uppercase text-gray-500 mb-2">Ship to / consignee</div>
                <div className="font-semibold text-sm">{ship?.label || invoice?.customerName || '-'}</div>
                <div className="mt-1 text-gray-600">{shipText || customerAddress || 'Same as billing address'}</div>
              </div>
            ) : null}
          </section>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                {printOn('serialNumber') ? <col className="w-[4%]" /> : null}
                <col />
                {hasBatchDetails ? <col className="w-[13%]" /> : null}
                {printOn('hsnSac') ? <col className="w-[8%]" /> : null}
                {printOn('quantity') ? <col className="w-[6%]" /> : null}
                {printOn('rate') ? <col className="w-[9%]" /> : null}
                {hasPartNumbers ? <col className="w-[9%]" /> : null}
                {printOn('gstRate') ? <col className="w-[6%]" /> : null}
                {printOn('taxAmount') ? <col className="w-[9%]" /> : null}
                <col className="w-[11%]" />
              </colgroup>
              <thead className={accent.barClass}>
                <tr>
                  {printOn('serialNumber') ? <th className={`${headerCell} text-center`}>#</th> : null}
                  <th className={`${headerCell} text-left`}>Item details</th>
                  {hasBatchDetails ? <th className={`${headerCell} text-left`}>Batch / dates</th> : null}
                  {printOn('hsnSac') ? <th className={`${headerCell} text-center`}>HSN/SAC</th> : null}
                  {printOn('quantity') ? <th className={`${headerCell} text-right`}>Qty</th> : null}
                  {printOn('rate') ? <th className={`${headerCell} text-right`}>Rate</th> : null}
                  {hasPartNumbers ? <th className={`${headerCell} text-left`}>Part no.</th> : null}
                  {printOn('gstRate') ? <th className={`${headerCell} text-right`}>GST %</th> : null}
                  {printOn('taxAmount') ? <th className={`${headerCell} text-right`}>Tax</th> : null}
                  <th className={`${headerCell} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((line, index) => {
                  const item = line?.itemId ? itemsById.get(String(line.itemId)) : null;
                  const tax = Number(line?.gstAmount ?? (Number(line?.cgstAmount || 0) + Number(line?.sgstAmount || 0) + Number(line?.igstAmount || 0)));
                  return (
                    <tr key={index} className={printOn('stripeView') && index % 2 ? 'bg-slate-50' : ''}>
                      {printOn('serialNumber') ? <td className={`${valueCell} text-center`}>{index + 1}</td> : null}
                      <td className={valueCell}><div className="font-medium">{itemLabel(item, line) || '-'}</div>{printOn('itemDescription') && line?.description ? <div className="text-[10px] text-gray-500">{line.description}</div> : null}</td>
                      {hasBatchDetails ? <td className={valueCell}>{batchNote(line) || ''}</td> : null}
                      {printOn('hsnSac') ? <td className={`${valueCell} text-center`}>{line?.hsnSac || item?.hsnSac || '—'}</td> : null}
                      {printOn('quantity') ? <td className={`${valueCell} text-right whitespace-nowrap`}>{wholeNumber(line?.quantity)}</td> : null}
                      {printOn('rate') ? <td className={`${valueCell} text-right whitespace-nowrap`}>{wholeMoney(line?.rate)}</td> : null}
                      {hasPartNumbers ? <td className={valueCell}>{line?.partNumber || item?.partNumber || ''}</td> : null}
                      {printOn('gstRate') ? <td className={`${valueCell} text-right whitespace-nowrap`}>{wholeNumber(line?.gstRate)}</td> : null}
                      {printOn('taxAmount') ? <td className={`${valueCell} text-right whitespace-nowrap`}>{wholeMoney(tax)}</td> : null}
                      <td className={`${valueCell} text-right font-semibold whitespace-nowrap`}>{wholeMoney(line?.lineTotal ?? line?.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section className="grid grid-cols-[1fr_19rem] gap-6 items-start">
            <div className="space-y-3">
              {printOn('hsnSummary') && taxRows.length ? (
                <div className="rounded-lg border overflow-hidden text-[10px]">
                  <div className="bg-slate-100 px-3 py-1.5 font-bold">HSN / GST summary</div>
                  <table className="w-full table-fixed"><thead><tr className="text-gray-500"><th className="p-1 text-left">HSN/SAC</th><th className="p-1 text-right">Taxable</th><th className="p-1 text-right">Rate</th><th className="p-1 text-right">CGST</th><th className="p-1 text-right">SGST</th><th className="p-1 text-right">IGST</th></tr></thead><tbody>{taxRows.map((row) => <tr key={row.hsn}><td className="p-1">{row.hsn}</td><td className="p-1 text-right">{wholeMoney(row.taxable)}</td><td className="p-1 text-right">{wholeNumber(row.rate)}</td><td className="p-1 text-right">{wholeMoney(row.cgst)}</td><td className="p-1 text-right">{wholeMoney(row.sgst)}</td><td className="p-1 text-right">{wholeMoney(row.igst)}</td></tr>)}</tbody></table>
                </div>
              ) : null}
              {paymentBlock()}
              {invoice?.irn && printOn('itemTaxDetails') ? <div className="rounded-lg border p-3 text-[10px]"><b>e-Invoice:</b> IRN {invoice.irn}</div> : null}
            </div>
            <div className="rounded-lg border p-3 text-xs space-y-1">
              <div className="flex justify-between"><span>Taxable value</span><b>{wholeMoney(invoice?.subtotal)}</b></div>
              {printOn('taxSummary') ? <><div className="flex justify-between"><span>CGST</span><span>{wholeMoney(invoice?.cgstTotal)}</span></div><div className="flex justify-between"><span>SGST</span><span>{wholeMoney(invoice?.sgstTotal)}</span></div><div className="flex justify-between"><span>IGST</span><span>{wholeMoney(invoice?.igstTotal)}</span></div></> : null}
              <div className="flex justify-between border-t pt-2 mt-2 text-sm"><b>Grand total</b><b>{wholeMoney(invoice?.total)}</b></div>
              {printOn('amountInWords') ? <div className="border-t pt-2 mt-2 text-[10px] text-gray-600">{amountInWordsInr(Number(invoice?.total || 0))}</div> : null}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-4 border-t pt-3 text-xs">
            {printOn('terms') && docSettings?.templates?.invoice?.termsText ? <div><div className="font-bold mb-1">Terms and conditions</div><div className="whitespace-pre-line text-gray-600">{docSettings.templates.invoice.termsText}</div></div> : <div />}
            <div>
              {printOn('declaration') && printSettings.declarationText ? <><div className="font-bold mb-1">Declaration</div><div className="text-gray-600">{printSettings.declarationText}</div></> : null}
              {printOn('jurisdiction') && printSettings.jurisdictionText ? <div className="mt-3 text-gray-600">{printSettings.jurisdictionText}</div> : null}
              {printOn('signature') ? <div className="mt-8 text-right font-semibold">For {company?.name || 'Company'}<div className="mt-8 text-[10px] font-normal">Authorised signatory</div></div> : null}
            </div>
          </section>
          {printOn('footerNote') && printSettings.footerText ? <div className="border-t pt-2 text-center text-[10px] text-gray-500">{printSettings.footerText}</div> : null}
        </div>
      </div>
    );
  }

  if (templateId === 'a4Modern') {
    const place = String(invoice?.placeOfSupplyState || '').trim();
    const placeCode = codeForStateName(place);
    const placeDisplay = place ? `${place}${placeCode ? ` (${placeCode})` : ''}` : '';

    return (
      <div className="printable max-w-[980px] mx-auto text-sm text-gray-900" data-invoice-preview>
        <div className="border rounded-lg overflow-hidden bg-white">
          <div className={`h-2 ${accent.barClass}`} />
          <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                {companyLogo()}
                <div className="min-w-0">
                  <div className="text-2xl font-extrabold">{company?.name || 'Company'}</div>
                  {companyAddress ? <div className="text-xs text-gray-600">{companyAddress}</div> : null}
                  {printOn('companyGstin') && company?.gstin ? <div className="text-xs text-gray-600">GSTIN: {company.gstin}</div> : null}
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">{printSettings.title}</div>
                <div className="mt-2 text-xs text-gray-600">Invoice No: {invoice?.number || '-'}</div>
                <div className="text-xs text-gray-600">Date: {invoice?.date || '-'}</div>
                {invoice?.dueDate ? <div className="text-xs text-gray-600">Due: {invoice.dueDate}</div> : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-700 uppercase">Bill To</div>
                <div className="mt-1 font-semibold">
                  {invoice?.customerName || customer?.displayName || customer?.name || '-'}
                </div>
                {customerAddress ? <div className="text-xs text-gray-600">{customerAddress}</div> : null}
                {invoice?.customerGstin ? <div className="text-xs text-gray-600">GSTIN: {invoice.customerGstin}</div> : null}
                {placeDisplay ? <div className="text-xs text-gray-600">Place of Supply: {placeDisplay}</div> : null}
                {referenceLines().map((r) => (
                  <div key={r.label} className="text-xs text-gray-600">
                    {r.label}: {r.value}
                  </div>
                ))}
              </div>

              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-700 uppercase">Summary</div>
                <div className="mt-2 flex justify-between">
                  <span className="text-gray-600">Taxable</span>
                  <span className="font-semibold">{formatMoney(Number(invoice?.subtotal ?? 0), currentCompany)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">GST</span>
                  <span className="font-semibold">{formatMoney(Number(invoice?.gstTotal ?? 0), currentCompany)}</span>
                </div>
                <div className="flex justify-between border-t mt-2 pt-2">
                  <span className="font-bold">Total</span>
                  <span className="font-bold">{formatMoney(Number(invoice?.total ?? 0), currentCompany)}</span>
                </div>
                <TdsLines invoice={invoice} currentCompany={currentCompany} />
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[5%]">Sr</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product / Service</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[10%]">HSN/SAC</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[8%]">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[12%]">Rate</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[12%]">Taxable</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[8%]">GST%</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[12%]">GST Amt</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[13%]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                        No line items
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => {
                      const item = l?.itemId ? itemsById.get(String(l.itemId)) : null;
                      const name = itemLabel(item, l);
                      const hsn = String(l?.hsnSac || item?.hsnSac || '').trim();
                      const qty = Number(l?.quantity ?? 0);
                      const unit = String(item?.unit || '').trim();
                      const rate = Number(l?.rate ?? 0);
                      const taxable = Number(l?.taxableAmount ?? l?.amount ?? 0);
                      const gstRate = Number(l?.gstRate ?? 0);
                      const gstAmt = Number.isFinite(Number(l?.gstAmount))
                        ? Number(l?.gstAmount)
                        : Number.isFinite(Number(l?.igstAmount))
                          ? Number(l?.igstAmount)
                          : Number.isFinite(Number(l?.cgstAmount)) || Number.isFinite(Number(l?.sgstAmount))
                            ? Number(l?.cgstAmount ?? 0) + Number(l?.sgstAmount ?? 0)
                            : 0;
                      const total = Number(l?.lineTotal ?? taxable + gstAmt);

                      return (
                        <tr key={idx}>
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">{name || '-'}{printOn('batchDetails') && batchNote(l) ? <div className="text-[10px] text-gray-500">{batchNote(l)}</div> : null}</td>
                          <td className="px-3 py-2">{hsn || '-'}</td>
                          <td className="px-3 py-2 text-right">{Number.isFinite(qty) ? `${qty}${unit ? ` ${unit}` : ''}` : '-'}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(Number.isFinite(rate) ? rate : 0, currentCompany)}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(Number.isFinite(taxable) ? taxable : 0, currentCompany)}</td>
                          <td className="px-3 py-2 text-right">{Number.isFinite(gstRate) ? gstRate : 0}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(Number.isFinite(gstAmt) ? gstAmt : 0, currentCompany)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatMoney(Number.isFinite(total) ? total : 0, currentCompany)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {printOn('amountInWords') && prefOn('amountInWords') ? (
              <div className="text-xs text-gray-700">{amountInWordsInr(Number(invoice?.total ?? 0))}</div>
            ) : null}

            {paymentBlock()}

            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-700 uppercase">Terms</div>
                <div className="text-xs text-gray-600 mt-2 whitespace-pre-line">
                  {printOn('terms') && prefOn('terms') && String(docSettings?.templates?.invoice?.termsText || '').trim()
                    ? docSettings.templates.invoice.termsText
                    : 'This is a computer generated invoice. Signature not required.'}
                </div>
                {printedCustomFields('terms').map((f) => (
                  <div key={f.key} className="text-xs text-gray-600 mt-1">
                    <span className="font-semibold text-gray-700">{f.label}:</span> {f.value}
                  </div>
                ))}
              </div>
              {prefOn('signature') ? (
                <div className="border rounded-lg p-4">
                  <div className="text-xs font-semibold text-gray-700 uppercase">For {company?.name || 'Company'}</div>
                  <div className="mt-10 text-xs text-gray-600">(Authorized Signatory)</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4BoxedGst') {
    const place = String(invoice?.placeOfSupplyState || '').trim();
    const placeCode = codeForStateName(place);
    const placeDisplay = place ? `${place}${placeCode ? ` (${placeCode})` : ''}` : '';

    const isIntra = String(invoice?.taxType || '').toUpperCase() === 'CGST_SGST';

    const safeNum = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

    return (
      <div className="printable max-w-[980px] mx-auto text-sm text-gray-900" data-invoice-preview>
        <div className="border-2 border-gray-900 bg-white">
          <div className={`h-2 ${accent.barClass}`} />
          <div className="p-6 border-b-2 border-gray-900">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                {companyLogo()}
                <div className="min-w-0">
                  <div className="text-2xl font-extrabold">{company?.name || 'Company'}</div>
                  {companyAddress ? <div className="text-xs text-gray-600">{companyAddress}</div> : null}
                  {printOn('companyGstin') && company?.gstin ? <div className="text-xs text-gray-600">GSTIN: {company.gstin}</div> : null}
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">{printSettings.title}</div>
                <div className="mt-2 text-xs text-gray-600">Invoice No: {invoice?.number || '-'}</div>
                <div className="text-xs text-gray-600">Date: {invoice?.date || '-'}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b-2 border-gray-900">
            <div className="p-4 border-r-2 border-gray-900">
              <div className="text-xs font-semibold uppercase">Bill To</div>
              <div className="font-semibold mt-1">{invoice?.customerName || customer?.displayName || customer?.name || '-'}</div>
              {customerAddress ? <div className="text-xs text-gray-600">{customerAddress}</div> : null}
              {invoice?.customerGstin ? <div className="text-xs text-gray-600">GSTIN: {invoice.customerGstin}</div> : null}
              {placeDisplay ? <div className="text-xs text-gray-600">Place of Supply: {placeDisplay}</div> : null}
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold uppercase">Totals</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-gray-600">Taxable</div>
                <div className="text-right font-semibold">{formatMoney(safeNum(invoice?.subtotal), currentCompany)}</div>
                {isIntra ? (
                  <>
                    <div className="text-gray-600">CGST</div>
                    <div className="text-right font-semibold">{formatMoney(safeNum(invoice?.cgstTotal), currentCompany)}</div>
                    <div className="text-gray-600">SGST</div>
                    <div className="text-right font-semibold">{formatMoney(safeNum(invoice?.sgstTotal), currentCompany)}</div>
                  </>
                ) : (
                  <>
                    <div className="text-gray-600">IGST</div>
                    <div className="text-right font-semibold">{formatMoney(safeNum(invoice?.igstTotal), currentCompany)}</div>
                  </>
                )}
                <div className="text-gray-600">Total</div>
                <div className="text-right font-bold">{formatMoney(safeNum(invoice?.total), currentCompany)}</div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="border-2 border-gray-900 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b-2 border-gray-900">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900 w-[5%]">Sr</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900">Item</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900 w-[10%]">HSN</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900 w-[8%]">Qty</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900 w-[10%]">Rate</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900 w-[12%]">Taxable</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900 w-[7%]">GST%</th>
                    {isIntra ? (
                      <>
                        <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900 w-[10%]">CGST</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900 w-[10%]">SGST</th>
                      </>
                    ) : (
                      <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900 w-[10%]">IGST</th>
                    )}
                    <th className="px-2 py-2 text-right text-xs font-semibold w-[12%]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={isIntra ? 10 : 9} className="px-3 py-10 text-center text-gray-600">
                        No line items
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => {
                      const item = l?.itemId ? itemsById.get(String(l.itemId)) : null;
                      const name = itemLabel(item, l);
                      const hsn = String(l?.hsnSac || item?.hsnSac || '').trim();
                      const qty = safeNum(l?.quantity);
                      const unit = String(item?.unit || '').trim();
                      const rate = safeNum(l?.rate);
                      const taxable = safeNum(l?.taxableAmount ?? l?.amount);
                      const gstRate = safeNum(l?.gstRate);
                      const cgst = safeNum(l?.cgstAmount);
                      const sgst = safeNum(l?.sgstAmount);
                      const igst = safeNum(l?.igstAmount);
                      const total = safeNum(l?.lineTotal ?? taxable + safeNum(l?.gstAmount));

                      return (
                        <tr key={idx}>
                          <td className="px-2 py-2 border-r-2 border-gray-900">{idx + 1}</td>
                          <td className="px-2 py-2 border-r-2 border-gray-900">{name || '-'}{printOn('batchDetails') && batchNote(l) ? <div className="text-[10px] text-gray-600">{batchNote(l)}</div> : null}</td>
                          <td className="px-2 py-2 border-r-2 border-gray-900">{hsn || '-'}</td>
                          <td className="px-2 py-2 text-right border-r-2 border-gray-900">{Number.isFinite(qty) ? `${qty}${unit ? ` ${unit}` : ''}` : '-'}</td>
                          <td className="px-2 py-2 text-right border-r-2 border-gray-900">{formatMoney(rate, currentCompany)}</td>
                          <td className="px-2 py-2 text-right border-r-2 border-gray-900">{formatMoney(taxable, currentCompany)}</td>
                          <td className="px-2 py-2 text-right border-r-2 border-gray-900">{gstRate}</td>
                          {isIntra ? (
                            <>
                              <td className="px-2 py-2 text-right border-r-2 border-gray-900">{formatMoney(cgst, currentCompany)}</td>
                              <td className="px-2 py-2 text-right border-r-2 border-gray-900">{formatMoney(sgst, currentCompany)}</td>
                            </>
                          ) : (
                            <td className="px-2 py-2 text-right border-r-2 border-gray-900">{formatMoney(igst, currentCompany)}</td>
                          )}
                          <td className="px-2 py-2 text-right font-semibold">{formatMoney(total, currentCompany)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {printOn('amountInWords') && prefOn('amountInWords') ? (
              <div className="text-xs mt-4">{amountInWordsInr(Number(invoice?.total ?? 0))}</div>
            ) : null}

            <div className="mt-4">{paymentBlock()}</div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border-2 border-gray-900 p-4">
                <div className="text-xs font-semibold uppercase">Terms</div>
                <div className="text-xs text-gray-600 mt-2 whitespace-pre-line">
                  {printOn('terms') && prefOn('terms') && String(docSettings?.templates?.invoice?.termsText || '').trim()
                    ? docSettings.templates.invoice.termsText
                    : 'Subject to jurisdiction.'}
                </div>
                {printedCustomFields('terms').map((f) => (
                  <div key={f.key} className="text-xs text-gray-600 mt-1">
                    <span className="font-semibold">{f.label}:</span> {f.value}
                  </div>
                ))}
              </div>
              {prefOn('signature') ? (
                <div className="border-2 border-gray-900 p-4">
                  <div className="text-xs font-semibold uppercase">For {company?.name || 'Company'}</div>
                  <div className="mt-10 text-xs text-gray-600">(Authorized Signatory)</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4Letterhead') {
    const place = String(invoice?.placeOfSupplyState || '').trim();
    const placeCode = codeForStateName(place);
    const placeDisplay = place ? `${place}${placeCode ? ` (${placeCode})` : ''}` : '';

    return (
      <div className="printable max-w-[980px] mx-auto text-sm text-gray-900" data-invoice-preview>
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className={`p-6 ${accent.barClass} text-white`}>
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                {companyLogo()}
                <div className="min-w-0">
                  <div className="text-2xl font-extrabold">{company?.name || 'Company'}</div>
                  {companyAddress ? <div className="text-xs opacity-95">{companyAddress}</div> : null}
                  {printOn('companyGstin') && company?.gstin ? <div className="text-xs opacity-95">GSTIN: {company.gstin}</div> : null}
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">{printSettings.title}</div>
                <div className="mt-2 text-xs opacity-95">Invoice No: {invoice?.number || '-'}</div>
                <div className="text-xs opacity-95">Date: {invoice?.date || '-'}</div>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-700 uppercase">Bill To</div>
                <div className="mt-1 font-semibold">{invoice?.customerName || customer?.displayName || customer?.name || '-'}</div>
                {customerAddress ? <div className="text-xs text-gray-600">{customerAddress}</div> : null}
                {invoice?.customerGstin ? <div className="text-xs text-gray-600">GSTIN: {invoice.customerGstin}</div> : null}
                {placeDisplay ? <div className="text-xs text-gray-600">Place of Supply: {placeDisplay}</div> : null}
                {referenceLines().map((r) => (
                  <div key={r.label} className="text-xs text-gray-600">
                    {r.label}: {r.value}
                  </div>
                ))}
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-700 uppercase">Totals</div>
                <div className="mt-2 flex justify-between">
                  <span className="text-gray-600">Taxable</span>
                  <span className="font-semibold">{formatMoney(Number(invoice?.subtotal ?? 0), currentCompany)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">GST</span>
                  <span className="font-semibold">{formatMoney(Number(invoice?.gstTotal ?? 0), currentCompany)}</span>
                </div>
                <div className="flex justify-between border-t mt-2 pt-2">
                  <span className="font-bold">Total</span>
                  <span className="font-bold">{formatMoney(Number(invoice?.total ?? 0), currentCompany)}</span>
                </div>
                <TdsLines invoice={invoice} currentCompany={currentCompany} />
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[5%]">Sr</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product / Service</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[10%]">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[12%]">Taxable</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[10%]">GST%</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[13%]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                        No line items
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, idx) => {
                      const item = l?.itemId ? itemsById.get(String(l.itemId)) : null;
                      const name = itemLabel(item, l);
                      const qty = Number(l?.quantity ?? 0);
                      const unit = String(item?.unit || '').trim();
                      const taxable = Number(l?.taxableAmount ?? l?.amount ?? 0);
                      const gstRate = Number(l?.gstRate ?? 0);
                      const gstAmt = Number.isFinite(Number(l?.gstAmount))
                        ? Number(l?.gstAmount)
                        : Number.isFinite(Number(l?.igstAmount))
                          ? Number(l?.igstAmount)
                          : Number.isFinite(Number(l?.cgstAmount)) || Number.isFinite(Number(l?.sgstAmount))
                            ? Number(l?.cgstAmount ?? 0) + Number(l?.sgstAmount ?? 0)
                            : 0;
                      const total = Number(l?.lineTotal ?? taxable + gstAmt);

                      return (
                        <tr key={idx}>
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">{name || '-'}{printOn('batchDetails') && batchNote(l) ? <div className="text-[10px] text-gray-500">{batchNote(l)}</div> : null}</td>
                          <td className="px-3 py-2 text-right">{Number.isFinite(qty) ? `${qty}${unit ? ` ${unit}` : ''}` : '-'}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(Number.isFinite(taxable) ? taxable : 0, currentCompany)}</td>
                          <td className="px-3 py-2 text-right">{Number.isFinite(gstRate) ? gstRate : 0}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatMoney(Number.isFinite(total) ? total : 0, currentCompany)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {printOn('amountInWords') && prefOn('amountInWords') ? (
              <div className="text-xs text-gray-700">{amountInWordsInr(Number(invoice?.total ?? 0))}</div>
            ) : null}

            {paymentBlock()}

            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-700 uppercase">Notes</div>
                <div className="text-xs text-gray-600 mt-2" style={{ whiteSpace: 'pre-wrap' }}>
                  {printOn('terms') && prefOn('terms') && String(docSettings?.templates?.invoice?.termsText || '').trim()
                    ? docSettings.templates.invoice.termsText
                    : 'This is a computer generated invoice. Signature not required.'}
                </div>
                {printedCustomFields('terms').map((f) => (
                  <div key={f.key} className="text-xs text-gray-600 mt-1">
                    <span className="font-semibold text-gray-700">{f.label}:</span> {f.value}
                  </div>
                ))}
              </div>
              {prefOn('signature') ? (
                <div className="border rounded-lg p-4">
                  <div className="text-xs font-semibold text-gray-700 uppercase">For {company?.name || 'Company'}</div>
                  <div className="mt-10 text-xs text-gray-600">(Authorized Signatory)</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a5' || templateId === 'a5Compact' || templateId === 'a5Clean' || templateId === 'a5Boxed') {
    const place = String(invoice?.placeOfSupplyState || '').trim();
    const placeCode = codeForStateName(place);
    const placeDisplay = place ? `${place}${placeCode ? ` (${placeCode})` : ''}` : '';

    const variant = templateId;
    const isCompact = variant === 'a5Compact';
    const isClean = variant === 'a5Clean';
    const isBoxed = variant === 'a5Boxed';

    const outerClass = isCompact ? 'text-[10px] leading-4' : 'text-[11px] leading-4';
    const borderClass = isBoxed ? 'border-2 border-gray-900' : 'border border-gray-900';
      const pHead = isCompact ? 'p-2' : 'p-3';
    const pCell = isCompact ? 'p-2' : 'p-3';

    return (
      <div className={`printable max-w-[720px] mx-auto text-gray-900 ${outerClass}`} data-invoice-preview>
        <div className={`${borderClass} bg-white`}>
          <div className={`${pHead} ${isBoxed ? 'border-b-2 border-gray-900' : 'border-b border-gray-900'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                {companyLogo('h-10 w-10')}
                <div className="min-w-0">
                  <div className="text-base font-bold">{company?.name || 'Company'}</div>
                  {printOn('companyAddress') && companyAddress ? <div className="text-[10px] text-gray-700">{companyAddress}</div> : null}
                  {printOn('companyGstin') && company?.gstin ? <div className="text-[10px] text-gray-700">GSTIN : {company.gstin}</div> : null}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold tracking-wide">{printSettings.title}</div>
                <div className="text-[10px] font-semibold">{printSettings.subtitle || 'ORIGINAL FOR RECIPIENT'}</div>
              </div>
            </div>
          </div>

          <div className={`grid ${isCompact ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <div className={`${pCell} ${isBoxed ? 'border-r-2 border-gray-900' : 'border-r border-gray-900'}`}>
              <div className="font-semibold">M/S</div>
              <div className="font-semibold">{invoice?.customerName || customer?.displayName || customer?.name || '-'}</div>
              {printOn('customerAddress') && customerAddress ? <div className="text-[10px] text-gray-700">{customerAddress}</div> : null}
              {printOn('customerGstin') && invoice?.customerGstin ? <div className="text-[10px] text-gray-700">GSTIN : {invoice.customerGstin}</div> : null}
              {placeDisplay ? <div className="text-[10px] text-gray-700">Place of Supply : {placeDisplay}</div> : null}
            </div>

            {!isCompact && printOn('documentReferences') && (
              <div className={`${pCell} ${isBoxed ? 'border-r-2 border-gray-900' : 'border-r border-gray-900'}`}>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <div className="font-semibold">Invoice No.</div>
                  <div>{invoice?.number || '-'}</div>
                  <div className="font-semibold">Challan No</div>
                  <div>{invoice?.refNo || '—'}</div>
                  <div className="font-semibold">E-Way Bill No.</div>
                  <div>—</div>
                  <div className="font-semibold">Transport</div>
                  <div>—</div>
                  <div className="font-semibold">Transport ID</div>
                  <div>—</div>
                </div>
              </div>
            )}

            <div className={pCell}>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                <div className="font-semibold">Invoice No.</div>
                <div>{invoice?.number || '-'}</div>
                <div className="font-semibold">Invoice Date</div>
                <div>{invoice?.date || '-'}</div>
                {!isClean && (
                  <>
                    <div className="font-semibold">Challan Date</div>
                    <div>{invoice?.refDate || '—'}</div>
                  </>
                )}
                <div className="font-semibold">Due Date</div>
                <div>{invoice?.dueDate || '—'}</div>
              </div>
            </div>
          </div>

          <div className={isBoxed ? 'border-t-2 border-gray-900' : 'border-t border-gray-900'}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={isBoxed ? 'border-b-2 border-gray-900' : 'border-b border-gray-900'}>
                  {printOn('serialNumber') ? <th className="p-1 border-r border-gray-900 w-[6%]">Sr.</th> : null}
                  <th className="p-1 border-r border-gray-900">Name of Product / Service</th>
                  {!isCompact && printOn('hsnSac') ? <th className="p-1 border-r border-gray-900 w-[12%]">HSN/SAC</th> : null}
                  {printOn('quantity') ? <th className="p-1 border-r border-gray-900 w-[10%]">Qty</th> : null}
                  {!isCompact && printOn('rate') ? <th className="p-1 border-r border-gray-900 w-[12%]">Rate</th> : null}
                  <th className="p-1 border-r border-gray-900 w-[14%]">Taxable</th>
                  {printOn('gstRate') ? <th className="p-1 border-r border-gray-900 w-[10%]">GST %</th> : null}
                  {!isCompact && printOn('taxAmount') ? <th className="p-1 border-r border-gray-900 w-[12%]">GST Amt</th> : null}
                  <th className="p-1 w-[14%]">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-gray-600">
                      No line items
                    </td>
                  </tr>
                ) : (
                  lines.map((l, idx) => {
                    const item = l?.itemId ? itemsById.get(String(l.itemId)) : null;
                    const name = itemLabel(item, l);
                    const hsn = String(l?.hsnSac || item?.hsnSac || '').trim();
                    const qty = Number(l?.quantity ?? 0);
                    const unit = String(item?.unit || '').trim();
                    const rate = Number(l?.rate ?? 0);
                    const taxable = Number(l?.taxableAmount ?? l?.amount ?? 0);
                    const gstRate = Number(l?.gstRate ?? 0);
                    const gstAmt = Number.isFinite(Number(l?.gstAmount))
                      ? Number(l?.gstAmount)
                      : Number.isFinite(Number(l?.igstAmount))
                        ? Number(l?.igstAmount)
                        : 0;
                    const total = Number(l?.lineTotal ?? taxable + gstAmt);

                    return (
                      <tr key={idx} className="border-b border-gray-200 last:border-b-0">
                        {printOn('serialNumber') ? <td className="p-1 border-r border-gray-900 text-center">{idx + 1}</td> : null}
                        <td className="p-1 border-r border-gray-900">{name || '-'}{printOn('batchDetails') && batchNote(l) ? <div className="text-[9px] text-gray-600">{batchNote(l)}</div> : null}</td>
                        {!isCompact && printOn('hsnSac') ? <td className="p-1 border-r border-gray-900 text-center">{hsn || '-'}</td> : null}
                        {printOn('quantity') ? <td className="p-1 border-r border-gray-900 text-center">{Number.isFinite(qty) ? `${qty}${unit ? ` ${unit}` : ''}` : '-'}</td> : null}
                        {!isCompact && printOn('rate') ? <td className="p-1 border-r border-gray-900 text-right">{formatMoney(Number.isFinite(rate) ? rate : 0, currentCompany)}</td> : null}
                        <td className="p-1 border-r border-gray-900 text-right">{formatMoney(Number.isFinite(taxable) ? taxable : 0, currentCompany)}</td>
                        {printOn('gstRate') ? <td className="p-1 border-r border-gray-900 text-center">{Number.isFinite(gstRate) ? gstRate : 0}</td> : null}
                        {!isCompact && printOn('taxAmount') && (
                          <td className="p-1 border-r border-gray-900 text-right">{formatMoney(Number.isFinite(gstAmt) ? gstAmt : 0, currentCompany)}</td>
                        )}
                        <td className="p-1 text-right">{formatMoney(Number.isFinite(total) ? total : 0, currentCompany)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className={`grid ${isCompact ? 'grid-cols-2' : 'grid-cols-3'} ${isBoxed ? 'border-t-2 border-gray-900' : 'border-t border-gray-900'}`}>
            <div className={`${pCell} ${isCompact ? '' : 'col-span-2'} ${isBoxed ? 'border-r-2 border-gray-900' : 'border-r border-gray-900'}`}>
              {printOn('amountInWords') && prefOn('amountInWords') ? (
                <>
                  <div className="font-semibold">Total in words</div>
                  <div className="text-[10px] text-gray-700">{amountInWordsInr(Number(invoice?.total ?? 0))}</div>
                </>
              ) : null}

              {!isClean && (
                <>
                  <div className="mt-3 font-semibold">Terms and Conditions</div>
                  <div className="text-[10px] text-gray-700">Goods once sold will not be taken back.</div>
                </>
              )}

              {printOn('signature') ? <div className="mt-8 font-semibold">Customer Signature</div> : null}
            </div>
            <div className={pCell}>
              <div className="space-y-1">
                <div className="flex justify-between font-semibold">
                  <span>Taxable Amount</span>
                  <span>{formatMoney(Number(invoice?.subtotal ?? 0), currentCompany)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total Tax</span>
                  <span>{formatMoney(Number(invoice?.gstTotal ?? 0), currentCompany)}</span>
                </div>
                <div className={`flex justify-between font-extrabold ${isBoxed ? 'border-t-2 border-gray-900' : 'border-t border-gray-900'} mt-2 pt-2`}>
                  <span>Total Amount</span>
                  <span>{formatMoney(Number(invoice?.total ?? 0), currentCompany)}</span>
                </div>

                {paymentBlock() ? <div className="mt-3">{paymentBlock()}</div> : null}

                <div className="mt-6 text-[10px] text-gray-700">
                  {printOn('terms') && prefOn('terms') && String(docSettings?.templates?.invoice?.termsText || '').trim()
                    ? docSettings.templates.invoice.termsText
                    : 'This is a computer generated invoice. Signature not required.'}
                </div>
              </div>
            </div>
          </div>

          {printOn('footerNote') && printSettings.footerText ? (
            <div className="p-2 border-t border-gray-900 text-[10px] text-gray-700">{printSettings.footerText}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`printable space-y-3 invoice-paper-${printSettings.paperSize} invoice-spacing-${printSettings.margin}`}
      data-invoice-preview
      data-paper-size={printSettings.paperSize}
      data-orientation={printSettings.orientation}
    >
      <div className="border rounded-lg overflow-hidden">
        <div className={`h-2 ${accent.barClass}`} />
        <div className={printSettings.margin === 'compact' ? 'p-2' : printSettings.margin === 'wide' ? 'p-8' : 'p-4'}>{content}</div>
      </div>
    </div>
  );
};

export default InvoicePreview;
