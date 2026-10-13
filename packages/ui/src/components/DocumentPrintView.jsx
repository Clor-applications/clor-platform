import React, { useMemo } from 'react';

import { ACCENT_OPTIONS, getDocSettings } from '../utils/docSettings';
import { amountInWordsInr, formatMoney } from '../utils/money';

/**
 * A business document, on paper.
 *
 * Only the invoice and the bill could be printed. Everything else — the sales
 * order the customer confirms, the challan that rides with the lorry, the
 * estimate that has to reach the customer to be worth anything — existed on
 * screen and nowhere else. This is the paper the rest of them share.
 *
 * Deliberately not the invoice's template engine. An invoice picks between five
 * designs and carries an IRN, a signed QR and payment instructions, because it
 * is the document the money moves against. The others carry the same head, the
 * same party block, the same lines and the same total, and want one honest
 * layout rather than five.
 *
 * Black on white on purpose — a printed document does not follow the app theme.
 * See DESIGN.md, which exempts exactly this.
 *
 * @param docTitle   what the paper calls itself, e.g. "SALES ORDER"
 * @param doc        the document: number, date, items, subtotal, gstTotal, total
 * @param party      the customer or vendor master, for the address block
 * @param partyLabel "Bill To" on a sale, "Vendor" on a purchase
 * @param metaRows   [{label, value}] beside the number — dates, references
 * @param sideRows   [{label, value}] in the second party column, e.g. Ship To
 * @param footNote   the terms line under the signature
 */
const addressOf = (party) => {
  const a = party?.billingAddress || party?.address || {};
  return [a.line1, a.line2, a.city, a.state, a.pincode].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
};

const companyAddressOf = (company) =>
  [company?.address, company?.city, company?.state, company?.pincode]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(', ');

export const DocumentPrintView = ({
  db,
  currentCompany,
  docTitle,
  doc,
  party = null,
  partyLabel = 'Bill To',
  metaRows = [],
  sideRows = [],
  footNote = '',
  templateKey = '',
}) => {
  const docSettings = useMemo(() => getDocSettings(db, currentCompany), [db, currentCompany]);
  const inferredTemplateKey = ({
    'QUOTATION': 'estimate',
    'CREDIT NOTE': 'creditNote',
    'DEBIT NOTE': 'debitNote',
    'PURCHASE ORDER': 'purchaseOrder',
    'SALES ORDER': 'salesOrder',
    'DELIVERY CHALLAN': 'deliveryChallan',
    'PURCHASE BILL': 'bill',
  })[String(docTitle || '').toUpperCase()] || 'invoice';
  const selectedTemplateKey = templateKey || inferredTemplateKey;
  const templateConfig = docSettings?.templates?.[selectedTemplateKey] || docSettings?.templates?.invoice || {};
  const accentId = String(templateConfig.accentId || 'blue');
  const templateId = String(templateConfig.templateId || 'classic');
  const accent = ACCENT_OPTIONS.find((a) => a.id === accentId) || ACCENT_OPTIONS[0];
  const optionOn = (key) => templateConfig?.printOptions?.[key] !== false;

  const company = currentCompany || {};
  const lines = Array.isArray(doc?.items) ? doc.items : [];

  /*
   * Which columns the document actually needs.
   *
   * A challan carries no tax and a fixed nine-column grid would print it five
   * empty columns wide; an order with no discount on any line has nothing to
   * say in a discount column. Each column earns its place from the lines.
   */
  const showHsn = optionOn('hsnSac') && lines.some((l) => String(l?.hsnSac || '').trim());
  const showDiscount = lines.some((l) => Number(l?.discountPct) > 0 || Number(l?.discountAmount) > 0);
  const showTax = optionOn('gstRate') && (Number(doc?.gstTotal || 0) > 0 || lines.some((l) => Number(l?.gstRate) > 0));
  const cgst = Number(doc?.cgstTotal || 0);
  const sgst = Number(doc?.sgstTotal || 0);
  const igst = Number(doc?.igstTotal || 0);
  const money = (v) => formatMoney(Number(v || 0), currentCompany);

  const partyAddress = addressOf(party);
  const companyAddress = companyAddressOf(company);
  const rows = metaRows.filter((r) => String(r?.value ?? '').trim());
  const side = sideRows.filter((r) => String(r?.value ?? '').trim());

  return (
    <div className={`printable document-print-template document-print-template-${templateId} max-w-[980px] mx-auto text-sm text-gray-900`} data-template-key={selectedTemplateKey} data-accent={accentId}>
      <div className="border-2 border-gray-900 bg-white">
        <div className={`h-2 ${accent.barClass}`} />

        <div className="p-6 border-b-2 border-gray-900">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-2xl font-extrabold">{company?.name || 'Company'}</div>
              {optionOn('companyAddress') && companyAddress ? <div className="text-xs text-gray-600">{companyAddress}</div> : null}
              {optionOn('companyGstin') && company?.gstin ? <div className="text-xs text-gray-600">GSTIN: {company.gstin}</div> : null}
              {optionOn('companyPhone') && company?.phone ? <div className="text-xs text-gray-600">Phone: {company.phone}</div> : null}
            </div>
            <div className="text-right">
              <div className="text-3xl font-extrabold tracking-wide">{docTitle}</div>
              <div className="mt-2 text-xs text-gray-600">No: {doc?.number || '-'}</div>
              <div className="text-xs text-gray-600">Date: {doc?.date || '-'}</div>
              {rows.map((r) => (
                <div key={r.label} className="text-xs text-gray-600">
                  {r.label}: {r.value}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b-2 border-gray-900">
          <div className="p-4 border-r-2 border-gray-900">
            <div className="text-xs font-semibold uppercase">{partyLabel}</div>
            <div className="font-semibold mt-1">
              {doc?.customerName || doc?.vendorName || doc?.partyName || party?.displayName || party?.name || '-'}
            </div>
            {optionOn('customerAddress') && optionOn('vendorAddress') && partyAddress ? <div className="text-xs text-gray-600">{partyAddress}</div> : null}
            {optionOn('customerGstin') && optionOn('vendorGstin') && party?.gstin ? <div className="text-xs text-gray-600">GSTIN: {party.gstin}</div> : null}
            {party?.phone ? <div className="text-xs text-gray-600">Phone: {party.phone}</div> : null}
          </div>
          <div className="p-4">
            {side.length ? (
              <>
                <div className="text-xs font-semibold uppercase">Details</div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {side.map((r) => (
                    <React.Fragment key={r.label}>
                      <div className="text-gray-600">{r.label}</div>
                      <div className="font-medium text-right">{r.value}</div>
                    </React.Fragment>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b-2 border-gray-900">
              {optionOn('serialNumber') ? <th className="px-3 py-2 text-left w-8">#</th> : null}
              <th className="px-3 py-2 text-left">Description</th>
              {showHsn ? <th className="px-3 py-2 text-left w-20">HSN/SAC</th> : null}
              {optionOn('quantity') ? <th className="px-3 py-2 text-right w-16">Qty</th> : null}
              {optionOn('rate') ? <th className="px-3 py-2 text-right w-24">Rate</th> : null}
              {showDiscount ? <th className="px-3 py-2 text-right w-16">Disc</th> : null}
              {showTax ? <th className="px-3 py-2 text-right w-16">Tax %</th> : null}
              <th className="px-3 py-2 text-right w-28">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-center text-gray-500" colSpan={8}>
                  No items on this document.
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={idx} className="border-b border-gray-300">
                  {optionOn('serialNumber') ? <td className="px-3 py-2 align-top">{idx + 1}</td> : null}
                  <td className="px-3 py-2 align-top">{l?.description || l?.name || '-'}</td>
                  {showHsn ? <td className="px-3 py-2 align-top">{l?.hsnSac || ''}</td> : null}
                  {optionOn('quantity') ? <td className="px-3 py-2 text-right align-top tabular-nums">{Number(l?.quantity || 0)}</td> : null}
                  {optionOn('rate') ? <td className="px-3 py-2 text-right align-top tabular-nums">{money(l?.rate)}</td> : null}
                  {showDiscount ? (
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {Number(l?.discountPct) > 0 ? `${Number(l.discountPct)}%` : Number(l?.discountAmount) > 0 ? money(l.discountAmount) : ''}
                    </td>
                  ) : null}
                  {showTax ? (
                    <td className="px-3 py-2 text-right align-top tabular-nums">{Number(l?.gstRate || 0)}%</td>
                  ) : null}
                  <td className="px-3 py-2 text-right align-top tabular-nums">
                    {money(l?.taxableAmount ?? l?.amount ?? Number(l?.quantity || 0) * Number(l?.rate || 0))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="grid grid-cols-2 border-t-2 border-gray-900">
          <div className="p-4 border-r-2 border-gray-900 text-xs">
            {optionOn('amountInWords') ? <><div className="font-semibold uppercase text-gray-700">Amount in words</div><div className="mt-1">{amountInWordsInr(Number(doc?.total ?? 0))}</div></> : null}
            {doc?.notes ? (
              <>
                <div className="mt-3 font-semibold uppercase text-gray-700">Notes</div>
                <div className="mt-1 whitespace-pre-wrap">{doc.notes}</div>
              </>
            ) : null}
          </div>
          <div className="p-4">
            <div className="flex justify-between py-0.5">
              <span>Taxable value</span>
              <span className="tabular-nums">{money(doc?.subtotal)}</span>
            </div>
            {cgst > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>CGST</span>
                <span className="tabular-nums">{money(cgst)}</span>
              </div>
            ) : null}
            {sgst > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>SGST</span>
                <span className="tabular-nums">{money(sgst)}</span>
              </div>
            ) : null}
            {igst > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>IGST</span>
                <span className="tabular-nums">{money(igst)}</span>
              </div>
            ) : null}
            {!cgst && !sgst && !igst && Number(doc?.gstTotal || 0) > 0 ? (
              <div className="flex justify-between py-0.5">
                <span>GST</span>
                <span className="tabular-nums">{money(doc?.gstTotal)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t-2 border-gray-900 mt-2 pt-2 text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{money(doc?.total)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t-2 border-gray-900 text-xs">
          <div className="p-4 border-r-2 border-gray-900 text-gray-600">
            {optionOn('terms') ? footNote || templateConfig.termsText || 'Subject to the terms agreed between the parties.' : null}
          </div>
          {optionOn('signature') ? <div className="p-4 text-right">
            <div className="text-gray-600">For {company?.name || 'Company'}</div>
            <div className="h-12" />
            <div className="text-gray-600">Authorised Signatory</div>
          </div> : <div />}
        </div>
      </div>
    </div>
  );
};

export default DocumentPrintView;
