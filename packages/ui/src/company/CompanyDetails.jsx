import React, { useEffect, useState } from 'react';
import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { PageHeader, SkeletonCard } from '../components/ui/Primitives';
import { notify } from '../components/ui/notify';

/**
 * Settings → Company → Company Details: who the employer is, as letters,
 * statutory forms and payslips quote it (server: routes/companyProfile.ts).
 * GSTIN and state come from the head-office branch, which Accounting owns.
 */
const url = () => `/orgs/${encodeURIComponent(platformOrgId())}/company-profile`;
const opts = { skipWarehouseHeader: true };

/*
 * R&D PEOPLE-29: plain sections on the page ground (no cards), two columns of fields, the side column for contact.
 * GSTIN and state are shown read-only where the design puts them; Accounting owns them.
 */
const MAIN = [
  { title: 'Legal', fields: [['legalName', 'Legal name', { required: true, wide: true }], ['industry', 'Industry'], ['cin', 'CIN / LLPIN'], ['pan', 'PAN', { placeholder: 'AABCC1234D' }], ['tan', 'TAN', { placeholder: 'BLRC12345D' }], ['gstin', 'GSTIN', { readOnly: 'Changed in Accounting, where tax is worked out.' }], ['epfCode', 'PF establishment code'], ['esicCode', 'ESIC code'], ['ptRegistration', 'PT registration'], ['lwfRegistration', 'Labour Welfare Fund registration']] },
  { title: 'Registered office', fields: [['addressLine', 'Address', { wide: true }], ['city', 'City'], ['state', 'State', { readOnly: 'Comes from the head office in Accounting.' }], ['pincode', 'PIN code']] },
];
const SIDE = [
  { title: 'Contact', fields: [['phone', 'Phone'], ['email', 'Email'], ['website', 'Website']] },
];

function Field({ k, label, o = {}, form, set }) {
  return (
    <label className={`block ${o.wide ? 'sm:col-span-2' : ''}`}>
      <span className="ui-label">{label}{o.required ? <span aria-hidden="true" style={{ color: 'rgb(var(--neg))' }}> *</span> : null}</span>
      <input
        className="ui-input w-full"
        value={form[k] || ''}
        onChange={o.readOnly ? undefined : set(k)}
        readOnly={Boolean(o.readOnly)}
        aria-readonly={o.readOnly ? 'true' : undefined}
        placeholder={o.readOnly ? '—' : o.placeholder || ''}
        required={Boolean(o.required)}
        style={o.readOnly ? { background: 'rgb(var(--surface-sunken))' } : undefined}
      />
      {o.readOnly ? <span className="ui-caption mt-1 block">{o.readOnly}</span> : null}
    </label>
  );
}

export default function CompanyDetails() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    apiFetch(url(), opts)
      .then((r) => setForm(r.company))
      .catch((e) => setError(String(e?.message || 'Could not load the company details.')));
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { state: _s, gstin: _g, name: _n, code: _c, ...body } = form;
      const r = await apiFetch(url(), { ...opts, method: 'PUT', body });
      setForm(r.company);
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
        description="Shown on letters, payslips and statutory returns."
        actions={form ? <button type="submit" form="company-details" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button> : null}
      />
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!form ? (
        error ? null : <SkeletonCard lines={8} />
      ) : (
        <form id="company-details" onSubmit={save} className="grid gap-8 pb-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-8 min-w-0">
            {MAIN.map((sec) => (
              <section key={sec.title} className="space-y-3" aria-label={sec.title}>
                <h2 className="ui-t-sec">{sec.title}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {sec.fields.map(([k, label, o]) => <Field key={k} k={k} label={label} o={o} form={form} set={set} />)}
                </div>
              </section>
            ))}
          </div>
          <aside className="space-y-8 min-w-0">
            <section className="space-y-3" aria-label="Name in CLOR">
              <h2 className="ui-t-sec">Name in CLOR</h2>
              <p className="text-sm font-medium">{form.name}</p>
              <p className="ui-caption">The name people see in the app and the company switcher.</p>
            </section>
            {SIDE.map((sec) => (
              <section key={sec.title} className="space-y-3" aria-label={sec.title}>
                <h2 className="ui-t-sec">{sec.title}</h2>
                <div className="grid gap-4">
                  {sec.fields.map(([k, label, o]) => <Field key={k} k={k} label={label} o={o} form={form} set={set} />)}
                </div>
              </section>
            ))}
          </aside>
        </form>
      )}
    </div>
  );
}
