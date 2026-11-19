/**
 * The company details page, as one model both screens draw from: Workspace → Company profile and
 * People → Settings → Company details (server: routes/companyProfile.ts, one record).
 *
 * Round 64 "companyprofile" A (owner, 19 Nov 2026, DESIGN.md "Pick conflicts resolved"): one page
 * grouped as Identity, Address, Tax numbers and Logo, and each field says where it is used.
 *
 * Every "Used on" below was checked against the code that reads the field; a field nothing reads
 * yet says nothing, rather than a use that is not true:
 *   name (Name in CLOR) — server/src/services/people/letters.ts ({{orgName}}), services/people/offers.ts
 *                         and documentReminders.ts (emails), routes/portal.ts (employee app's company)
 *   legalName           — services/payroll/form16.ts employerFor (Form 16, and Form 24Q via
 *                         routes/payrollReports.ts), services/einvoicePayload.ts (seller's legal name)
 *   pan                 — services/payroll/form16.ts employerFor (Form 16, Form 24Q)
 *   addressLine, city   — services/einvoicePayload.ts, when the branch has no GSTIN of its own
 *   pincode, state      — services/einvoicePayload.ts (seller's PIN code; state when the branch has none)
 *   gstin               — services/einvoicePayload.ts, when the branch has no GSTIN of its own
 *   logo                — Accounting's invoice and payment receipt (InvoicePreview.jsx, ReceiptVoucher.jsx),
 *                         from the company settings Accounting saves (profile.companySettings.logo)
 * Payroll's PF, ESIC, PT and TDS filings read the numbers saved in Payroll's statutory setup
 * (services/payroll/statutoryRegistrations.ts; Form 16's TAN in form16.ts), not these.
 */

/* Shown, not edited: they come from Accounting (the company name and the head-office branch). */
export const FROM_ACCOUNTING = 'Changed in Books, where tax is worked out.';

/** [key, label, options]. `readOnly` fields are drawn as text; `used` is where the value appears. */
export const SECTIONS = [
  {
    key: 'identity',
    title: 'Identity',
    fields: [
      ['name', 'Name in CLOR', { readOnly: true, used: 'letters, emails to staff and the employee app' }],
      ['legalName', 'Legal name', { required: true, wide: true, used: 'Form 16, Form 24Q and e-invoices' }],
      ['cin', 'CIN / LLPIN', { mono: true }],
      ['industry', 'Industry'],
    ],
  },
  {
    key: 'address',
    title: 'Address',
    lede: 'The registered office, and how to reach the company.',
    fields: [
      ['addressLine', 'Address', { wide: true, used: 'e-invoices, when the branch has no GSTIN of its own' }],
      ['city', 'City', { used: 'e-invoices, when the branch has no GSTIN of its own' }],
      ['state', 'State', { readOnly: true, used: 'e-invoices, when the branch names none' }],
      ['pincode', 'PIN code', { mono: true, used: 'e-invoices' }],
      ['phone', 'Phone'],
      ['email', 'Email'],
      ['website', 'Website', { wide: true }],
    ],
  },
  {
    key: 'tax',
    title: 'Tax numbers',
    lede: 'Payroll’s PF, ESIC, PT and TDS filings use the numbers saved in Payroll’s statutory setup.',
    fields: [
      ['pan', 'Company PAN', { placeholder: 'e.g. AABCC1234D', mono: true, used: 'Form 16 and Form 24Q' }],
      ['tan', 'TAN', { placeholder: 'e.g. BLRC12345D', mono: true }],
      ['gstin', 'GSTIN', { readOnly: true, mono: true, empty: 'Not registered', used: 'e-invoices, when the branch has no GSTIN of its own' }],
      ['epfCode', 'EPF establishment code', { mono: true }],
      ['esicCode', 'ESIC employer code', { mono: true }],
      ['ptRegistration', 'Professional Tax registration', { mono: true }],
      ['lwfRegistration', 'Labour Welfare Fund registration', { mono: true }],
    ],
  },
];

export const LOGO = {
  title: 'Logo',
  used: 'invoices and payment receipts',
  where: 'Uploaded in Accounting’s company settings.',
};

/** The fields a person types into here (what Save sends and what "changed" compares). */
export const EDITABLE = SECTIONS.flatMap((s) => s.fields.filter(([, , o = {}]) => !o.readOnly).map(([k]) => k));

/** How many of a section's typed fields hold something. */
export const editableOf = (sec) => sec.fields.filter(([, , o = {}]) => !o.readOnly);
export const filled = (form, sec) => editableOf(sec).filter(([k]) => String(form?.[k] || '').trim()).length;

/** The body PUT /company-profile takes: the typed fields only. */
export const bodyOf = (form) => Object.fromEntries(EDITABLE.map((k) => [k, form?.[k] ?? '']));

/** Whether anything typed differs from what was loaded. */
export const isDirty = (form, saved) => Boolean(form && saved) && EDITABLE.some((k) => (form[k] || '') !== (saved[k] || ''));

/** "Used on: …" for a field's note. */
export const usedOn = (used) => (used ? `Used on: ${used}` : '');

/**
 * The company's logo, from GET /auth/me: the company settings Accounting saves sit in the org's
 * profile (routes/features.ts). Empty when none was uploaded.
 */
export const logoFromMe = (me, orgId) => {
  const row = (Array.isArray(me?.orgs) ? me.orgs : []).find((o) => String(o?.orgId) === String(orgId));
  const logo = row?.org?.profile?.companySettings?.logo;
  return typeof logo === 'string' ? logo.trim() : '';
};
