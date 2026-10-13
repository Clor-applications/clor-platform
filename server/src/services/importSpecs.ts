/**
 * Column definitions for each importable document — requirements 15 and 16.
 *
 * One place defines the columns, so the downloadable template and the validator
 * cannot drift apart. A template that no longer matches what the importer
 * accepts is worse than no template at all.
 */

export type ColumnSpec = {
  key: string;
  label: string;
  required: boolean;
  hint: string;
  /** Value used in the sample row of the downloadable template. */
  sample: string;
};

export type ImportSpec = {
  docType: string;
  label: string;
  /** Rows sharing this column belong to one document. */
  groupBy: string;
  description: string;
  columns: ColumnSpec[];
};

export const IMPORT_SPECS: Record<string, ImportSpec> = {
  JOURNAL: {
    docType: 'JOURNAL',
    label: 'Journal entries',
    groupBy: 'entry_ref',
    description:
      'One row per journal line. Lines sharing an entry_ref become a single entry, and each entry must balance — total debits equal to total credits.',
    columns: [
      { key: 'entry_ref', label: 'Entry ref', required: true, hint: 'Groups lines into one entry', sample: 'JV-001' },
      { key: 'date', label: 'Date', required: true, hint: 'YYYY-MM-DD', sample: '2026-04-01' },
      { key: 'narration', label: 'Narration', required: false, hint: 'Description of the entry', sample: 'Opening balance' },
      {
        key: 'account_code',
        label: 'Account code',
        required: true,
        hint: 'Ledger account code, as shown in the chart of accounts',
        sample: '1200',
      },
      { key: 'debit', label: 'Debit', required: false, hint: 'Amount, or blank', sample: '5000.00' },
      { key: 'credit', label: 'Credit', required: false, hint: 'Amount, or blank', sample: '' },
    ],
  },

  INVOICE: {
    docType: 'INVOICE',
    label: 'Sales invoices',
    groupBy: 'invoice_no',
    description:
      'One row per invoice line. Rows sharing an invoice_no become a single invoice. Historical numbers are kept as supplied.',
    columns: [
      { key: 'invoice_no', label: 'Invoice no', required: true, hint: 'Groups lines into one invoice', sample: 'INV-1001' },
      { key: 'date', label: 'Date', required: true, hint: 'YYYY-MM-DD', sample: '2026-04-05' },
      { key: 'customer_name', label: 'Customer', required: true, hint: 'Matched by name', sample: 'Bengaluru Office Supplies Pvt Ltd' },
      { key: 'customer_gstin', label: 'Customer GSTIN', required: false, hint: 'Optional', sample: '' },
      { key: 'description', label: 'Description', required: true, hint: 'Line description', sample: 'Consulting' },
      { key: 'quantity', label: 'Quantity', required: true, hint: 'Number', sample: '1' },
      { key: 'rate', label: 'Rate', required: true, hint: 'Per unit, before tax', sample: '10000.00' },
      { key: 'gst_rate', label: 'GST %', required: false, hint: '0, 5, 12, 18 or 28', sample: '18' },
      { key: 'tax_type', label: 'Tax type', required: false, hint: 'CGST_SGST (default) or IGST for inter-state', sample: 'CGST_SGST' },
      /*
       * The rest of what the creation form collects.
       *
       * The template stopped at nine columns while the form had a dozen more,
       * so an imported year came in without due dates, references, units,
       * HSN codes or discounts — all of it re-keyed by hand afterwards, which
       * is the work importing was supposed to remove. Every one of these is
       * optional: a file that worked yesterday still works.
       */
      { key: 'due_date', label: 'Due date', required: false, hint: 'YYYY-MM-DD', sample: '2026-05-05' },
      { key: 'item_code', label: 'Item code', required: false, hint: 'Matched to an existing item', sample: 'FG-100' },
      { key: 'unit', label: 'Unit', required: false, hint: 'Pcs, Kg, Hrs…', sample: 'Pcs' },
      { key: 'hsn_sac', label: 'HSN / SAC', required: false, hint: 'Falls back to the item master', sample: '9983' },
      { key: 'discount_pct', label: 'Line discount %', required: false, hint: 'Applied before tax', sample: '0' },
      { key: 'ref_no', label: 'Ref no', required: false, hint: 'Quotation or sales order', sample: '' },
      { key: 'ref_date', label: 'Ref date', required: false, hint: 'YYYY-MM-DD', sample: '' },
      { key: 'place_of_supply', label: 'Place of supply', required: false, hint: 'State name', sample: 'Karnataka' },
    ],
  },

  BILL: {
    docType: 'BILL',
    label: 'Purchase bills',
    groupBy: 'bill_no',
    description:
      'One row per bill line. Rows sharing a bill_no become a single bill, posted against the vendor.',
    columns: [
      { key: 'bill_no', label: 'Bill no', required: true, hint: 'Groups lines into one bill', sample: 'BILL-2001' },
      { key: 'date', label: 'Date', required: true, hint: 'YYYY-MM-DD', sample: '2026-04-06' },
      { key: 'vendor_name', label: 'Vendor', required: true, hint: 'Matched by name', sample: 'Karnataka Industrial Supplies' },
      { key: 'vendor_gstin', label: 'Vendor GSTIN', required: false, hint: 'Optional', sample: '' },
      { key: 'description', label: 'Description', required: true, hint: 'Line description', sample: 'Raw material' },
      { key: 'quantity', label: 'Quantity', required: true, hint: 'Number', sample: '10' },
      { key: 'rate', label: 'Rate', required: true, hint: 'Per unit, before tax', sample: '500.00' },
      { key: 'gst_rate', label: 'GST %', required: false, hint: '0, 5, 12, 18 or 28', sample: '18' },
      { key: 'tax_type', label: 'Tax type', required: false, hint: 'CGST_SGST (default) or IGST for inter-state', sample: 'CGST_SGST' },
    ],
  },

  CREDIT_NOTE: {
    docType: 'CREDIT_NOTE',
    label: 'Credit notes (sales returns)',
    groupBy: 'note_no',
    description:
      'One row per note line. Rows sharing a note_no become a single credit note, which reduces revenue and the customer balance.',
    columns: [
      { key: 'note_no', label: 'Note no', required: true, hint: 'Groups lines into one note', sample: 'CN-3001' },
      { key: 'date', label: 'Date', required: true, hint: 'YYYY-MM-DD', sample: '2026-04-07' },
      { key: 'customer_name', label: 'Customer', required: true, hint: 'Matched by name', sample: 'Bengaluru Office Supplies Pvt Ltd' },
      { key: 'against_invoice', label: 'Against invoice', required: false, hint: 'Original invoice number', sample: 'INV-1001' },
      { key: 'description', label: 'Description', required: true, hint: 'Line description', sample: 'Returned goods' },
      { key: 'quantity', label: 'Quantity', required: true, hint: 'Number', sample: '1' },
      { key: 'rate', label: 'Rate', required: true, hint: 'Per unit, before tax', sample: '1000.00' },
      { key: 'gst_rate', label: 'GST %', required: false, hint: '0, 5, 12, 18 or 28', sample: '18' },
      { key: 'tax_type', label: 'Tax type', required: false, hint: 'CGST_SGST (default) or IGST for inter-state', sample: 'CGST_SGST' },
    ],
  },

  DEBIT_NOTE: {
    docType: 'DEBIT_NOTE',
    label: 'Debit notes (purchase returns)',
    groupBy: 'note_no',
    description:
      'One row per note line. Rows sharing a note_no become a single debit note, which reduces purchases and the vendor balance.',
    columns: [
      { key: 'note_no', label: 'Note no', required: true, hint: 'Groups lines into one note', sample: 'DN-4001' },
      { key: 'date', label: 'Date', required: true, hint: 'YYYY-MM-DD', sample: '2026-04-08' },
      { key: 'vendor_name', label: 'Vendor', required: true, hint: 'Matched by name', sample: 'Karnataka Industrial Supplies' },
      { key: 'against_bill', label: 'Against bill', required: false, hint: 'Original bill number', sample: 'BILL-2001' },
      { key: 'description', label: 'Description', required: true, hint: 'Line description', sample: 'Returned material' },
      { key: 'quantity', label: 'Quantity', required: true, hint: 'Number', sample: '2' },
      { key: 'rate', label: 'Rate', required: true, hint: 'Per unit, before tax', sample: '500.00' },
      { key: 'gst_rate', label: 'GST %', required: false, hint: '0, 5, 12, 18 or 28', sample: '18' },
      { key: 'tax_type', label: 'Tax type', required: false, hint: 'CGST_SGST (default) or IGST for inter-state', sample: 'CGST_SGST' },
    ],
  },
};


/**
 * Document types with no server-side model to import into.
 *
 * Empty now that bills, credit notes and debit notes exist. Kept because the
 * import screen reads it to explain absences rather than leaving a gap the user
 * has to guess about.
 */
export const UNSUPPORTED_DOC_TYPES: Record<string, string> = {};

export const specFor = (docType: string) => IMPORT_SPECS[String(docType || '').toUpperCase()] || null;
