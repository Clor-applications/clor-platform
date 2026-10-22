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

const SECTIONS = [
  { title: 'Identity', fields: [['legalName', 'Legal name', { required: true }], ['pan', 'Company PAN', { placeholder: 'AABCC1234D' }], ['tan', 'TAN', { placeholder: 'BLRC12345D' }], ['cin', 'CIN / LLPIN'], ['industry', 'Industry']] },
  { title: 'Registered address and contact', fields: [['addressLine', 'Address', { wide: true }], ['city', 'City'], ['pincode', 'PIN code'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website']] },
  { title: 'Statutory registrations', note: 'Quoted on PF, ESIC, Professional Tax and Labour Welfare Fund returns.', fields: [['epfCode', 'EPF establishment code'], ['esicCode', 'ESIC employer code'], ['ptRegistration', 'Professional Tax registration'], ['lwfRegistration', 'Labour Welfare Fund registration']] },
];

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
    <div className="space-y-3">
      <PageHeader
        entity="settings"
        title="Company Details"
        description="Who the employer is, as letters, payslips and statutory returns name it."
      />
      {error ? <p className="ui-card p-4 text-sm" role="alert">{error}</p> : null}
      {!form ? (
        error ? null : <SkeletonCard lines={8} />
      ) : (
        <form onSubmit={save} className="space-y-4 pb-8">
          <section className="ui-card p-4 grid gap-4 sm:grid-cols-3" aria-label="Company">
            <div><span className="ui-label">Name in CLOR</span><p className="text-sm font-medium">{form.name}</p></div>
            <div><span className="ui-label">State</span><p className="text-sm">{form.state || '—'}</p></div>
            <div><span className="ui-label">GSTIN</span><p className="text-sm">{form.gstin || '—'}</p><p className="ui-caption">Changed in Accounting, where tax is worked out.</p></div>
          </section>
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="ui-card p-4 space-y-3" aria-label={sec.title}>
              <div>
                <h2 className="ui-t-sec">{sec.title}</h2>
                {sec.note ? <p className="ui-caption">{sec.note}</p> : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {sec.fields.map(([k, label, o = {}]) => (
                  <label key={k} className={`block ${o.wide ? 'sm:col-span-2' : ''}`}>
                    <span className="ui-label">{label}{o.required ? ' *' : ''}</span>
                    <input className="ui-input w-full" value={form[k] || ''} onChange={set(k)} placeholder={o.placeholder || ''} required={Boolean(o.required)} />
                  </label>
                ))}
              </div>
            </section>
          ))}
          <div className="flex justify-end">
            <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save company details'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
