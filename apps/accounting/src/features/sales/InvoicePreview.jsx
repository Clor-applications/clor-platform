import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

import { ACCENT_OPTIONS, getDocSettings } from '@ui/utils/docSettings';
import { amountInWordsInr, formatMoney } from '@ui/utils/money';
import { formatDateIn } from '@ui/utils/dates';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { getInvoicePrintSettings } from '@ui/utils/invoicePrintSettings';
import './DetailedGstInvoice.css';
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

const InvoicePreview = ({ db, currentCompany, invoice, docSettingsOverride = null }) => {
  const docSettings = useMemo(() => {
    if (docSettingsOverride) return docSettingsOverride;
    // The invoice list can keep the selected company object from the previous
    // render while the template designer has just saved a newer docSettings
    // value into db.companies. Resolve the freshest company record here so
    // list previews immediately use the template selected in Master Data.
    const freshCompany = (db?.companies || []).find((company) => String(company?.id) === String(currentCompany?.id)) || currentCompany;
    return getDocSettings(db, freshCompany, { branchId: invoice?.branchId || null });
  }, [db, currentCompany, invoice?.branchId, docSettingsOverride]);
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
  const date = value => formatDateIn(value, company);
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
          <div className="text-xs text-gray-500">Date: {date(invoice?.date) || '-'}</div>
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
          <InfoRow label="Due Date" value={date(invoice?.dueDate)} right />
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
            <div className="border-t pt-2 mt-2 text-xs text-gray-600">{amountInWordsInr(Number(invoice?.total ?? 0), company)}</div>
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

  if (templateId === 'a4DetailedGst' || templateId === 'standardClor') {
    const money = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows = lines.map((line, index) => {
      const item = line?.itemId ? itemsById.get(String(line.itemId)) : null;
      const quantity = Number(line?.quantity || 0);
      const rate = Number(line?.rate || 0);
      const taxable = Number(line?.taxableAmount ?? line?.taxable ?? line?.amount ?? (quantity * rate));
      const gstRate = Number(line?.gstRate || 0);
      const tax = Number(line?.gstAmount ?? ((Number(line?.cgstAmount || 0) + Number(line?.sgstAmount || 0) + Number(line?.igstAmount || 0)) || taxable * gstRate / 100));
      return { line, item, index, quantity, rate, taxable, gstRate, tax, hsn: String(line?.hsnSac || item?.hsnSac || ''), name: itemLabel(item, line) || '-' };
    });
    const groupedTax = Array.from(rows.reduce((map, row) => {
      const key = `${row.hsn || '—'}|${row.gstRate}`;
      const entry = map.get(key) || { hsn: row.hsn || '—', rate: row.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
      entry.taxable += row.taxable;
      const split = invoice?.taxType !== 'IGST' && invoice?.taxType !== 'IGST_ONLY' && Number(invoice?.igstTotal || 0) === 0;
      entry.cgst += Number(row.line?.cgstAmount ?? (split ? row.tax / 2 : 0));
      entry.sgst += Number(row.line?.sgstAmount ?? (split ? row.tax / 2 : 0));
      entry.igst += Number(row.line?.igstAmount ?? (split ? 0 : row.tax));
      entry.tax += row.tax;
      map.set(key, entry);
      return map;
    }, new Map()).values());
    const customerName = invoice?.customerName || customer?.displayName || customer?.name || '—';
    const shipping = invoice?.shipToAddress;
    const shippingAddress = shipping ? [shipping.line1, shipping.line2, shipping.city, shipping.state, shipping.pincode].filter(Boolean).join(', ') : '';
    const detail = (label, value) => value ? <div className="detailed-gst-fact" key={label}><b>{label}</b><span>{value}</span></div> : null;
    const totals = [
      ['Taxable value', invoice?.subtotal ?? rows.reduce((sum, row) => sum + row.taxable, 0)],
      ['Discount', invoice?.invoiceDiscountApplied],
      ['CGST', invoice?.cgstTotal],
      ['SGST', invoice?.sgstTotal],
      ['IGST', invoice?.igstTotal],
      ['Cess', invoice?.cessTotal],
      ['Other charges', invoice?.otherChargesTotal],
      ['Round off', invoice?.roundOff],
    ];
    const declaration = String(printSettings.declarationText || docSettings?.templates?.invoice?.declarationText || '').trim();
    if (templateId === 'standardClor') {
      const addressOne = [company?.address, company?.addressLine1].filter(Boolean).join(', ');
      const addressTwo = [company?.addressLine2, company?.city, company?.state, company?.pincode, company?.country].filter(Boolean).join(', ');
      const billingAddress = customer?.billingAddress || {};
      const billingOne = [billingAddress?.line1, billingAddress?.line2].filter(Boolean).join(', ');
      const billingTwo = [billingAddress?.city, billingAddress?.state, billingAddress?.pincode, billingAddress?.country].filter(Boolean).join(', ');
      const shipOne = [shipping?.line1, shipping?.line2].filter(Boolean).join(', ');
      const shipTwo = [shipping?.city, shipping?.state, shipping?.pincode, shipping?.country].filter(Boolean).join(', ');
      const totalLine = (label, value, prominent = false) => <div className={prominent ? 'clor-total-grand' : ''}><dt>{label}</dt><dd>{formatMoney(Number(value || 0), currentCompany)}</dd></div>;
      return (
        <article className="printable clor-standard-invoice" data-invoice-preview aria-label="Standard CLOR tax invoice">
          <header className="clor-standard-top">
            <div className="clor-standard-brand">{printOn('companyLogo') && companyLogo('clor-standard-logo') ? companyLogo('clor-standard-logo') : <><span>CLOR</span><small>Accounting Made Simple</small></>}</div>
            <h2>{printSettings.title || 'TAX INVOICE'}</h2>
          </header>
          <section className="clor-company-and-invoice">
            <div className="clor-company-lines">
              <strong>{String(company?.legalName || company?.name || 'Company').toUpperCase()}</strong>
              {printOn('companyAddress') ? <><span>{addressOne || '—'}</span><span>{addressTwo || '—'}</span></> : null}
              <span>{[printOn('companyGstin') && company?.gstin && `GSTIN: ${company.gstin}`, printOn('companyPan') && company?.pan && `PAN: ${company.pan}`].filter(Boolean).join('  |  ')}</span>
              {printOn('companyCin') ? <span>CIN: {company?.cin || '—'}</span> : null}
              <span>{[printOn('companyPhone') && company?.phone, printOn('companyWebsite') && company?.website, printOn('companyEmail') && company?.email].filter(Boolean).join('  |  ')}</span>
            </div>
            <dl className="clor-invoice-facts">
              <div><dt>Invoice No.</dt><dd>{invoice?.number || '—'}</dd></div>
              <div><dt>Invoice Date</dt><dd>{date(invoice?.date) || '—'}</dd></div>
              <div><dt>Due Date</dt><dd>{date(invoice?.dueDate) || '—'}</dd></div>
              <div><dt>Place of Supply</dt><dd>{invoice?.placeOfSupplyState || '—'}</dd></div>
              <div><dt>Reverse Charge</dt><dd>{invoice?.reverseCharge ? 'Yes' : 'No'}</dd></div>
            </dl>
          </section>
          <section className="clor-party-grid">
            <div><h3>Bill To</h3><strong>{customerName}</strong><span>{billingOne || customerAddress || '—'}</span><span>{billingTwo}</span><span>{[printOn('customerGstin') && (invoice?.customerGstin || customer?.gstin) && `GSTIN: ${invoice?.customerGstin || customer?.gstin}`, printOn('placeOfSupply') && invoice?.placeOfSupplyState && `Place of Supply: ${invoice.placeOfSupplyState}`].filter(Boolean).join('  |  ')}</span></div>
            <div><h3>Ship To</h3><strong>{shipping?.label || customerName}</strong><span>{shipOne || billingOne || customerAddress || '—'}</span><span>{shipTwo || billingTwo}</span><span>{[printOn('customerGstin') && (invoice?.customerGstin || customer?.gstin) && `GSTIN: ${invoice?.customerGstin || customer?.gstin}`, printOn('placeOfSupply') && invoice?.placeOfSupplyState && `Place of Supply: ${invoice.placeOfSupplyState}`].filter(Boolean).join('  |  ')}</span></div>
          </section>
          <table className="clor-item-table"><thead><tr><th>#</th><th>Description</th>{printOn('hsnSac') ? <th>HSN/SAC</th> : null}<th>Qty</th><th>Unit</th>{printOn('rate') ? <th>Unit Price (₹)</th> : null}<th>Discount (₹)</th><th>Taxable Value (₹)</th>{printOn('gstRate') ? <th>GST</th> : null}<th>Amount (₹)</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.index}><td>{row.index + 1}</td><td>{row.name}{printOn('itemDescription') && row.line?.description && row.line.description !== row.name ? <small>{row.line.description}</small> : null}</td>{printOn('hsnSac') ? <td>{row.hsn || '—'}</td> : null}<td>{row.quantity.toLocaleString('en-IN')}</td><td>{row.line?.unit || row.item?.unit || '—'}</td>{printOn('rate') ? <td>{money(row.rate)}</td> : null}<td>{money(row.line?.discountAmount || 0)}</td><td>{money(row.taxable)}</td>{printOn('gstRate') ? <td>{row.gstRate}%</td> : null}<td>{money(Number(row.line?.lineTotal ?? row.taxable + row.tax))}</td></tr>) : <tr><td colSpan="10">No line items</td></tr>}</tbody></table>
          <section className="clor-after-items">
            <div />
            <dl className="clor-totals">{totalLine('Sub Total', invoice?.subtotal)}{Number(invoice?.cgstTotal || 0) ? totalLine('CGST', invoice.cgstTotal) : null}{Number(invoice?.sgstTotal || 0) ? totalLine('SGST', invoice.sgstTotal) : null}{Number(invoice?.igstTotal || 0) ? totalLine('IGST', invoice.igstTotal) : null}{totalLine('Total Amount', invoice?.total, true)}</dl>
          </section>
          {printOn('amountInWords') && prefOn('amountInWords') ? <div className="clor-amount-words"><b>Amount in Words</b><span>{amountInWordsInr(Number(invoice?.total || 0), company)}</span></div> : null}
          <section className="clor-payment-row"><div>{printOn('paymentDetails') ? <><h3>Bank Details</h3>{paymentBlock()}</> : null}</div></section>
          <section className="clor-terms"><h3>Terms &amp; Conditions</h3><p>{printOn('terms') && prefOn('terms') ? (docSettings?.templates?.invoice?.termsText || '') : ''}</p></section>
          <div className="clor-computer-note"><span />{printSettings.footerText || 'This is a computer generated invoice. Signature is not required.'}<span /></div>
        </article>
      );
    }
    return (
      <article className={`printable detailed-gst-invoice ${templateId === 'standardClor' ? 'standard-clor-invoice' : ''}`} data-invoice-preview aria-label="Detailed GST invoice">
        <header className="detailed-gst-header">
          <div className="detailed-gst-logo">{printOn('companyLogo') && companyLogo('max-h-16 max-w-20') ? companyLogo('max-h-16 max-w-20') : <div><span className="detailed-gst-wordmark">CLOR</span><small className="detailed-gst-tagline">Accounting Made Simple</small></div>}</div>
          <div className="detailed-gst-company">
            <strong>{company?.legalName || company?.name || 'Company'}</strong>
            {templateId === 'standardClor' ? <>
              {printOn('companyAddress') ? <><span>{[company?.address, company?.addressLine1].filter(Boolean).join(', ')}</span><span>{[company?.addressLine2, company?.city, company?.state, company?.pincode, company?.country].filter(Boolean).join(', ')}</span></> : null}
              <span>{[printOn('companyGstin') && company?.gstin && `GSTIN: ${company.gstin}`, printOn('companyPan') && company?.pan && `PAN: ${company.pan}`].filter(Boolean).join('  |  ')}</span>
              {printOn('companyCin') && company?.cin ? <span>CIN: {company.cin}</span> : null}
              <span>{[printOn('companyPhone') && company?.phone, printOn('companyWebsite') && company?.website, printOn('companyEmail') && company?.email].filter(Boolean).join('  |  ')}</span>
            </> : <>
              {printOn('companyAddress') && companyAddress ? <span>{companyAddress}</span> : null}
              <span>{[printOn('companyPhone') && company?.phone, printOn('companyEmail') && company?.email, printOn('companyWebsite') && company?.website].filter(Boolean).join('  |  ')}</span>
              <span>{[printOn('companyGstin') && company?.gstin && `GSTIN: ${company.gstin}`, printOn('companyPan') && company?.pan && `PAN: ${company.pan}`, printOn('companyCin') && company?.cin && `CIN: ${company.cin}`].filter(Boolean).join('  |  ')}</span>
            </>}
            {printOn('companyUdyam') && company?.udyamNumber ? <span>Udyam No.: {company.udyamNumber}</span> : null}
          </div>
          <h2>{printSettings.title || 'INVOICE'}</h2>
        </header>
        <div className="detailed-gst-band">Invoice Details</div>
        <section className="detailed-gst-facts">
          <div>{detail('Invoice No.', invoice?.number)}{detail('Invoice Date', date(invoice?.date))}{printOn('documentReferences') ? <>{detail('Due Date', date(invoice?.dueDate))}{detail('Reference No.', invoice?.refNo)}{detail('Reference Date', date(invoice?.refDate))}</> : null}{printOn('placeOfSupply') ? detail('Place of Supply', invoice?.placeOfSupplyState) : null}{detail('Reverse Charge', invoice?.reverseCharge ? 'Yes' : 'No')}</div>
          <div>{printOn('dispatchDetails') ? <>{detail('Transporter', invoice?.transporterName)}{detail('Vehicle No.', invoice?.vehicleNo)}{detail('LR/GR No. / Date', [invoice?.lrNumber, invoice?.lrDate].filter(Boolean).join(' / '))}</> : null}{printOn('documentReferences') ? referenceLines().filter((row) => !['Ref No.', 'Ref Date', 'Transporter', 'Vehicle no.', 'LR / GR no.'].includes(row.label)).map((row) => detail(row.label, row.value)) : null}</div>
        </section>
        <section className="detailed-gst-parties">
          <div><h3>Billing Details</h3>{detail('Customer Name', customerName)}{printOn('customerAddress') ? detail('Address', customerAddress) : null}{printOn('customerGstin') ? detail('GSTIN', invoice?.customerGstin || customer?.gstin) : null}{printOn('customerPan') ? detail('PAN', invoice?.customerPan || customer?.pan) : null}{printOn('customerState') ? detail('State / Code', [customer?.billingAddress?.state || customer?.state || invoice?.placeOfSupplyState, codeForStateName(customer?.billingAddress?.state || customer?.state || invoice?.placeOfSupplyState)].filter(Boolean).join(' / ')) : null}{printOn('placeOfSupply') ? detail('Place of Supply', invoice?.placeOfSupplyState) : null}</div>
          {printOn('consignee') ? <div><h3>Shipping Details</h3>{detail('Customer Name', shipping?.label || customerName)}{printOn('customerAddress') ? detail('Address', shippingAddress || customerAddress) : null}{printOn('customerGstin') ? detail('GSTIN', invoice?.customerGstin || customer?.gstin) : null}{printOn('customerState') ? detail('State / Code', [shipping?.state || invoice?.placeOfSupplyState, codeForStateName(shipping?.state || invoice?.placeOfSupplyState)].filter(Boolean).join(' / ')) : null}{printOn('placeOfSupply') ? detail('Place of Supply', invoice?.placeOfSupplyState) : null}</div> : null}
        </section>
        <table className="detailed-gst-items"><thead><tr>{printOn('serialNumber') ? <th>S.No.</th> : null}<th>Item Details</th>{printOn('batchDetails') && rows.some((row) => batchNote(row.line)) ? <th>Batch / Dates</th> : null}{printOn('hsnSac') ? <th>HSN/SAC</th> : null}{printOn('quantity') ? <th>Qty</th> : null}{printOn('rate') ? <th>Rate</th> : null}{rows.some((row) => row.line?.mrp) ? <th>MRP</th> : null}{rows.some((row) => row.line?.discountPercent || row.line?.discountRate) ? <th>Discount %</th> : null}{printOn('gstRate') ? <th>GST %</th> : null}{printOn('taxAmount') ? <th>Tax Amount</th> : null}<th>Taxable Value</th></tr></thead>
          <tbody>{rows.length ? rows.map((row) => <tr key={row.index}>{printOn('serialNumber') ? <td>{row.index + 1}</td> : null}<td className="detailed-gst-item-name"><b>{row.name}</b>{printOn('itemDescription') && row.line?.description && row.line.description !== row.name ? <span>{row.line.description}</span> : null}{printOn('partNumber') && (row.line?.partNumber || row.item?.partNumber) ? <span>{row.line?.partNumber || row.item?.partNumber}</span> : null}</td>{printOn('batchDetails') && rows.some((entry) => batchNote(entry.line)) ? <td>{batchNote(row.line)}</td> : null}{printOn('hsnSac') ? <td>{row.hsn || '—'}</td> : null}{printOn('quantity') ? <td>{row.quantity.toLocaleString('en-IN')}{row.line?.unit ? ` ${row.line.unit}` : ''}</td> : null}{printOn('rate') ? <td>{money(row.rate)}</td> : null}{rows.some((entry) => entry.line?.mrp) ? <td>{money(row.line?.mrp)}</td> : null}{rows.some((entry) => entry.line?.discountPercent || entry.line?.discountRate) ? <td>{row.line?.discountPercent ?? row.line?.discountRate ?? 0}</td> : null}{printOn('gstRate') ? <td>{row.gstRate.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td> : null}{printOn('taxAmount') ? <td>{money(row.tax)}</td> : null}<td>{money(row.taxable)}</td></tr>) : <tr><td colSpan="11" className="detailed-gst-empty">No line items</td></tr>}</tbody>
        </table>
        <section className="detailed-gst-summary">
          <div>{printOn('hsnSummary') && groupedTax.length ? <table className="detailed-gst-tax"><thead><tr><th>HSN/SAC</th><th>Taxable Value</th><th>GST Rate</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th></tr></thead><tbody>{groupedTax.map((row) => <tr key={`${row.hsn}-${row.rate}`}><td>{row.hsn}</td><td>{money(row.taxable)}</td><td>{row.rate}%</td><td>{money(row.cgst)}</td><td>{money(row.sgst)}</td><td>{money(row.igst)}</td><td>{money(row.tax)}</td></tr>)}</tbody></table> : null}</div>
          <dl className="detailed-gst-totals">{totals.filter(([label, value]) => label === 'Taxable value' || (printOn('taxSummary') && Number(value) !== 0)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}<div className="detailed-gst-grand"><dt>Grand Total</dt><dd>{formatMoney(Number(invoice?.total || 0), currentCompany)}</dd></div>{Number(invoice?.tdsAmount || 0) > 0 ? <><div><dt>Less: TDS</dt><dd>{money(invoice.tdsAmount)}</dd></div><div><dt>Net payable</dt><dd>{money(Number(invoice.total || 0) - Number(invoice.tdsAmount || 0))}</dd></div></> : null}</dl>
        </section>
        {printOn('amountInWords') && prefOn('amountInWords') ? <div className="detailed-gst-words"><b>Amount in words:</b> {amountInWordsInr(Number(invoice?.total || 0), company)}</div> : null}
        <section className="detailed-gst-bottom"><div>{printOn('paymentDetails') ? <><h3>Bank Details &amp; QR code</h3>{paymentBlock()}</> : null}</div><div>{invoice?.irn ? <><h3>E-Way &amp; E-invoicing details</h3><div className="detailed-gst-irn">IRN: {invoice.irn}</div>{invoice?.irnAckNo ? <div>Ack: {invoice.irnAckNo} {invoice?.irnAckDate || ''}</div> : null}{invoice?.ewbNo ? <div>E-Way Bill: {invoice.ewbNo}</div> : null}{irnQrDataUrl ? <img src={irnQrDataUrl} alt="Signed e-invoice QR" /> : null}</> : null}</div></section>
        <footer className="detailed-gst-footer"><div><h3>Terms and Conditions</h3>{printOn('terms') && prefOn('terms') ? <p>{docSettings?.templates?.invoice?.termsText || ''}</p> : null}{printedCustomFields('terms').map((field) => <p key={field.key}>{field.label}: {field.value}</p>)}</div><div><h3>Declaration</h3>{printOn('declaration') && prefOn('declaration') ? <p>{declaration}</p> : null}{printOn('jurisdiction') && printSettings.jurisdictionText ? <p>{printSettings.jurisdictionText}</p> : null}{printOn('signature') ? <div className="detailed-gst-signature">For {company?.name || 'Company'}<span>Authorised Signatory</span></div> : null}</div></footer>
        {printOn('footerNote') && printSettings.footerText ? <div className="detailed-gst-note">{printSettings.footerText}</div> : null}
      </article>
    );
  }

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
              <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Invoice date</b><span>{date(invoice?.date) || '-'}</span></div>
              {hasTransport && invoice?.vehicleNo ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Vehicle no.</b><span>{invoice.vehicleNo}</span></div> : <div />}
              {hasReference ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Reference</b><span>{[invoice?.refNo, invoice?.refDate].filter(Boolean).join(' · ')}</span></div> : null}
              {hasTransport && (invoice?.lrNumber || invoice?.lrDate) ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>LR / GR</b><span>{[invoice?.lrNumber, invoice?.lrDate].filter(Boolean).join(' · ')}</span></div> : null}
              {printOn('documentReferences') ? <div className="grid grid-cols-[8rem_1fr] gap-2"><b>Due date</b><span>{date(invoice?.dueDate) || '—'}</span></div> : null}
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
              {printOn('amountInWords') ? <div className="border-t pt-2 mt-2 text-[10px] text-gray-600">{amountInWordsInr(Number(invoice?.total || 0), company)}</div> : null}
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
                <div className="text-xs text-gray-600">Date: {date(invoice?.date) || '-'}</div>
                {invoice?.dueDate ? <div className="text-xs text-gray-600">Due: {date(invoice.dueDate)}</div> : null}
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
              <div className="text-xs text-gray-700">{amountInWordsInr(Number(invoice?.total ?? 0), company)}</div>
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
                <div className="text-xs text-gray-600">Date: {date(invoice?.date) || '-'}</div>
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
              <div className="text-xs mt-4">{amountInWordsInr(Number(invoice?.total ?? 0), company)}</div>
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
                <div className="text-xs opacity-95">Date: {date(invoice?.date) || '-'}</div>
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
              <div className="text-xs text-gray-700">{amountInWordsInr(Number(invoice?.total ?? 0), company)}</div>
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
                <div>{date(invoice?.date) || '-'}</div>
                {!isClean && (
                  <>
                    <div className="font-semibold">Challan Date</div>
                    <div>{invoice?.refDate || '—'}</div>
                  </>
                )}
                <div className="font-semibold">Due Date</div>
                <div>{date(invoice?.dueDate) || '—'}</div>
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
                  <div className="text-[10px] text-gray-700">{amountInWordsInr(Number(invoice?.total ?? 0), company)}</div>
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
