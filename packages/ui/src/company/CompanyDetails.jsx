import React, { useEffect, useState } from 'react';
import { apiFetch } from '@platform/http';
import { me } from '@platform/auth';
import { orgId as platformOrgId } from '@platform/context';
import { PageHeader, SkeletonCard } from '../components/ui/Primitives';
import { notify } from '../components/ui/notify';
import { SettingHelp } from '../picks/round64';
import { FROM_ACCOUNTING, LOGO, SECTIONS, bodyOf, isDirty, logoFromMe, usedOn } from './companyFields';
import './company.css';

/**
 * Settings → Company → Company details: who the employer is, as letters, Form 16 and e-invoices
 * quote it (server: routes/companyProfile.ts, the same record as Workspace → Company profile).
 *
 * Round 64 "companyprofile" A (owner, 19 Nov 2026): one page in four flat sections, Identity,
 * Address, Tax numbers and Logo, each a heading over a 2px rule (no cards), and each field saying
 * where it is used; companyFields.js says where each use was checked. The name, state, GSTIN and
 * logo come from Accounting, so they are shown, not edited.
 */
const url = () => `/orgs/${encodeURIComponent(platformOrgId())}/company-profile`;
const opts = { skipWarehouseHeader: true };

function Field({ k, label, o = {}, form, set }) {
  const note = usedOn(o.used);
  if (o.readOnly) {
    return (
      <div className={`ui-company-field${o.wide ? ' sm:col-span-2' : ''}`}>
        <span className="ui-label">{label}</span>
        <span className={`ui-company-value${o.mono ? ' ui-mono' : ''}`}>{form[k] || o.empty || '—'}</span>
        <span className="ui-caption block">{FROM_ACCOUNTING}</span>
        {note ? <span className="ui-caption block">{note}</span> : null}
      </div>
    );
  }
  return (
    <label className={`ui-company-field${o.wide ? ' sm:col-span-2' : ''}`}>
      <span className="ui-label">{label}{o.required ? <span aria-hidden="true" style={{ color: 'rgb(var(--neg))' }}> *</span> : null}</span>
      <input
        className={`ui-input w-full${o.mono ? ' ui-mono' : ''}`}
        value={form[k] || ''}
        onChange={set(k)}
        placeholder={o.placeholder || ''}
        required={Boolean(o.required)}
        spellCheck={o.mono ? false : undefined}
      />
      {note ? <span className="ui-caption mt-1 block">{note}</span> : null}
    </label>
  );
}

function Section({ id, title, help = null, lede, children }) {
  return (
    <section className="ui-company-sec" aria-labelledby={id}>
      <header>
        <h2 id={id} className="ui-t-sec inline-flex items-center gap-1">{title}{help}</h2>
      </header>
      {lede ? <p className="ui-caption">{lede}</p> : null}
      {children}
    </section>
  );
}

export default function CompanyDetails() {
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
      .catch((e) => setError(String(e?.message || 'Could not load the company details.')));
    /* The logo lives in Accounting's company settings; the page works without it. */
    me()
      .then((r) => setLogo(logoFromMe(r, platformOrgId())))
      .catch(() => {});
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await apiFetch(url(), { ...opts, method: 'PUT', body: bodyOf(form) });
      setForm(r.company);
      setSaved(r.company);
      notify.success('Company details saved.');
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company details"
        description="Who the company is, on its letters, tax forms and invoices."
        actions={form ? <button type="submit" form="company-details" className="ui-btn ui-btn-primary" disabled={saving || !isDirty(form, saved)}>{saving ? 'Saving…' : 'Save changes'}</button> : null}
      />
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!form ? (
        error ? null : <SkeletonCard lines={8} />
      ) : (
        <form id="company-details" onSubmit={save} className="ui-company-page">
          {SECTIONS.map((sec) => (
            <Section
              key={sec.key}
              id={`company-${sec.key}`}
              title={sec.title}
              lede={sec.lede}
              help={sec.key === 'tax' ? <SettingHelp topic="company-branches" label="the tax numbers" /> : null}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {sec.fields.map(([k, label, o]) => <Field key={k} k={k} label={label} o={o} form={form} set={set} />)}
              </div>
            </Section>
          ))}
          <Section id="company-logo" title={LOGO.title}>
            <div className="ui-company-logo">
              {logo ? (
                <span className="ui-company-logo-box"><img src={logo} alt={`${form.name || 'Company'} logo`} /></span>
              ) : (
                <span className="ui-company-value">No logo yet</span>
              )}
              <span>
                <span className="ui-caption block">{LOGO.where}</span>
                <span className="ui-caption block">{usedOn(LOGO.used)}</span>
              </span>
            </div>
          </Section>
        </form>
      )}
    </div>
  );
}
