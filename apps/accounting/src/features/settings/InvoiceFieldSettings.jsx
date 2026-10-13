import React, { useMemo, useState } from 'react';
import { ArrowLeft, Lock, Plus, Trash2, EyeOff, Eye } from 'lucide-react';

import { notify } from '@ui/components/ui/notify';
import {
  INVOICE_PREF_GROUPS,
  INVOICE_PREFS,
  INVOICE_INDUSTRIES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_FORM_PLACEMENTS,
  CUSTOM_FIELD_PRINT_PLACEMENTS,
  getInvoicePrefs,
  isInvoicePrefOn,
  saveInvoicePrefs,
  countPrefsOn,
  defaultInvoicePrefsFor,
  getCustomFields,
  saveCustomFields,
  nextCustomFieldKey,
  getInvoicePaymentDetails,
  saveInvoicePaymentDetails,
  listBankAccounts,
} from '@ui/utils/invoicePrefs';
import SettingsScreenHeader from './SettingsScreenHeader';

/**
 * Which fields an invoice carries, for this company.
 *
 * The industry is a starting point, not a mode: picking one sets every switch
 * to a sensible position and then gets out of the way. That matters because a
 * pharma distributor and an IT consultancy disagree about almost every field
 * on the document, and neither of them should have to scroll past the other's.
 *
 * Switching industry resets every switch, which is destructive enough to
 * confirm — a company that has tuned thirty switches and idly changes the
 * dropdown should not lose that silently.
 */
/**
 * @param pane  'fields' — the switches that decide which of the fields this
 *              product already knows about appear on an invoice.
 *              'custom' — only the fields this company invents for itself.
 *
 * These were one screen, and that was the complaint: a company looking for
 * "custom fields" had to scroll past ninety built-in switches to reach the
 * six lines that were actually theirs, which made the built-in switches look
 * like custom fields somebody else had already created for them. Two
 * destinations, two jobs.
 */
export const InvoiceFieldSettings = ({
  db,
  setDb,
  currentCompany,
  embedded = false,
  onBack = null,
  pane = 'fields',
  /* Which document's fields are being edited. A bill's custom fields are the
     bill's; the invoice list is not a shared pool every document draws from. */
  docType = 'invoice',
  docLabel = '',
}) => {
  const customOnly = pane === 'custom';
  const bankAccounts = useMemo(() => listBankAccounts(db, currentCompany.id), [db, currentCompany.id]);
  const payment = useMemo(() => getInvoicePaymentDetails(currentCompany), [currentCompany]);
  const prefs = useMemo(() => getInvoicePrefs(currentCompany), [currentCompany]);
  const customFields = useMemo(() => getCustomFields(currentCompany, docType), [currentCompany, docType]);
  const [pendingIndustry, setPendingIndustry] = useState('');
  const [draft, setDraft] = useState({
    label: '',
    type: 'Text',
    formPlacement: 'notes',
    printPlacement: 'none',
    required: false,
  });

  const write = (patch) =>
    setDb((prev) => ({ ...prev, companies: saveInvoicePrefs(prev, currentCompany.id, patch) }));

  const writePayment = (patch) =>
    setDb((prev) => ({ ...prev, companies: saveInvoicePaymentDetails(prev, currentCompany.id, patch) }));

  const writeCustom = (list) =>
    setDb((prev) => ({ ...prev, companies: saveCustomFields(prev, currentCompany.id, list, docType) }));

  const togglePref = (key, next) => write({ fields: { [key]: next } });

  const applyIndustry = () => {
    const target = pendingIndustry;
    const label = INVOICE_INDUSTRIES.find((i) => i.key === target)?.label || target;
    write({ industry: target });
    setPendingIndustry('');
    notify.success(`Invoice fields reset to the ${label} defaults.`);
  };

  const addCustomField = () => {
    const label = draft.label.trim();
    if (!label) {
      notify.error('Give the field a label first — that is what people will read on the form.');
      return;
    }
    if (customFields.some((f) => f.label.toLowerCase() === label.toLowerCase())) {
      notify.error(`“${label}” already exists. Two fields with one name is a support call waiting to happen.`);
      return;
    }
    const next = customFields.concat({
      key: nextCustomFieldKey(customFields, label),
      label,
      type: draft.type,
      formPlacement: draft.formPlacement,
      printPlacement: draft.printPlacement,
      required: draft.required,
      options: [],
      hidden: false,
    });
    writeCustom(next);
    setDraft({ label: '', type: 'Text', formPlacement: 'notes', printPlacement: 'none', required: false });
    notify.success(`“${label}” is on the invoice form now.`);
  };

  /**
   * Hiding keeps the values that existing invoices already carry and stops the
   * field appearing on new ones. Deleting throws away something somebody typed
   * on invoices that have already been sent, so it is the second offer.
   */
  const toggleHidden = (key) => {
    writeCustom(customFields.map((f) => (f.key === key ? { ...f, hidden: !f.hidden } : f)));
  };

  const removeCustomField = (key) => {
    const field = customFields.find((f) => f.key === key);
    if (!field) return;
    const ok = window.confirm(
      `Delete “${field.label}” permanently?\n\n` +
        'Invoices that already carry a value for it lose that value. ' +
        'Hiding it instead keeps those values and stops it appearing on new invoices.'
    );
    if (!ok) return;
    writeCustom(customFields.filter((f) => f.key !== key));
    notify.success(`“${field.label}” deleted.`);
  };

  const industryLabel = INVOICE_INDUSTRIES.find((i) => i.key === prefs.industry)?.label || prefs.industry;
  const onCount = INVOICE_PREFS.filter((p) => isInvoicePrefOn(prefs, p.key)).length;
  const pendingLabel = INVOICE_INDUSTRIES.find((i) => i.key === pendingIndustry)?.label || '';
  const pendingDiff = useMemo(() => {
    if (!pendingIndustry) return 0;
    const next = defaultInvoicePrefsFor(pendingIndustry);
    return INVOICE_PREFS.filter((p) => !p.locked && Boolean(next[p.key]) !== isInvoicePrefOn(prefs, p.key)).length;
  }, [pendingIndustry, prefs]);

  const header = embedded ? (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <button type="button" onClick={onBack} className="ui-btn ui-btn-ghost ui-btn-sm">
        {/* The drawer opens over a bill as well as an invoice, and said
            "invoice" either way. The caller already names the document. */}
        <ArrowLeft size={14} aria-hidden="true" /> Back to the {docLabel ? docLabel.toLowerCase() : 'invoice'}
      </button>
      <div className="flex items-center gap-2">
        <span className="ui-pill ui-pill-neutral">
          {onCount} of {INVOICE_PREFS.length} on
        </span>
        <button
          type="button"
          onClick={() => {
            write({ resetToIndustryDefault: true });
            notify.success(`Reset to the ${industryLabel} defaults.`);
          }}
          className="ui-btn ui-btn-secondary ui-btn-sm"
        >
          Reset to industry default
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {header}
      {embedded ? null : (
      <SettingsScreenHeader
        entity="settings"
        title={customOnly ? `Custom Fields${docLabel ? ` — ${docLabel}` : ''}` : 'Invoice Settings'}
        actions={
          <>
            {/* The way back to whatever opened this. It was only in `embedded`
                mode — the drawer — so reaching this screen from a More menu
                left no exit but the navigation rail. */}
            {onBack ? (
              <button type="button" onClick={onBack} className="ui-btn ui-btn-secondary">
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
            ) : null}
            {customOnly ? null : (
              <>
                <span className="ui-pill ui-pill-neutral">
                  {onCount} of {INVOICE_PREFS.length} on
                </span>
                <button
                  type="button"
                  onClick={() => {
                    write({ resetToIndustryDefault: true });
                    notify.success(`Reset to the ${industryLabel} defaults.`);
                  }}
                  className="ui-btn ui-btn-secondary"
                >
                  Reset to industry default
                </button>
              </>
            )}
          </>
        }
      />
      )}

      {customOnly ? null : (
      <section className={embedded ? 'p-4' : 'ui-card p-4'}>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <div>
            <label htmlFor="invoice-industry" className="ui-label">
              Industry
            </label>
            <select
              id="invoice-industry"
              value={pendingIndustry || prefs.industry}
              onChange={(e) => setPendingIndustry(e.target.value === prefs.industry ? '' : e.target.value)}
              className="ui-select w-full"
            >
              {INVOICE_INDUSTRIES.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </select>
            <p className="ui-caption mt-1">
              Sets the starting point. Every switch below stays yours to change afterwards.
            </p>
          </div>

          {pendingIndustry ? (
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <span className="ui-pill ui-pill-warn">
                {pendingDiff} switch{pendingDiff === 1 ? '' : 'es'} change
              </span>
              <button type="button" onClick={() => setPendingIndustry('')} className="ui-btn ui-btn-ghost">
                Cancel
              </button>
              <button type="button" onClick={applyIndustry} className="ui-btn ui-btn-primary">
                Switch to {pendingLabel}
              </button>
            </div>
          ) : null}
        </div>
      </section>
      )}

      {customOnly ? [] : INVOICE_PREF_GROUPS.map((group) => {
        const list = INVOICE_PREFS.filter((p) => p.group === group.key);
        const { on, total } = countPrefsOn(prefs, group.key);
        return (
          <section key={group.key} className={embedded ? 'overflow-hidden' : 'ui-card overflow-hidden'}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))', borderTop: embedded ? '1px solid rgb(var(--border))' : undefined }}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="ui-title text-sm">{group.label}</span>
                <span className="ui-subtle text-xs">
                  {on} of {total} on
                </span>
              </div>
              <div className="ui-subtle text-xs mt-0.5">{group.blurb}</div>
            </div>

            <div>
              {list.map((p, idx) => (
                <label
                  key={p.key}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                    p.locked ? 'cursor-default' : 'cursor-pointer hover:bg-[rgb(var(--surface-sunken))]'
                  }`}
                  style={idx ? { borderTop: '1px solid rgb(var(--border))' } : undefined}
                >
                  <input
                    type="checkbox"
                    className="ui-checkbox mt-1"
                    checked={isInvoicePrefOn(prefs, p.key)}
                    disabled={p.locked}
                    onChange={(e) => togglePref(p.key, e.target.checked)}
                    aria-describedby={`pref-${p.key}-desc`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="ui-title text-sm">{p.label}</span>
                      {p.locked ? (
                        <span className="ui-pill ui-pill-neutral">
                          <Lock size={10} aria-hidden="true" /> Always on
                        </span>
                      ) : (
                        <span className="ui-pill ui-pill-neutral">{p.kind}</span>
                      )}
                    </span>
                    <span id={`pref-${p.key}-desc`} className="ui-muted text-xs block mt-0.5">
                      {p.blurb}
                      {p.locked ? ' — it decides the tax split and what lands in the return, so it cannot be waived.' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        );
      })}

      {!customOnly && isInvoicePrefOn(prefs, 'bankQr') ? (
        <section className={embedded ? 'overflow-hidden' : 'ui-card overflow-hidden'}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))', borderTop: embedded ? '1px solid rgb(var(--border))' : undefined }}>
            <div className="ui-title text-sm">Payment details on the invoice</div>
            <div className="ui-subtle text-xs mt-0.5">
              Printed under the line items so the customer does not have to ask where to send the money. The account is
              a ledger, not a second copy — change it in the chart of accounts and the invoice follows.
            </div>
          </div>

          <div className="p-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="pay-bank" className="ui-label">
                Bank account to print
              </label>
              <select
                id="pay-bank"
                value={payment.bankAccountId}
                onChange={(e) => writePayment({ bankAccountId: e.target.value })}
                className="ui-select w-full"
              >
                <option value="">Do not print bank details</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.accountNumber}
                  </option>
                ))}
              </select>
              <p className="ui-caption mt-1">
                {bankAccounts.length
                  ? 'Name, number, branch and IFSC come from the ledger.'
                  : 'No bank ledger yet — add one under Chart of Accounts → Bank Accounts.'}
              </p>
            </div>

            <div>
              <label htmlFor="pay-upi" className="ui-label">
                UPI id
              </label>
              <input
                id="pay-upi"
                type="text"
                value={payment.upiId}
                onChange={(e) => writePayment({ upiId: e.target.value })}
                className="ui-input w-full"
                placeholder="business@hdfcbank"
                inputMode="email"
              />
              <p className="ui-caption mt-1">
                {payment.upiId && !payment.upiId.includes('@')
                  ? 'A UPI id looks like name@bank — no QR is printed until it does.'
                  : 'The QR carries the invoice amount, so nobody retypes it.'}
              </p>
            </div>

            <div>
              <label htmlFor="pay-payee" className="ui-label">
                Payee name on the QR
              </label>
              <input
                id="pay-payee"
                type="text"
                value={payment.payeeName}
                onChange={(e) => writePayment({ payeeName: e.target.value })}
                className="ui-input w-full"
                placeholder={currentCompany?.name || 'Company name'}
              />
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer mt-2">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={payment.showQr}
                  onChange={(e) => writePayment({ showQr: e.target.checked })}
                />
                Print the QR code
              </label>
            </div>
          </div>

          <div className="px-4 pb-4">
            <p className="ui-caption">
              The QR appears once the invoice is finalised. A draft's amount can still change, and a code that pays the
              wrong amount is worse than no code at all.
            </p>
          </div>
        </section>
      ) : null}

      {embedded || customOnly ? (
      <section className={embedded ? 'overflow-hidden' : 'ui-card overflow-hidden'}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))', borderTop: embedded ? '1px solid rgb(var(--border))' : undefined }}>
          <div className="flex items-baseline gap-2 flex-wrap" id="invoice-custom-fields">
            <span className="ui-title text-sm">Custom fields</span>
            <span className="ui-subtle text-xs">
              {customFields.length ? `${customFields.length} defined` : 'none yet'}
            </span>
          </div>
          <div className="ui-subtle text-xs mt-0.5">
            Fields you invent. Placement is asked twice because where a field sits on the form and where it belongs on
            the printed copy are different questions.
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="cf-label" className="ui-label">
                Field label
              </label>
              <input
                id="cf-label"
                type="text"
                value={draft.label}
                onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
                className="ui-input w-full"
                placeholder="Transporter & vehicle no."
              />
            </div>
            <div>
              <label htmlFor="cf-type" className="ui-label">
                Type
              </label>
              <select
                id="cf-type"
                value={draft.type}
                onChange={(e) => setDraft((p) => ({ ...p, type: e.target.value }))}
                className="ui-select w-full"
              >
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer pb-2">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={draft.required}
                  onChange={(e) => setDraft((p) => ({ ...p, required: e.target.checked }))}
                />
                Required
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="cf-form" className="ui-label">
                Placement on the form
              </label>
              <select
                id="cf-form"
                value={draft.formPlacement}
                onChange={(e) => setDraft((p) => ({ ...p, formPlacement: e.target.value }))}
                className="ui-select w-full"
              >
                {CUSTOM_FIELD_FORM_PLACEMENTS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cf-print" className="ui-label">
                Placement on the print
              </label>
              <select
                id="cf-print"
                value={draft.printPlacement}
                onChange={(e) => setDraft((p) => ({ ...p, printPlacement: e.target.value }))}
                className="ui-select w-full"
              >
                {CUSTOM_FIELD_PRINT_PLACEMENTS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button type="button" onClick={addCustomField} className="ui-btn ui-btn-primary">
                <Plus size={16} aria-hidden="true" /> Add field
              </button>
            </div>
          </div>
        </div>

        {customFields.length ? (
          <div style={{ borderTop: '1px solid rgb(var(--border))' }}>
            {customFields.map((f, idx) => (
              <div
                key={f.key}
                className="flex items-start gap-3 px-4 py-3"
                style={idx ? { borderTop: '1px solid rgb(var(--border))' } : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="ui-title text-sm">{f.label}</span>
                    <span className="ui-pill ui-pill-neutral">{f.type}</span>
                    {f.required ? <span className="ui-pill ui-pill-warn">Required</span> : null}
                    {f.hidden ? <span className="ui-pill ui-pill-neutral">Hidden</span> : null}
                  </span>
                  <span className="ui-muted text-xs block mt-0.5">
                    Form: {CUSTOM_FIELD_FORM_PLACEMENTS.find((p) => p.key === f.formPlacement)?.label}
                    {' · '}
                    Print: {CUSTOM_FIELD_PRINT_PLACEMENTS.find((p) => p.key === f.printPlacement)?.label}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => toggleHidden(f.key)}
                  className="ui-btn ui-btn-ghost ui-btn-sm"
      title={f.hidden ? 'Show on new invoices again' : 'Stop showing on new invoices, keep existing values'}
                >
                  {f.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                  {f.hidden ? 'Show' : 'Hide'}
                </button>
                <button
                  type="button"
                  onClick={() => removeCustomField(f.key)}
                  className="ui-btn ui-btn-ghost ui-btn-sm"
      title="Delete permanently"
                  aria-label={`Delete ${f.label}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>
      ) : null}

      <p className="ui-subtle text-xs">
        {customOnly
          ? 'A custom field appears on the invoice form as soon as it is created, and on the printed copy wherever you placed it. Deleting one leaves values already recorded on past invoices untouched.'
          : 'Switching a field off hides it on new and existing invoices; nothing already recorded is deleted. Turning it back on brings the values back with it.'}
      </p>
    </div>
  );
};

export default InvoiceFieldSettings;
