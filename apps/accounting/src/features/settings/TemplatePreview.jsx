

export const TemplatePreview = ({ companyName, voucherLabel, templateId, accentBarClass }) => {
  const title = `${voucherLabel} Preview`;
  const header = (
    <div className="border rounded-lg overflow-hidden">
      <div className={`h-2 ${accentBarClass}`} />
      <div className="p-4 flex items-start justify-between">
        <div>
          <div className="ui-t-sec ui-fg">{companyName}</div>
          <div className="text-xs ui-muted">Document Template Preview</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">{voucherLabel}</div>
          <div className="text-xs ui-muted">No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
          <div className="text-xs ui-muted">Date: {new Date().toISOString().slice(0, 10)}</div>
        </div>
      </div>
    </div>
  );

  const rows = (
    <div className="border rounded-lg overflow-hidden">
      <table className="ui-table w-full">
        <thead className="ui-sunken border-b">
          <tr>
            <th className="ui-th">Item</th>
            <th className="ui-th ui-num">Qty</th>
            <th className="ui-th ui-num">Rate</th>
            <th className="ui-th ui-num">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          <tr>
            <td className="px-3 py-2">Sample Item A</td>
            <td className="ui-col-meta px-3 py-2 text-right">1</td>
            <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
            <td className="ui-col-meta px-3 py-2 text-right font-medium">₹1,000</td>
          </tr>
          <tr>
            <td className="ui-col-meta px-3 py-2">Sample Item B</td>
            <td className="ui-col-meta px-3 py-2 text-right">2</td>
            <td className="ui-col-meta px-3 py-2 text-right">₹500</td>
            <td className="ui-col-meta px-3 py-2 text-right font-medium">₹1,000</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const totals = (
    <div className="border rounded-lg p-4 text-sm">
      <div className="flex justify-between">
        <span className="ui-muted">Subtotal</span>
        <span className="font-medium">₹2,000</span>
      </div>
      <div className="flex justify-between">
        <span className="ui-muted">GST</span>
        <span className="font-medium">₹360</span>
      </div>
      <div className="flex justify-between border-t mt-2 pt-2 font-bold">
        <span>Total</span>
        <span>₹2,360</span>
      </div>
    </div>
  );

  if (templateId === 'modern') {
    return (
      <div className="space-y-3">
        <div className="flex items-stretch gap-3">
          <div className={`w-2 rounded-lg ${accentBarClass}`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs ui-muted">{title}</div>
            <div className="ui-title text-xl ui-fg">{voucherLabel}</div>
            <div className="text-sm ui-muted">{companyName}</div>
          </div>
          <div className="text-right text-sm ui-muted">
            <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
            <div>Date: {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'minimal') {
    return (
      <div className="space-y-3">
        <div className="border rounded-lg p-4">
          <div className="flex justify-between">
            <div>
              <div className="text-xs ui-muted">{companyName}</div>
              <div className="ui-t-sec">{voucherLabel}</div>
            </div>
            <div className="text-right text-xs ui-muted">
              <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
              <div>Date: {new Date().toISOString().slice(0, 10)}</div>
            </div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'compact') {
    return (
      <div className="space-y-2">
        <div className="border rounded-lg overflow-hidden">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-3 flex items-start justify-between">
            <div>
              <div className="text-sm font-medium ui-fg">{companyName}</div>
              <div className="text-xs ui-muted">{title}</div>
            </div>
            <div className="text-right text-xs ui-muted">
              <div className="font-medium ui-fg">{voucherLabel}</div>
              <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
              <div>Date: {new Date().toISOString().slice(0, 10)}</div>
            </div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'bold') {
    return (
      <div className="space-y-3">
        <div className={`rounded-lg p-4 text-white ${accentBarClass}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="ui-t-sec">{companyName}</div>
              <div className="text-xs opacity-90">{title}</div>
            </div>
            <div className="text-right text-xs opacity-95">
              <div className="text-sm font-medium">{voucherLabel}</div>
              <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
              <div>Date: {new Date().toISOString().slice(0, 10)}</div>
            </div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'a5') {
    return (
      <div className="max-w-[620px] mx-auto text-[11px] leading-4 ui-fg">
        <div className="border border-gray-900">
          <div className="p-3 border-b border-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-medium">{companyName}</div>
                <div className="text-[10px] ui-fg">(Sample address line 1, city, state - pincode)</div>
                <div className="text-[10px] ui-fg">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">ORIGINAL FOR RECIPIENT</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3">
            <div className="p-3 border-r border-gray-900">
              <div className="font-semibold">M/S</div>
              <div className="font-semibold">Customer Name</div>
              <div className="text-[10px] ui-fg">Address line…</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-[10px] ui-fg">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-3 border-r border-gray-900">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Challan No</div>
                <div>—</div>
                <div className="font-semibold">E-Way Bill No.</div>
                <div>—</div>
                <div className="font-semibold">Transport</div>
                <div>—</div>
              </div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice Date</div>
                <div>{new Date().toISOString().slice(0, 10)}</div>
                <div className="font-semibold">Challan Date</div>
                <div>—</div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-900">
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-900">
                  <th className="p-1 border-r border-gray-900">Sr</th>
                  <th className="p-1 border-r border-gray-900">Name of Product / Service</th>
                  <th className="p-1 border-r border-gray-900">HSN/SAC</th>
                  <th className="p-1 border-r border-gray-900">Qty</th>
                  <th className="p-1 border-r border-gray-900">Rate</th>
                  <th className="p-1 border-r border-gray-900">Taxable</th>
                  <th className="p-1 border-r border-gray-900">GST %</th>
                  <th className="p-1 border-r border-gray-900">GST Amt</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">8302</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹180</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-3 border-t border-gray-900">
            <div className="p-3 col-span-2 border-r border-gray-900">
              <div className="font-semibold">Terms and Conditions</div>
              <div className="text-[10px] ui-fg">This is a sample A5 template preview.</div>
              <div className="mt-8 font-semibold">Customer Signature</div>
            </div>
            <div className="p-3">
              <div className="flex justify-between font-semibold">
                <span>Taxable Amount</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Total Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t border-gray-900 mt-2 pt-2">
                <span>Total Amount</span>
                <span>₹2,360</span>
              </div>
              <div className="mt-6 text-[10px] ui-fg">This is a computer generated invoice.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a5Compact') {
    return (
      <div className="max-w-[620px] mx-auto text-[10px] leading-4 ui-fg">
        <div className="border border-gray-900">
          <div className="p-2 border-b border-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{companyName}</div>
                <div className="text-[10px] ui-fg">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-base font-extrabold">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">A5 Compact</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2">
            <div className="p-2 border-r border-gray-900">
              <div className="font-semibold">M/S Customer Name</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-[10px] ui-fg">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-2">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Invoice Date</div>
                <div>{new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-900">
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-900">
                  <th className="p-1 border-r border-gray-900">Sr</th>
                  <th className="p-1 border-r border-gray-900">Item</th>
                  <th className="p-1 border-r border-gray-900">Qty</th>
                  <th className="p-1 border-r border-gray-900">Taxable</th>
                  <th className="p-1 border-r border-gray-900">GST%</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 border-t border-gray-900">
            <div className="p-2 border-r border-gray-900">
              <div className="font-semibold">Terms</div>
              <div className="text-[10px] ui-fg">Computer generated invoice.</div>
            </div>
            <div className="p-2">
              <div className="flex justify-between font-semibold">
                <span>Taxable</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t border-gray-900 mt-1 pt-1">
                <span>Total</span>
                <span>₹2,360</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a5Clean') {
    return (
      <div className="max-w-[620px] mx-auto text-[11px] leading-4 ui-fg">
        <div className="border border-gray-900">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-3 border-b border-gray-900">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-medium">{companyName}</div>
                <div className="text-[10px] ui-fg">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">A5 Clean</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3">
            <div className="p-3 border-r border-gray-900">
              <div className="font-semibold">M/S</div>
              <div className="font-semibold">Customer Name</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
            </div>
            <div className="p-3 border-r border-gray-900">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Invoice Date</div>
                <div>{new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Place of Supply</div>
                <div>Kerala (32)</div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-900">
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-900">
                  <th className="p-1 border-r border-gray-900">Sr</th>
                  <th className="p-1 border-r border-gray-900">Name</th>
                  <th className="p-1 border-r border-gray-900">HSN</th>
                  <th className="p-1 border-r border-gray-900">Qty</th>
                  <th className="p-1 border-r border-gray-900">Taxable</th>
                  <th className="p-1 border-r border-gray-900">GST%</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">8302</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-3 border-t border-gray-900">
            <div className="p-3 col-span-2 border-r border-gray-900">
              <div className="font-semibold">Customer Signature</div>
              <div className="mt-10" />
            </div>
            <div className="p-3">
              <div className="flex justify-between font-semibold">
                <span>Taxable</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t border-gray-900 mt-2 pt-2">
                <span>Total</span>
                <span>₹2,360</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a5Boxed') {
    return (
      <div className="max-w-[620px] mx-auto text-[11px] leading-4 ui-fg">
        <div className="border-2 border-gray-900">
          <div className="p-3 border-b-2 border-gray-900">
            <div className="flex items-center justify-between">
              <div className="text-base font-medium">{companyName}</div>
              <div className="text-center">
                <div className="text-lg font-extrabold">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">A5 Boxed</div>
              </div>
              <div className="text-right text-[10px]">
                <div className="font-semibold">GSTIN: 27ABCDE1234F1Z5</div>
                <div>Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b-2 border-gray-900">
            <div className="p-3 border-r-2 border-gray-900">
              <div className="font-semibold">Bill To</div>
              <div className="font-semibold">Customer Name</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-[10px] ui-fg">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Challan No.</div>
                <div>—</div>
              </div>
            </div>
          </div>

          <div>
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-900">
                  <th className="p-1 border-r-2 border-gray-900">Sr</th>
                  <th className="p-1 border-r-2 border-gray-900">Product / Service</th>
                  <th className="p-1 border-r-2 border-gray-900">HSN</th>
                  <th className="p-1 border-r-2 border-gray-900">Qty</th>
                  <th className="p-1 border-r-2 border-gray-900">Taxable</th>
                  <th className="p-1 border-r-2 border-gray-900">GST%</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">8302</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-3 border-t-2 border-gray-900">
            <div className="p-3 col-span-2 border-r-2 border-gray-900">
              <div className="font-semibold">Terms</div>
              <div className="text-[10px] ui-fg">Subject to jurisdiction.</div>
              <div className="mt-8 font-semibold">Customer Signature</div>
            </div>
            <div className="p-3">
              <div className="flex justify-between font-semibold">
                <span>Taxable</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t-2 border-gray-900 mt-2 pt-2">
                <span>Total</span>
                <span>₹2,360</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4Modern') {
    return (
      <div className="max-w-[980px] mx-auto text-sm ui-fg">
        <div className="border rounded-lg overflow-hidden">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-2xl font-extrabold">{companyName}</div>
                <div className="text-xs ui-muted">(Sample address line 1, city, state - pincode)</div>
                <div className="text-xs ui-muted">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-xs font-semibold ui-fg">A4 Modern</div>
                <div className="mt-2 text-xs ui-muted">Invoice No: GST-0001</div>
                <div className="text-xs ui-muted">Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Bill To</div>
                <div className="mt-1 font-semibold">Customer Name</div>
                <div className="text-xs ui-muted">GSTIN: 29ABCDE1234F1Z5</div>
                <div className="text-xs ui-muted">Place of Supply: Kerala (32)</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Summary</div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="ui-muted">Taxable</span>
                  <span className="font-semibold">₹2,000</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="ui-muted">GST</span>
                  <span className="font-semibold">₹360</span>
                </div>
                <div className="flex justify-between text-sm border-t mt-2 pt-2">
                  <span className="font-bold">Total</span>
                  <span className="font-bold">₹2,360</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden mt-6">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b">
                  <tr>
                    <th className="ui-th">Sr</th>
                    <th className="ui-th">Product / Service</th>
                    <th className="ui-th">HSN/SAC</th>
                    <th className="ui-th ui-num">Qty</th>
                    <th className="ui-th ui-num">Rate</th>
                    <th className="ui-th ui-num">Taxable</th>
                    <th className="ui-th ui-num">GST%</th>
                    <th className="ui-th ui-num">GST Amt</th>
                    <th className="ui-th ui-num">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="ui-col-meta px-3 py-2">1</td>
                    <td className="ui-col-meta px-3 py-2">Sample Item A</td>
                    <td className="ui-col-meta px-3 py-2">8302</td>
                    <td className="ui-col-meta px-3 py-2 text-right">1</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
                    <td className="ui-col-meta px-3 py-2 text-right">18</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹180</td>
                    <td className="ui-col-meta px-3 py-2 text-right font-semibold">₹1,180</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Terms</div>
                <div className="text-xs ui-muted mt-2">This is a computer generated invoice. Signature not required.</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">For {companyName}</div>
                <div className="mt-10 text-xs ui-muted">(Authorized Signatory)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4BoxedGst') {
    return (
      <div className="max-w-[980px] mx-auto text-sm ui-fg">
        <div className="border-2 border-gray-900 ui-surface">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-6 border-b-2 border-gray-900">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-2xl font-extrabold">{companyName}</div>
                <div className="text-xs ui-muted">(Sample address line 1, city, state - pincode)</div>
                <div className="text-xs ui-muted">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-xs font-semibold ui-fg">A4 Boxed GST Split</div>
                <div className="mt-2 text-xs ui-muted">Invoice No: GST-0001</div>
                <div className="text-xs ui-muted">Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b-2 border-gray-900">
            <div className="p-4 border-r-2 border-gray-900">
              <div className="text-xs font-semibold uppercase">Bill To</div>
              <div className="font-semibold mt-1">Customer Name</div>
              <div className="text-xs ui-muted">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-xs ui-muted">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold uppercase">Totals</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="ui-muted">Taxable</div>
                <div className="text-right font-semibold">₹2,000</div>
                <div className="ui-muted">CGST</div>
                <div className="text-right font-semibold">₹180</div>
                <div className="ui-muted">SGST</div>
                <div className="text-right font-semibold">₹180</div>
                <div className="ui-muted">Total</div>
                <div className="text-right font-bold">₹2,360</div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="border-2 border-gray-900 overflow-hidden">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b-2 border-gray-900">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900">Sr</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900">Item</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900">HSN</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">Qty</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">Rate</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">Taxable</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">GST%</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">CGST</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">SGST</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="ui-col-meta px-2 py-2 border-r-2 border-gray-900">1</td>
                    <td className="ui-col-meta px-2 py-2 border-r-2 border-gray-900">Sample Item A</td>
                    <td className="ui-col-meta px-2 py-2 border-r-2 border-gray-900">8302</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">1</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹1,000</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹1,000</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">18</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹90</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹90</td>
                    <td className="ui-col-meta px-2 py-2 text-right font-semibold">₹1,180</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border-2 border-gray-900 p-4">
                <div className="text-xs font-semibold uppercase">Terms</div>
                <div className="text-xs ui-muted mt-2">Subject to jurisdiction.</div>
              </div>
              <div className="border-2 border-gray-900 p-4">
                <div className="text-xs font-semibold uppercase">For {companyName}</div>
                <div className="mt-10 text-xs ui-muted">(Authorized Signatory)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4Letterhead') {
    return (
      <div className="max-w-[980px] mx-auto text-sm ui-fg">
        <div className="ui-surface border rounded-lg overflow-hidden">
          <div className={`p-6 ${accentBarClass} text-white`}>
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-2xl font-extrabold">{companyName}</div>
                <div className="text-xs opacity-95">(Sample address line 1, city, state - pincode)</div>
                <div className="text-xs opacity-95">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-xs font-semibold opacity-95">A4 Letterhead</div>
                <div className="mt-2 text-xs opacity-95">Invoice No: GST-0001</div>
                <div className="text-xs opacity-95">Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Bill To</div>
                <div className="mt-1 font-semibold">Customer Name</div>
                <div className="text-xs ui-muted">GSTIN: 29ABCDE1234F1Z5</div>
                <div className="text-xs ui-muted">Place of Supply: Kerala (32)</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Summary</div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="ui-muted">Taxable</span>
                  <span className="font-semibold">₹2,000</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="ui-muted">GST</span>
                  <span className="font-semibold">₹360</span>
                </div>
                <div className="flex justify-between text-sm border-t mt-2 pt-2">
                  <span className="font-bold">Total</span>
                  <span className="font-bold">₹2,360</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b">
                  <tr>
                    <th className="ui-th">Sr</th>
                    <th className="ui-th">Product / Service</th>
                    <th className="ui-th ui-num">Qty</th>
                    <th className="ui-th ui-num">Taxable</th>
                    <th className="ui-th ui-num">GST%</th>
                    <th className="ui-th ui-num">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="ui-col-meta px-3 py-2">1</td>
                    <td className="ui-col-meta px-3 py-2">Sample Item A</td>
                    <td className="ui-col-meta px-3 py-2 text-right">1</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
                    <td className="ui-col-meta px-3 py-2 text-right">18</td>
                    <td className="ui-col-meta px-3 py-2 text-right font-semibold">₹1,180</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Notes</div>
                <div className="text-xs ui-muted mt-2">This is a computer generated invoice. Signature not required.</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">For {companyName}</div>
                <div className="mt-10 text-xs ui-muted">(Authorized Signatory)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      {rows}
      {totals}
    </div>
  );
};
