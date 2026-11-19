import React, { useEffect, useState } from 'react';
import { emoji } from '@ui/components/ui/emoji';
import { Save } from '@ui/components/ui/lineIcons';

import { apiFetch } from '@platform/http';
import { me } from '@platform/auth';
import { orgId as platformOrgId } from '@platform/context';
import { notify } from '@ui/components/ui/notify';
import { FROM_ACCOUNTING, LOGO, SECTIONS, bodyOf, editableOf, filled, isDirty, logoFromMe, usedOn } from '@ui/company/companyFields';
import { Loading, PageHead } from './wsKit';
import './workspace.css';
import './ws-security.css';

/* This page's colour icon, the one its menu item wears. */
const PAGE_ICON = emoji('office-building');

/**
 * Workspace → Company → Company profile.
 *
 * Who the company is, as letters, Form 16 and e-invoices name it (server: routes/companyProfile.ts,
 * the same record People's Company details edits). Round 64 "companyprofile" A: one page in four
 * flat sections, Identity, Address, Tax numbers and Logo, each a heading over a 2px rule, and each
 * field saying where it is used (packages/ui/src/company/companyFields.js says where that was
 * checked). The name, state and GSTIN come from Accounting, so they are shown, not edited; so is
 * the logo, which Accounting's company settings upload.
 */
const url = () => `/orgs/${encodeURIComponent(platformOrgId())}/company-profile`;
const opts = { skipWarehouseHeader: true };

function Field({ k, label, o = {}, form, set }) {
  const note = usedOn(o.used);
  if (o.readOnly) {
    return (
      <div className={`ws-cp-field${o.wide ? ' ws-cp-wide' : ''}`}>
        <span className="ws-cp-label">{label}</span>
        <span className={`ws-cp-value${o.mono ? ' ui-mono' : ''}`}>{form[k] || o.empty || '—'}</span>
        <span className="ws-cp-note">{FROM_ACCOUNTING}</span>
        {note ? <span className="ws-cp-note">{note}</span> : null}
      </div>
    );
  }
  return (
    <label className={`ws-cp-field${o.wide ? ' ws-cp-wide' : ''}`}>
      <span className="ws-cp-label">{label}{o.required ? <span aria-hidden="true"> *</span> : null}</span>
      <input
        className={`ui-input w-full ${o.mono ? 'ui-mono' : ''}`}
        value={form[k] || ''}
        onChange={set(k)}
        placeholder={o.placeholder || ''}
        required={Boolean(o.required)}
        spellCheck={o.mono ? false : undefined}
      />
      {note ? <span className="ws-cp-note">{note}</span> : null}
    </label>
  );
}

export default function CompanyProfile() {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [logo, setLogo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch(url(), opts)
      .then((r) => {
        setForm(r.company);
        setSaved(r.company);
      })
      .catch((e) => setError(String(e?.message || 'Could not load the company profile.')));
    /* The logo lives in Accounting's company settings; a page without it still works. */
    me()
      .then((r) => setLogo(logoFromMe(r, platformOrgId())))
      .catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = isDirty(form, saved);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await apiFetch(url(), { ...opts, method: 'PUT', body: bodyOf(form) });
      setForm(r.company);
      setSaved(r.company);
      notify.success('Company profile saved.');
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Home', 'Company profile']}
          icon={PAGE_ICON}
          title={form?.name || 'Company profile'}
          description="Who the company is, on its letters, tax forms and invoices."
          actions={
            form ? (
              <button type="submit" form="company-profile" className="ws-btn ws-btn--primary" disabled={saving || !dirty}>
                <Save size={16} aria-hidden="true" /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            ) : null
          }
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {!form ? (
          error ? null : <Loading shape="card" rows={3} label="Loading the company profile…" />
        ) : (
          <form id="company-profile" onSubmit={save} className="ws-profile ws-cp" noValidate={false}>
            {SECTIONS.map((sec) => {
              const typed = editableOf(sec).length;
              return (
                <section key={sec.key} className="ws-sec-section" aria-labelledby={`cp-sec-${sec.key}`}>
                  <div className="ws-sec-section-head">
                    <h2 id={`cp-sec-${sec.key}`} className="ws-h2">{sec.title}</h2>
                    <span className="ws-head-meta">{filled(form, sec)} of {typed} filled in</span>
                  </div>
                  {sec.lede ? <p className="ws-sec-lede">{sec.lede}</p> : null}
                  <div className="ws-sec-body ws-cp-grid">
                    {sec.fields.map(([k, label, o]) => <Field key={k} k={k} label={label} o={o} form={form} set={set} />)}
                  </div>
                </section>
              );
            })}

            <section className="ws-sec-section" aria-labelledby="cp-sec-logo">
              <div className="ws-sec-section-head">
                <h2 id="cp-sec-logo" className="ws-h2">{LOGO.title}</h2>
              </div>
              <div className="ws-sec-body">
                <div className="ws-cp-logo">
                  {logo ? (
                    <span className="ws-cp-logo-box"><img src={logo} alt={`${form.name || 'Company'} logo`} /></span>
                  ) : (
                    <span className="ws-cp-value">No logo yet</span>
                  )}
                  <span className="ws-cp-logo-text">
                    <span className="ws-cp-note">{LOGO.where}</span>
                    <span className="ws-cp-note">{usedOn(LOGO.used)}</span>
                  </span>
                </div>
              </div>
            </section>
          </form>
        )}
      </div>
    </div>
  );
}
