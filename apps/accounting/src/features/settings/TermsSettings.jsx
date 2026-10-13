import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { notify } from '@ui/components/ui/notify';
import { getDocSettings } from '@ui/utils/docSettings';
import SettingsScreenHeader from './SettingsScreenHeader';

/**
 * Only the documents this product can actually print.
 *
 * Terms are stored for all eight voucher types, but three of them have a print
 * view: invoice, bill and expense voucher. Offering a terms box for an estimate
 * or a credit note would take wording somebody typed and put it nowhere — the
 * screen would look complete and the paper would not change.
 *
 * When those documents get print views, add them here.
 */
const PRINTABLE = [
  { key: 'invoice', label: 'Invoice' },
  { key: 'bill', label: 'Purchase Bill' },
  { key: 'expense', label: 'Expense Voucher' },
];

/**
 * The small print that goes on the bottom of a printed document.
 *
 * The storage has always held terms per document type — `ensureTemplate`
 * preserves whatever is on a template, and the invoice preview reads
 * `templates.invoice.termsText` and prints it. Only the invoice ever had a box
 * to type it into, and that box was on the Templates screen behind a font and
 * an accent colour, so seven of the eight document types could hold terms that
 * nothing could set.
 *
 * An estimate wants different words from an invoice — a quote's validity
 * against an invoice's interest clause — so this is per document, not one
 * shared block. "Copy from invoice" exists because in practice most of them
 * end up saying the same thing.
 */
export const TermsSettings = ({ db, setDb, currentCompany }) => {
  const [draft, setDraft] = useState(() => {
    const s = getDocSettings(db, currentCompany);
    const out = {};
    for (const v of PRINTABLE) out[v.key] = String(s.templates?.[v.key]?.termsText || '');
    return out;
  });
  const [savedAt, setSavedAt] = useState(0);

  const initial = (() => {
    const s = getDocSettings(db, currentCompany);
    const out = {};
    for (const v of PRINTABLE) out[v.key] = String(s.templates?.[v.key]?.termsText || '');
    return out;
  })();
  const dirty = PRINTABLE.some((v) => draft[v.key] !== initial[v.key]);

  const save = () => {
    setDb({
      ...db,
      companies: db.companies.map((c) => {
        if (c.id !== currentCompany.id) return c;
        // Merge onto what is stored, not onto the normalised read. getDocSettings
        // fills in every default; writing that back would bake today's defaults
        // into the record and stop future default changes reaching this company.
        const baseDoc = c?.docSettings && typeof c.docSettings === 'object' ? c.docSettings : {};
        const templates = { ...(baseDoc.templates || {}) };
        for (const v of PRINTABLE) {
          templates[v.key] = { ...(templates[v.key] || {}), termsText: draft[v.key] };
        }
        return { ...c, docSettings: { ...baseDoc, templates } };
      }),
    });
    setSavedAt(Date.now());
    notify.success('Terms saved. They print on the documents you set them for.');
  };

  const copyFromInvoice = (targetKey) => {
    setDraft((p) => ({ ...p, [targetKey]: p.invoice }));
  };

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Terms & Conditions"
        actions={
          <>
            {dirty ? <span className="ui-pill ui-pill-warn">Unsaved changes</span> : null}
            {!dirty && savedAt ? (
              <span className="ui-pill ui-pill-pos" role="status">
                <Check size={11} aria-hidden="true" /> Saved
              </span>
            ) : null}
            <button type="button" onClick={save} disabled={!dirty} className="ui-btn ui-btn-primary disabled:opacity-50">
              Save
            </button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {PRINTABLE.map((v) => (
          <div key={v.key} className="ui-card p-4 space-y-2">
            <div className="flex items-baseline gap-3">
              <span className="ui-t-label">{v.label}</span>
              {v.key !== 'invoice' ? (
                <button
                  type="button"
                  onClick={() => copyFromInvoice(v.key)}
                  className="ui-btn ui-btn-ghost ui-btn-sm ml-auto"
      title="Use the same wording as the invoice"
                >
                  <Copy size={14} aria-hidden="true" /> Copy from invoice
                </button>
              ) : null}
            </div>
            <textarea
              value={draft[v.key]}
              onChange={(e) => setDraft((p) => ({ ...p, [v.key]: e.target.value }))}
              className="ui-input w-full"
              rows={4}
              placeholder={
                v.key === 'estimate'
                  ? 'e.g. This quotation is valid for 15 days from the date above.'
                  : '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. on overdue amounts.'
              }
            />
            <p className="ui-caption">
              {draft[v.key].trim()
                ? `${draft[v.key].trim().split('\n').filter(Boolean).length} line(s) — prints on every ${v.label.toLowerCase()}.`
                : 'Nothing set — this document prints without a terms block.'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TermsSettings;
