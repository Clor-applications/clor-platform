export const INVOICE_PRINT_GROUPS = [
  {
    key: 'identity',
    label: 'Business identity',
    description: 'Details that identify the seller and where payment should go.',
    options: [
      ['companyAddress', 'Business address'],
      ['companyPhone', 'Phone number'],
      ['companyEmail', 'Email address'],
      ['companyWebsite', 'Website'],
      ['companyGstin', 'Business GSTIN'],
      ['companyPan', 'PAN / income-tax number', false],
      ['companyCin', 'CIN / registration number', false],
      ['companyUdyam', 'Udyam and enterprise type', false],
      ['companyActivity', 'Business activity', false],
      ['paymentDetails', 'Bank details and payment QR'],
      ['companySeal', 'Company seal', false],
      ['signature', 'Authorised signature'],
    ],
  },
  {
    key: 'customer',
    label: 'Customer and consignee',
    description: 'Buyer identity, tax registration and delivery party.',
    options: [
      ['customerAddress', 'Customer address'],
      ['customerGstin', 'Customer GSTIN'],
      ['customerPan', 'Customer PAN', false],
      ['customerState', 'State name and state code'],
      ['placeOfSupply', 'Place of supply'],
      ['consignee', 'Consignee / ship-to details'],
      ['partyBalance', 'Previous and current balance', false],
    ],
  },
  {
    key: 'items',
    label: 'Item table',
    description: 'Choose the detail customers see for each billed line.',
    options: [
      ['serialNumber', 'Line number'],
      ['quantity', 'Quantity'],
      ['alternateQuantity', 'Alternate quantity and unit', false],
      ['actualQuantity', 'Actual quantity', false],
      ['rate', 'Rate'],
      ['partNumber', 'Part number', false],
      ['hsnSac', 'HSN / SAC'],
      ['gstRate', 'GST rate'],
      ['dutyRate', 'Rate of duty', false],
      ['taxAmount', 'Tax amount'],
      ['batchDetails', 'Batch and expiry details'],
      ['warehouseDetails', 'Warehouse / godown details', false],
      ['itemDescription', 'Additional item description'],
      ['lineNarration', 'Narration for each line', false],
      ['lineSubtotals', 'Subtotals after each line', false],
    ],
  },
  {
    key: 'tax',
    label: 'Tax and statutory detail',
    description: 'GST analysis and export declarations printed for compliance.',
    options: [
      ['taxSummary', 'GST breakup and tax summary'],
      ['itemTaxDetails', 'Item-wise GST details', false],
      ['hsnSummary', 'HSN / SAC summary', false],
      ['lutDetails', 'LUT / bond details', false],
      ['baseCurrencyTax', 'Tax value in base currency', false],
      ['exportTaxAmount', 'Tax amount on export invoice', false],
      ['reverseCharge', 'Reverse-charge declaration', false],
    ],
  },
  {
    key: 'order',
    label: 'Order and dispatch',
    description: 'Commercial references and movement-of-goods information.',
    options: [
      ['documentReferences', 'Reference number and due date'],
      ['orderDetails', 'Customer order details'],
      ['dispatchDetails', 'Dispatch and transport details'],
      ['paymentTerms', 'Payment and delivery terms'],
      ['exportDetails', 'Export and shipping details', false],
      ['billWiseDetails', 'Bill-wise details', false],
    ],
  },
  {
    key: 'footer',
    label: 'Totals and footer',
    description: 'Payment and confirmation blocks below the item table.',
    options: [
      ['amountInWords', 'Amount in words'],
      ['currencySymbol', 'Currency symbol with total'],
      ['narration', 'Invoice narration', false],
      ['terms', 'Terms and conditions'],
      ['declaration', 'Declaration'],
      ['jurisdiction', 'Jurisdiction', false],
      ['preparedBy', 'Prepared by and verified by', false],
      ['footerNote', 'Footer note'],
      ['pageNumbers', 'Page numbers'],
    ],
  },
  {
    key: 'output',
    label: 'Output and copies',
    description: 'Controls used when preparing final printed or shared copies.',
    options: [
      ['autoWrap', 'Wrap long descriptions'],
      ['digitalSignature', 'Digital signature', false],
      ['transporterCopy', 'Transporter copy', false],
      ['stripeView', 'Alternating item-row shading', false],
      ['backgroundGraphics', 'Background colour and graphics'],
    ],
  },
];

export const DEFAULT_INVOICE_PRINT_OPTIONS = Object.freeze(
  Object.fromEntries(INVOICE_PRINT_GROUPS.flatMap((group) => group.options.map(([key, , defaultValue = true]) => [key, defaultValue])))
);

export const getInvoicePrintSettings = (docSettings) => {
  const invoice = docSettings?.templates?.invoice || {};
  const templatePaper = String(invoice.templateId || '').toLowerCase().startsWith('a5') ? 'a5' : 'a4';
  return {
    title: String(invoice.printTitle || 'TAX INVOICE'),
    subtitle: String(invoice.printSubtitle || ''),
    footerText: String(invoice.footerText || 'This is a computer generated invoice.'),
    declarationText: String(invoice.declarationText || ''),
    jurisdictionText: String(invoice.jurisdictionText || ''),
    generatedByText: String(invoice.generatedByText || 'This is a computer generated invoice.'),
    preparedByText: String(invoice.preparedByText || ''),
    copyLabel: String(invoice.copyLabel || 'Original for recipient'),
    language: String(invoice.language || 'English'),
    copies: Math.max(1, Math.min(5, Number(invoice.copies || 1))),
    pageRange: String(invoice.pageRange || 'All'),
    itemNameStyle: ['name', 'code', 'both'].includes(invoice.itemNameStyle) ? invoice.itemNameStyle : 'name',
    partyNameStyle: ['name', 'legal', 'both'].includes(invoice.partyNameStyle) ? invoice.partyNameStyle : 'name',
    optimizePaper: invoice.optimizePaper !== false,
    printFormat: ['standard', 'compact', 'simple'].includes(invoice.printFormat) ? invoice.printFormat : 'standard',
    paperSize: ['a4', 'a5', 'letter'].includes(invoice.paperSize) ? invoice.paperSize : templatePaper,
    orientation: invoice.orientation === 'landscape' ? 'landscape' : 'portrait',
    margin: ['compact', 'normal', 'wide'].includes(invoice.margin) ? invoice.margin : 'normal',
    options: { ...DEFAULT_INVOICE_PRINT_OPTIONS, ...(invoice.printOptions || {}) },
  };
};

