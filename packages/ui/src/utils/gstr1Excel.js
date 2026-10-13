import { notify } from '@ui/components/ui/notify';

const n = (value) => Number(value) || 0;
const text = (value) => String(value ?? '').trim();
const active = (row) => !/draft|cancel/i.test(text(row?.status));
const gstinOf = (row) => text(row?.customerGstin || row?.partyGstin || row?.gstin);
const isExport = (row) => /export/i.test(text(row?.supplyType || row?.taxTreatment || row?.placeOfSupplyType));
const isNil = (row) => n(row?.gstTotal) === 0;
const isInterstate = (row) => n(row?.igstTotal) > 0 || text(row?.taxType).toUpperCase() === 'IGST';
const values = (row, sign = 1) => ({
  taxable: sign * n(row?.subtotal ?? row?.taxableTotal),
  igst: sign * n(row?.igstTotal),
  cgst: sign * n(row?.cgstTotal),
  sgst: sign * n(row?.sgstTotal),
  cess: sign * n(row?.cessTotal),
  tax: sign * n(row?.gstTotal),
  total: sign * n(row?.total),
});

const invoiceDetail = (row, sign = 1) => ({
  party: row.customerName || row.partyName || row.vendorName || '',
  gstin: gstinOf(row),
  number: row.number || row.invoiceNumber || row.voucherNumber || '',
  date: row.date || row.invoiceDate || '',
  type: row.sourceDocType || (sign < 0 ? 'Credit Note' : 'Invoice'),
  supplyType: row.supplyType || row.taxTreatment || '',
  place: row.placeOfSupplyState || row.placeOfSupply || '',
  reverseCharge: row.reverseCharge ? 'Yes' : 'No',
  ...values(row, sign),
});

const sum = (rows, key) => rows.reduce((total, row) => total + n(row[key]), 0);
const companyAddress = (company) => {
  const settings = company?.profile?.companySettings || {};
  return [
    company?.address || settings.regAddress1,
    settings.regAddress2,
    company?.city || settings.regCity,
    company?.state || settings.regStateName,
    company?.pincode || settings.regPincode,
    company?.country || settings.regCountry,
  ].map(text).filter(Boolean).join(', ');
};

const detailColumns = [
  ['party', 'Party Name'], ['gstin', 'GSTIN'], ['number', 'Invoice / Note No.'], ['date', 'Invoice / Note Date'],
  ['type', 'Document Type'], ['supplyType', 'Supply Type'], ['place', 'Place of Supply'], ['reverseCharge', 'Reverse Charge'],
  ['total', 'Invoice Value', 'money'], ['taxable', 'Taxable Value', 'money'], ['cgst', 'CGST', 'money'],
  ['sgst', 'SGST / UTGST', 'money'], ['igst', 'IGST', 'money'], ['cess', 'Cess', 'money'], ['tax', 'Total Tax', 'money'],
];

export function buildGstr1ExcelModel({ db, company, gstin, periodLabel }) {
  const allInvoices = db.invoices || [];
  const allCreditNotes = db.creditNotes || [];
  const invoices = allInvoices.filter(active);
  const creditNotes = allCreditNotes.filter(active);
  const receipts = (db.payments || []).filter((row) => active(row) && /receipt/i.test(text(row?.voucherType || row?.direction || row?.type)));
  const journals = (db.journalEntries || []).filter((row) => active(row));
  const b2clDocs = invoices.filter((row) => !gstinOf(row) && !isNil(row) && !isExport(row) && isInterstate(row) && n(row.total) > 250000);
  const b2clIds = new Set(b2clDocs.map((row) => row.id || row.number));

  const detail = (docs, sign = 1) => docs.map((row) => invoiceDetail(row, sign));
  const sections = [
    { key: 'b2b', sheet: '4A 4B 6B 6C B2B', code: '4A, 4B, 6B, 6C', label: 'B2B, SEZ and Deemed Export Invoices', columns: detailColumns, rows: detail(invoices.filter((row) => gstinOf(row) && !isExport(row) && !isNil(row))) },
    { key: 'b2cl', sheet: '5 B2C Large', code: '5', label: 'B2C (Large) Invoices', columns: detailColumns, rows: detail(b2clDocs) },
    { key: 'exports', sheet: '6A Exports', code: '6A', label: 'Exports Invoices', columns: detailColumns, rows: detail(invoices.filter(isExport)) },
    { key: 'b2cs', sheet: '7 B2C Others', code: '7', label: 'B2C (Others)', columns: detailColumns, rows: detail(invoices.filter((row) => !gstinOf(row) && !isNil(row) && !isExport(row) && !b2clIds.has(row.id || row.number))) },
    { key: 'nil', sheet: '8 Nil Exempt Non-GST', code: '8A, 8B, 8C, 8D', label: 'Nil Rated, Exempt and Non-GST Supplies', columns: detailColumns, rows: detail(invoices.filter(isNil)) },
    { key: 'cdnr', sheet: '9B CDN Registered', code: '9B', label: 'Credit / Debit Notes (Registered)', columns: detailColumns, rows: detail(creditNotes.filter((row) => gstinOf(row)), -1) },
    { key: 'cdnur', sheet: '9B CDN Unregistered', code: '9B', label: 'Credit / Debit Notes (Unregistered)', columns: detailColumns, rows: detail(creditNotes.filter((row) => !gstinOf(row)), -1) },
    {
      key: 'advance', sheet: '11A Advances', code: '11A(1), 11A(2)', label: 'Tax Liability on Advances Received',
      columns: [['date','Date'],['number','Voucher No.'],['party','Party Name'],['gstin','GSTIN'],['place','Place of Supply'],['taxable','Advance Value','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST / UTGST','money'],['tax','Total Tax','money']],
      rows: receipts.filter((row) => n(row.advanceAmount) > 0).map((row) => ({ date: row.date || '', number: row.number || row.receiptNo || '', party: row.customerName || row.partyName || '', gstin: gstinOf(row), place: row.placeOfSupplyState || '', taxable: n(row.advanceAmount), igst: n(row.igstTotal), cgst: n(row.cgstTotal), sgst: n(row.sgstTotal), tax: n(row.gstTotal) })),
    },
    {
      key: 'adjustments', sheet: '11B Adjustments', code: '11B(1), 11B(2)', label: 'Adjustment of Advances / Journal Corrections',
      columns: [['date','Date'],['number','Voucher No.'],['party','Party Name'],['narration','Narration'],['taxable','Adjustment Value','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST / UTGST','money'],['tax','Total Tax','money']],
      rows: journals.filter((entry) => (entry.lines || []).some((line) => /output\s*(igst|cgst|sgst|gst)|gst\s*output/i.test(text(line.ledgerName || line.accountName || line.description)))).map((entry) => {
        const output = (entry.lines || []).filter((line) => /output\s*(igst|cgst|sgst|gst)|gst\s*output/i.test(text(line.ledgerName || line.accountName || line.description)));
        const ledgerTax = (pattern) => output.filter((line) => pattern.test(text(line.ledgerName || line.accountName))).reduce((total, line) => total + n(line.credit) - n(line.debit), 0);
        return { date: entry.date || '', number: entry.number || entry.entryNo || '', party: entry.partyName || '', narration: entry.narration || '', taxable: n(entry.taxableAmount), igst: ledgerTax(/igst/i), cgst: ledgerTax(/cgst/i), sgst: ledgerTax(/sgst|utgst/i), tax: output.reduce((total, line) => total + n(line.credit) - n(line.debit), 0) };
      }),
    },
  ];

  const itemById = new Map((db.items || []).map((item) => [text(item.id), item]));
  const hsn = new Map();
  for (const [docs, sign] of [[invoices, 1], [creditNotes, -1]]) for (const doc of docs) for (const line of (doc.items || [])) {
    const item = itemById.get(text(line.itemId)) || {};
    const code = text(line.hsnSac || line.hsn || item.hsnSac || item.hsn) || 'Unclassified';
    const rate = n(line.gstRate ?? item.gstRate);
    const uqc = text(line.unit || item.unit) || 'NOS';
    const key = `${code}|${rate}|${uqc}`;
    const quantity = n(line.quantity || line.qty);
    const taxable = n(line.taxableAmount ?? line.amount ?? quantity * n(line.rate));
    const row = hsn.get(key) || { hsn: code, description: line.description || line.name || item.name || '', uqc, quantity: 0, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
    row.quantity += sign * quantity; row.taxable += sign * taxable;
    row.cgst += sign * n(line.cgstAmount); row.sgst += sign * n(line.sgstAmount); row.igst += sign * n(line.igstAmount); row.cess += sign * n(line.cessAmount);
    hsn.set(key, row);
  }
  sections.push({ key: 'hsn', sheet: '12 HSN Summary', code: '12', label: 'HSN-wise Summary of Outward Supplies', columns: [['hsn','HSN / SAC'],['description','Description'],['uqc','UQC'],['quantity','Total Quantity','number'],['rate','GST Rate','number'],['taxable','Taxable Value','money'],['cgst','CGST','money'],['sgst','SGST / UTGST','money'],['igst','IGST','money'],['cess','Cess','money']], rows: [...hsn.values()] });

  const documentGroups = [
    { type: 'Sales Invoices', docs: allInvoices },
    { type: 'Credit Notes', docs: allCreditNotes },
  ].map(({ type, docs }) => ({ type, from: docs[0]?.number || '', to: docs.at(-1)?.number || '', total: docs.length, cancelled: docs.filter((row) => /cancel/i.test(text(row.status))).length, net: docs.filter(active).length }));
  sections.push({ key: 'documents', sheet: '13 Documents Issued', code: '13', label: 'Documents Issued', columns: [['type','Document Type'],['from','Serial No. From'],['to','Serial No. To'],['total','Total Issued','number'],['cancelled','Cancelled','number'],['net','Net Issued','number']], rows: documentGroups });
  sections.push({ key: 'eco', sheet: '14 E-Commerce', code: '14', label: 'Supplies made through E-Commerce Operators', columns: detailColumns, rows: detail(invoices.filter((row) => row.ecommerceOperator || row.ecoGstin)) });
  sections.push({ key: 'section95', sheet: '15 Section 9(5)', code: '15', label: 'Supplies under Section 9(5)', columns: detailColumns, rows: detail(invoices.filter((row) => row.section9_5)) });

  const settings = company?.profile?.companySettings || {};
  return {
    company: {
      name: settings.legalName || company?.legalName || company?.name || '',
      tradeName: settings.tradeName || company?.tradeName || '',
      gstin: gstin || company?.gstin || '',
      registrationType: company?.gstRegistration || settings.gstRegistration || 'Regular',
      registrationDate: company?.gstRegistrationDate || company?.registrationDate || settings.gstRegistrationDate || '',
      address: companyAddress(company),
      state: company?.state || settings.regStateName || '',
      period: periodLabel || '',
    },
    sections,
  };
}

const border = { borderColor: '#D8DEE8', borderStyle: 'thin' };
const stringCell = (value, extra = {}) => ({ value: text(value), type: String, wrap: true, ...border, ...extra });
const numberCell = (value, extra = {}) => ({ value: n(value), type: Number, format: '#,##,##0.00', align: 'right', ...border, ...extra });
const header = (value, extra = {}) => stringCell(value, { fontWeight: 'bold', backgroundColor: '#F5F7FA', textColor: '#0F172A', ...extra });

export async function exportGstr1Excel(args) {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const model = buildGstr1ExcelModel(args);
    const summaryColumns = [['code','Particular'],['label','Description'],['count','Voucher Count','number'],['taxable','Taxable Value','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST / UTGST','money'],['cess','Cess','money'],['tax','Total Tax','money'],['total','Invoice Value','money']];
    const summaryRows = model.sections.map((section) => ({ code: section.code, label: section.label, count: section.rows.length, taxable: sum(section.rows, 'taxable'), igst: sum(section.rows, 'igst'), cgst: sum(section.rows, 'cgst'), sgst: sum(section.rows, 'sgst'), cess: sum(section.rows, 'cess'), tax: sum(section.rows, 'tax'), total: sum(section.rows, 'total') }));
    const meta = [
      ['GSTR-1 Filing Workbook', model.company.name], ['GSTIN', model.company.gstin], ['Trade Name', model.company.tradeName],
      ['Registration Type', model.company.registrationType], ['GST Registration Date', model.company.registrationDate],
      ['Registered Address', model.company.address], ['State', model.company.state], ['Return Period', model.company.period],
      ['Generated On', new Date().toLocaleString('en-IN')],
    ];
    const summaryData = [
      [stringCell('GSTR-1 Filing Summary', { fontWeight: 'bold', fontSize: 16, textColor: '#0F172A', columnSpan: summaryColumns.length })],
      ...meta.map(([label, value]) => [header(label), stringCell(value, { columnSpan: summaryColumns.length - 1 })]),
      [{}],
      summaryColumns.map(([, label]) => header(label)),
      ...summaryRows.map((row) => summaryColumns.map(([key,, kind]) => kind ? numberCell(row[key]) : stringCell(row[key]))),
    ];
    const sheets = [{ data: summaryData, sheet: 'Summary', stickyRowsCount: meta.length + 3, showGridLines: false, columns: summaryColumns.map(([, label, kind]) => ({ width: kind ? 16 : Math.max(14, Math.min(38, label.length + 8)) })) }];
    for (const section of model.sections) {
      const data = [
        [stringCell(`${section.code} — ${section.label}`, { fontWeight: 'bold', fontSize: 13, textColor: '#0F172A', columnSpan: section.columns.length })],
        section.columns.map(([, label]) => header(label)),
        ...(section.rows.length ? section.rows.map((row) => section.columns.map(([key,, kind]) => kind ? numberCell(row[key]) : stringCell(row[key]))) : [[stringCell('No records for the selected period.', { columnSpan: section.columns.length, textColor: '#64748B' })]]),
      ];
      sheets.push({ data, sheet: section.sheet.slice(0, 31), stickyRowsCount: 2, showGridLines: false, columns: section.columns.map(([, label, kind]) => ({ width: kind ? 16 : Math.max(14, Math.min(32, label.length + 8)) })) });
    }
    const workbook = writeXlsxFile(sheets, { fontFamily: 'Inter', fontSize: 10 });
    await workbook.toFile(`GSTR1_${model.company.gstin || 'GSTIN'}_${text(args.portalPeriod) || 'period'}.xlsx`);
    notify.success('Complete GSTR-1 Excel workbook downloaded.');
  } catch (error) {
    notify.error(`GSTR-1 Excel export failed: ${String(error?.message || error)}`);
  }
}
