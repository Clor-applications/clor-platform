/**
 * What an invoice contains, per company.
 *
 * A distributor and a software consultancy raise the same legal document and
 * need almost none of the same fields on it. Showing every field to everyone
 * produces a form nobody can fill without scrolling past things that will
 * never apply to them; hiding fields behind a hardcoded feature flag produces
 * a product that fits one kind of business. So the field set is a preference,
 * and the industry only chooses its starting point.
 *
 * Two rules hold this together:
 *
 * 1. **Off means gone.** A preference that is off removes the field from the
 *    form *and* from the printed document. It is never greyed out — a field
 *    you cannot use is still a field you have to read past.
 * 2. **Statutory fields are not preferences.** Place of supply and HSN/SAC
 *    decide the tax split and what lands in GSTR-1. They are marked `locked`
 *    and the switch is disabled. A company cannot waive them, so offering the
 *    switch would be a lie.
 *
 * Stored at `company.docSettings.preferences.invoice`. Resolution merges the
 * stored map *over* the industry defaults rather than replacing it, so a
 * preference added in a later release arrives at its industry default instead
 * of silently off for every existing company.
 */

export const INVOICE_PREF_GROUPS = [
  { key: 'statutory', label: 'Statutory & compliance', blurb: 'What the law, or the customer’s own filing, requires on the document.' },
  { key: 'party', label: 'Parties & addresses', blurb: 'Who is being billed, where it ships, who sold it.' },
  { key: 'logistics', label: 'Goods movement', blurb: 'Only useful when something physically travels.' },
  { key: 'item', label: 'Item detail', blurb: 'Extra columns on the line items.' },
  { key: 'service', label: 'Services & projects', blurb: 'For work billed by period, project or running account.' },
  { key: 'money', label: 'Money', blurb: 'What can adjust the amount, and how it is presented.' },
  { key: 'doc', label: 'Document', blurb: 'Free text and blocks on the printed invoice.' },
  { key: 'rule', label: 'Behaviour', blurb: 'What the form refuses, warns about, or fills in for you.' },
];

export const INVOICE_INDUSTRIES = [
  { key: 'trading', label: 'Trading & distribution' },
  { key: 'manufacturing', label: 'Manufacturing' },
  { key: 'services', label: 'Services / IT / consulting' },
  { key: 'exports', label: 'Exports & SEZ' },
  { key: 'pharma', label: 'Pharma & FMCG distribution' },
  { key: 'works', label: 'Works contract & construction' },
  { key: 'retail', label: 'Retail & counter sales' },
  { key: 'transport', label: 'Transport & logistics' },
];

export const DEFAULT_INVOICE_INDUSTRY = 'trading';

/**
 * `locked` — on the invoice because the law puts it there; the switch is
 * disabled rather than absent, so it is visible that the decision was made.
 *
 * `core` — on for every industry out of the box. This list is deliberately
 * short. A new company should meet an invoice it can fill in one pass, not a
 * form defending every field it might one day need; anything past the common
 * case is switched on from Invoice Fields when the business actually asks.
 *
 * `industries` — what an industry adds on top of core. A handful each, and
 * only for fields that industry genuinely cannot invoice without. An empty
 * list means nobody gets it by default and somebody has to ask for it.
 */
export const INVOICE_PREFS = [
  // --- statutory -----------------------------------------------------------
  { key: 'placeOfSupply', group: 'statutory', label: 'Place of supply', blurb: 'Decides CGST + SGST against IGST', kind: 'Statutory', locked: true, core: true, industries: [] },
  { key: 'hsnSac', group: 'statutory', label: 'HSN / SAC code', blurb: 'Line column and printed column', kind: 'Statutory', locked: true, core: true, industries: [] },
  { key: 'reverseCharge', group: 'statutory', label: 'Reverse charge', blurb: 'Prints “Tax payable on reverse charge”', kind: 'Flag', industries: ['transport'] },
  { key: 'eInvoice', group: 'statutory', label: 'E-invoice IRN & signed QR', blurb: 'Mandatory above the turnover threshold', kind: 'Statutory', industries: [] },
  { key: 'ewayBill', group: 'statutory', label: 'E-way bill no. & date', blurb: 'Goods above the value threshold', kind: 'Statutory', industries: ['trading', 'manufacturing', 'pharma', 'transport'] },
  { key: 'lut', group: 'statutory', label: 'LUT number', blurb: 'Export and SEZ without payment of IGST', kind: 'Statutory', industries: ['exports'] },
  { key: 'iec', group: 'statutory', label: 'IEC', blurb: 'Importer-Exporter Code on export invoices', kind: 'Statutory', industries: ['exports'] },
  { key: 'shippingBill', group: 'statutory', label: 'Shipping bill no. & port code', blurb: 'Export invoices', kind: 'Text', industries: ['exports'] },
  { key: 'foreignCurrency', group: 'statutory', label: 'Currency & exchange rate', blurb: 'Foreign-currency invoices; the INR value still prints', kind: 'Money', industries: ['exports'] },
  { key: 'tcs', group: 'statutory', label: 'TCS 206C(1H)', blurb: '0.1% above ₹50 lakh from one buyer', kind: 'Money', industries: [] },
  { key: 'tds', group: 'statutory', label: 'TDS deducted by customer', blurb: '194C / 194J — shows the net receivable', kind: 'Money', industries: ['works'] },
  { key: 'drugLicence', group: 'statutory', label: 'Drug licence no.', blurb: 'Printed header — pharma distribution', kind: 'Statutory', industries: ['pharma'] },

  // --- parties -------------------------------------------------------------
  { key: 'shipTo', group: 'party', label: 'Ship-to different from bill-to', blurb: 'Consignee block on the print', kind: 'Block', industries: ['trading', 'manufacturing'] },
  { key: 'dispatchFrom', group: 'party', label: 'Dispatch-from address', blurb: 'When it is not the billing address', kind: 'Block', industries: [] },
  { key: 'salesman', group: 'party', label: 'Salesperson', blurb: 'Form only; feeds Sales by Salesman', kind: 'List', industries: [] },
  { key: 'costCenter', group: 'party', label: 'Cost centre', blurb: 'Tags the revenue for internal reporting', kind: 'List', industries: [] },
  { key: 'paymentTerms', group: 'party', label: 'Payment terms', blurb: 'Drives the due date. Default comes from the customer.', kind: 'List', core: true, industries: [] },
  { key: 'customerRef', group: 'party', label: 'Customer PO no. & date', blurb: 'Ref No. / Ref Date on the form', kind: 'Text', core: true, industries: [] },

  // --- logistics -----------------------------------------------------------
  /*
   * Off unless the business is a transport one.
   *
   * It was on for trading and manufacturing — which is the default industry —
   * so every new invoice carried a Transporter and a vehicle number whether
   * anything was ever shipped by road or not. A field nobody fills is a field
   * everybody has to look past. Switch it on here, or add one of your own
   * under Custom Fields.
   */
  { key: 'transporter', group: 'logistics', label: 'Transporter & vehicle no.', blurb: 'Form and print', kind: 'Text', industries: ['transport'] },
  { key: 'lrNumber', group: 'logistics', label: 'LR / GR no. & date', blurb: 'Consignment note from the transporter', kind: 'Text', industries: ['transport'] },
  { key: 'packages', group: 'logistics', label: 'Packages, gross & net weight', blurb: 'Printed under the lines', kind: 'Text', industries: ['exports'] },
  { key: 'challanRef', group: 'logistics', label: 'Delivery challan reference', blurb: 'Links the invoice to what left the gate', kind: 'Ref', industries: [] },

  // --- item ----------------------------------------------------------------
  { key: 'batch', group: 'item', label: 'Batch / lot no.', blurb: 'Line column; ties to Batch Stock', kind: 'Column', industries: ['pharma'] },
  { key: 'expiry', group: 'item', label: 'Mfg & expiry date', blurb: 'Line column; blocks selling expired stock', kind: 'Column', industries: ['pharma'] },
  { key: 'mrp', group: 'item', label: 'MRP', blurb: 'Line column; printed for retail', kind: 'Column', industries: ['pharma', 'retail'] },
  { key: 'freeQty', group: 'item', label: 'Free quantity', blurb: 'Scheme goods — moves stock, earns no revenue', kind: 'Column', industries: [] },
  { key: 'serialNo', group: 'item', label: 'Serial / IMEI no.', blurb: 'Line column; one row per unit', kind: 'Column', industries: [] },
  { key: 'secondaryUom', group: 'item', label: 'Secondary unit', blurb: 'Bill in boxes, hold stock in pieces', kind: 'Column', industries: [] },

  // --- services ------------------------------------------------------------
  { key: 'servicePeriod', group: 'service', label: 'Service period from / to', blurb: 'What the fee covers', kind: 'Date', industries: ['services'] },
  { key: 'project', group: 'service', label: 'Project / site', blurb: 'Groups invoices for one job', kind: 'List', industries: ['works'] },
  { key: 'workOrder', group: 'service', label: 'Work order & RA bill no.', blurb: 'Running-account billing', kind: 'Text', industries: ['works'] },
  { key: 'retention', group: 'service', label: 'Retention %', blurb: 'Held back until the defect period ends', kind: 'Money', industries: ['works'] },
  { key: 'timesheetRef', group: 'service', label: 'Timesheet reference', blurb: 'Backing for a time-and-material bill', kind: 'Ref', industries: [] },

  // --- money ---------------------------------------------------------------
  { key: 'invoiceDiscount', group: 'money', label: 'Invoice discount', blurb: 'On top of the per-line discount', kind: 'Money', core: true, industries: [] },
  { key: 'otherCharges', group: 'money', label: 'Other charges', blurb: 'Freight, packing, insurance — taxable', kind: 'Money', industries: [] },
  { key: 'roundOff', group: 'money', label: 'Round off', blurb: 'Nearest rupee; posts to Rounding Difference', kind: 'Derived', core: true, industries: [] },
  { key: 'advanceAdjust', group: 'money', label: 'Advance adjustment', blurb: 'Applies a receipt already taken', kind: 'Money', industries: [] },
  { key: 'amountInWords', group: 'money', label: 'Amount in words', blurb: 'Foot of the form and the print', kind: 'Derived', core: true, industries: [] },
  { key: 'bankQr', group: 'money', label: 'Bank details & UPI QR', blurb: 'Printed document only', kind: 'Block', core: true, industries: [] },

  // --- document ------------------------------------------------------------
  { key: 'notes', group: 'doc', label: 'Notes', blurb: 'Free text, prints under the terms', kind: 'Text', core: true, industries: [] },
  { key: 'terms', group: 'doc', label: 'Terms & conditions', blurb: 'Numbered list, per document type', kind: 'Text', core: true, industries: [] },
  { key: 'declaration', group: 'doc', label: 'Declaration', blurb: 'Printed document. Text editable.', kind: 'Text', industries: [] },
  { key: 'signature', group: 'doc', label: 'Signature block', blurb: 'Digital image, or space for a pen', kind: 'Block', core: true, industries: [] },
  { key: 'attachments', group: 'doc', label: 'Attachments', blurb: 'Customer PO, LR copy, approval mail', kind: 'Block', industries: [] },

  // --- behaviour -----------------------------------------------------------
  { key: 'warnStock', group: 'rule', label: 'Warn on insufficient stock', blurb: 'Blocks finalising a goods line below zero', kind: 'Rule', core: true, industries: [] },
  { key: 'warnCreditLimit', group: 'rule', label: 'Warn past credit limit', blurb: 'Uses the customer’s outstanding', kind: 'Rule', core: true, industries: [] },
  { key: 'lineTaxEditable', group: 'rule', label: 'Tax rate editable per line', blurb: 'Off: the item’s GST rate is used, uneditable', kind: 'Rule', industries: [] },
  { key: 'warnDuplicateItem', group: 'rule', label: 'Warn on a repeated item', blurb: 'Same item twice on one invoice', kind: 'Rule', industries: [] },
  { key: 'dueDateFromTerms', group: 'rule', label: 'Due date follows payment terms', blurb: 'Off: the due date is typed by hand', kind: 'Rule', core: true, industries: [] },
];

const PREF_BY_KEY = new Map(INVOICE_PREFS.map((p) => [p.key, p]));

export const getInvoicePrefDef = (key) => PREF_BY_KEY.get(key) || null;

/** Line-item columns a preference can add, in the order they should appear. */
export const INVOICE_LINE_PREF_COLUMNS = ['batch', 'expiry', 'serialNo', 'freeQty', 'mrp', 'secondaryUom'];

export const normalizeIndustry = (value) => {
  const key = String(value || '').trim();
  return INVOICE_INDUSTRIES.some((i) => i.key === key) ? key : DEFAULT_INVOICE_INDUSTRY;
};

/** The switch positions an industry starts with. Locked prefs are always on. */
export const defaultInvoicePrefsFor = (industry) => {
  const ind = normalizeIndustry(industry);
  const out = {};
  INVOICE_PREFS.forEach((p) => {
    out[p.key] = Boolean(p.locked || p.core || (p.industries || []).includes(ind));
  });
  return out;
};

/**
 * The resolved preference set for a company.
 *
 * Stored values win, but only for preferences that exist — an unknown key left
 * behind by a removed feature is dropped, and a preference the company has
 * never seen falls back to its industry default rather than to off.
 */
export const getInvoicePrefs = (company) => {
  const stored = company?.docSettings?.preferences?.invoice || {};
  const industry = normalizeIndustry(stored.industry);
  const defaults = defaultInvoicePrefsFor(industry);
  const saved = stored.fields && typeof stored.fields === 'object' ? stored.fields : {};

  const fields = {};
  INVOICE_PREFS.forEach((p) => {
    if (p.locked) {
      fields[p.key] = true;
      return;
    }
    fields[p.key] = Object.prototype.hasOwnProperty.call(saved, p.key)
      ? Boolean(saved[p.key])
      : defaults[p.key];
  });

  return { industry, fields };
};

/** `prefs` accepts either the resolved object or its `fields` map. */
export const isInvoicePrefOn = (prefs, key) => {
  if (!prefs) return false;
  const map = prefs.fields && typeof prefs.fields === 'object' ? prefs.fields : prefs;
  const def = PREF_BY_KEY.get(key);
  if (def?.locked) return true;
  return Boolean(map[key]);
};

/**
 * Write preferences back onto the company.
 *
 * Returns a new `companies` array the same way the numbering helpers do, so
 * callers stay `setDb((db) => ({ ...db, companies: saveInvoicePrefs(...) }))`.
 *
 * Changing the industry resets every switch to that industry's defaults. That
 * is the point of picking one — a company that switches from Services to
 * Pharma and keeps its old switches has neither field set.
 */
export const saveInvoicePrefs = (db, companyId, patch = {}) => {
  const companies = db?.companies || [];
  return companies.map((company) => {
    if (company.id !== companyId) return company;

    const current = getInvoicePrefs(company);
    const industryChanged =
      patch.industry !== undefined && normalizeIndustry(patch.industry) !== current.industry;
    const industry = patch.industry !== undefined ? normalizeIndustry(patch.industry) : current.industry;

    let fields;
    if (industryChanged || patch.resetToIndustryDefault) {
      fields = defaultInvoicePrefsFor(industry);
    } else {
      fields = { ...current.fields, ...(patch.fields || {}) };
    }

    // Locked preferences are never written as false, whatever a caller passes.
    INVOICE_PREFS.forEach((p) => {
      if (p.locked) fields[p.key] = true;
    });

    const baseDoc = company.docSettings && typeof company.docSettings === 'object' ? company.docSettings : {};
    const basePrefs = baseDoc.preferences && typeof baseDoc.preferences === 'object' ? baseDoc.preferences : {};

    return {
      ...company,
      docSettings: {
        ...baseDoc,
        preferences: { ...basePrefs, invoice: { industry, fields } },
      },
    };
  });
};

/** How many of a group's switches are on — the count shown beside its heading. */
export const countPrefsOn = (prefs, groupKey) => {
  const list = INVOICE_PREFS.filter((p) => p.group === groupKey);
  return { on: list.filter((p) => isInvoicePrefOn(prefs, p.key)).length, total: list.length };
};

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

/**
 * Fields a company invents, stored at `company.docSettings.customFields.invoice`.
 *
 * Placement is asked twice — once for the form and once for the print — because
 * they are genuinely different questions. A transporter's name belongs under
 * the header on the printed copy and next to the other logistics fields on the
 * form, and plenty of fields are for internal use and should not print at all.
 */
export const CUSTOM_FIELD_TYPES = ['Text', 'Number', 'Date', 'Yes/No', 'List'];
export const CUSTOM_FIELD_FORM_PLACEMENTS = [
  { key: 'header', label: 'Header block' },
  { key: 'reference', label: 'Beside the reference fields' },
  { key: 'notes', label: 'Below notes' },
];
export const CUSTOM_FIELD_PRINT_PLACEMENTS = [
  { key: 'header', label: 'Under the header' },
  { key: 'terms', label: 'Beside the terms' },
  { key: 'none', label: 'Not printed' },
];

const slugify = (label) =>
  String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field';

/**
 * The fields, for whichever document is asking.
 *
 * Stored per document type, and a type with no list of its own falls back to
 * the invoice's. That fallback is the point: a company defines "Customer PO
 * ref" once and it appears on the order the PO arrives with, the challan that
 * quotes it and the invoice that bills it, rather than on the invoice alone.
 * Give a type its own list and it stops inheriting.
 */
export const getCustomFields = (company, docType = 'invoice') => {
  const all = company?.docSettings?.customFields;
  const own = all?.[docType];
  const list = Array.isArray(own) ? own : all?.invoice;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f === 'object' && f.key && f.label)
    .map((f) => ({
      key: String(f.key),
      label: String(f.label),
      type: CUSTOM_FIELD_TYPES.includes(f.type) ? f.type : 'Text',
      formPlacement: CUSTOM_FIELD_FORM_PLACEMENTS.some((p) => p.key === f.formPlacement) ? f.formPlacement : 'notes',
      printPlacement: CUSTOM_FIELD_PRINT_PLACEMENTS.some((p) => p.key === f.printPlacement) ? f.printPlacement : 'none',
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.map((o) => String(o)) : [],
      hidden: Boolean(f.hidden),
    }));
};

/** Only the fields a form should render — hidden ones keep their stored values. */
export const getVisibleCustomFields = (company, docType = 'invoice') =>
  getCustomFields(company, docType).filter((f) => !f.hidden);

/** A key that no existing field is already using. */
export const nextCustomFieldKey = (existing, label) => {
  const base = slugify(label);
  const taken = new Set((existing || []).map((f) => f.key));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
};

/**
 * The fields a company added to ONE kind of document.
 *
 * Every document type keeps its own list. It used to write `invoice`
 * regardless of who was editing, so a field added from a bill appeared on
 * invoices — and the bill's own list could never be built at all. The read
 * side still falls back to the invoice list for a type nobody has configured,
 * so nothing a company already defined disappears.
 */
export const saveCustomFields = (db, companyId, list, docType = 'invoice') => {
  const companies = db?.companies || [];
  const key = String(docType || 'invoice');
  return companies.map((company) => {
    if (company.id !== companyId) return company;
    const baseDoc = company.docSettings && typeof company.docSettings === 'object' ? company.docSettings : {};
    const baseCustom = baseDoc.customFields && typeof baseDoc.customFields === 'object' ? baseDoc.customFields : {};
    return {
      ...company,
      docSettings: { ...baseDoc, customFields: { ...baseCustom, [key]: Array.isArray(list) ? list : [] } },
    };
  });
};

// ---------------------------------------------------------------------------
// Payment details printed on the invoice
// ---------------------------------------------------------------------------

/**
 * Where the customer is meant to send the money.
 *
 * The bank account itself is a ledger under Bank Accounts — it already carries
 * the name, number, branch and IFSC, and it is the account the receipt will be
 * posted to. Storing a second copy here would let the printed invoice drift
 * from the book, so this only stores *which* account to print.
 *
 * The UPI id has no ledger to live on, so it is stored here. The QR is built
 * from it at print time and carries the invoice amount, which is why it only
 * appears once the invoice is finalised — a draft's amount can still change,
 * and a QR that pays the wrong amount is worse than no QR.
 *
 * Lives at `company.docSettings.payment`. Gated by the `bankQr` preference.
 */
export const getInvoicePaymentDetails = (company) => {
  const stored = company?.docSettings?.payment || {};
  return {
    bankAccountId: stored.bankAccountId ? String(stored.bankAccountId) : '',
    upiId: String(stored.upiId || '').trim(),
    payeeName: String(stored.payeeName || '').trim(),
    showQr: stored.showQr === undefined ? true : Boolean(stored.showQr),
  };
};

export const saveInvoicePaymentDetails = (db, companyId, patch = {}) => {
  const companies = db?.companies || [];
  return companies.map((company) => {
    if (company.id !== companyId) return company;
    const baseDoc = company.docSettings && typeof company.docSettings === 'object' ? company.docSettings : {};
    return {
      ...company,
      docSettings: { ...baseDoc, payment: { ...getInvoicePaymentDetails(company), ...patch } },
    };
  });
};

/** Bank ledgers this company can print on an invoice. */
export const listBankAccounts = (db, companyId) =>
  (Array.isArray(db?.chartOfAccounts) ? db.chartOfAccounts : [])
    .filter((a) => a.companyId === companyId && a.bankDetails && a.bankDetails.accountNumber)
    .map((a) => ({
      id: String(a.id),
      name: String(a.name || a.bankDetails.bankName || 'Bank account'),
      bankName: String(a.bankDetails.bankName || ''),
      accountNumber: String(a.bankDetails.accountNumber || ''),
      branch: String(a.bankDetails.branch || ''),
      ifsc: String(a.bankDetails.ifsc || ''),
    }));

/**
 * A UPI intent string, or '' when there is nothing worth encoding.
 *
 * `am` is included so the customer does not retype the amount; `cu` is fixed at
 * INR because UPI does not settle anything else. A blank return means no QR is
 * drawn at all rather than one that opens an app with empty fields.
 */
export const buildUpiPaymentUri = ({ upiId, payeeName, amount, invoiceNumber }) => {
  const pa = String(upiId || '').trim();
  if (!pa || !pa.includes('@')) return '';
  const amt = Number(amount);
  const params = [
    `pa=${encodeURIComponent(pa)}`,
    `pn=${encodeURIComponent(String(payeeName || '').trim() || pa.split('@')[0])}`,
    'cu=INR',
  ];
  if (Number.isFinite(amt) && amt > 0) params.push(`am=${amt.toFixed(2)}`);
  const note = String(invoiceNumber || '').trim();
  if (note) params.push(`tn=${encodeURIComponent(`Invoice ${note}`)}`);
  return `upi://pay?${params.join('&')}`;
};
