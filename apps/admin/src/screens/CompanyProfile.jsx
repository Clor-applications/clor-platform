import React, { useEffect, useState } from 'react';
import { Check, Save } from 'lucide-react';

import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';
import { notify } from '@ui/components/ui/notify';
import { ICON, PageHead, Panel } from './wsKit';
import './workspace.css';

/**
 * Workspace → Company → Company profile (redesign W-R5).
 *
 * Who the company is, as letters, payslips and statutory returns name it
 * (server: routes/companyProfile.ts — the same record People's Company
 * details edits). GSTIN and state come from the head-office branch, which
 * Accounting owns, so they are shown, not edited. The side column counts what
 * is filled in from the record itself; nothing is estimated.
 */
const url = () => `/orgs/${encodeURIComponent(platformOrgId())}/company-profile`;
const opts = { skipWarehouseHeader: true };

export const SECTIONS = [
  { key: 'identity', title: 'Identity', fields: [['legalName', 'Legal name', { required: true, wide: true }], ['pan', 'Company PAN', { placeholder: 'AABCC1234D', mono: true }], ['tan', 'TAN', { placeholder: 'BLRC12345D', mono: true }], ['cin', 'CIN / LLPIN', { mono: true }], ['industry', 'Industry']] },
  { key: 'address', title: 'Registered address and contact', fields: [['addressLine', 'Address', { wide: true }], ['city', 'City'], ['pincode', 'PIN code', { mono: true }], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website', { wide: true }]] },
  { key: 'statutory', title: 'Statutory registrations', fields: [['epfCode', 'EPF establishment code', { mono: true }], ['esicCode', 'ESIC employer code', { mono: true }], ['ptRegistration', 'Professional Tax registration', { mono: true }], ['lwfRegistration', 'Labour Welfare Fund registration', { mono: true }]] },
];

/** How many of a section's fields hold something. */
export const filled = (form, sec) => sec.fields.filter(([k]) => String(form?.[k] || '').trim()).length;

export default function CompanyProfile() {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch(url(), opts)
      .then((r) => {
        setForm(r.company);
        setSaved(r.company);
      })
      .catch((e) => setError(String(e?.message || 'Could not load the company profile.')));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = Boolean(form && saved) && SECTIONS.some((s) => s.fields.some(([k]) => (form[k] || '') !== (saved[k] || '')));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { state: _s, gstin: _g, name: _n, code: _c, ...body } = form;
      const r = await apiFetch(url(), { ...opts, method: 'PUT', body });
      setForm(r.company);
      setSaved(r.company);
      notify.success('Company profile saved.');
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const total = SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  const done = form ? SECTIONS.reduce((n, s) => n + filled(form, s), 0) : 0;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Company', 'Company profile']}
          title={form?.name || 'Company profile'}
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
          error ? null : <p className="ws-card-blurb">Loading the company profile…</p>
        ) : (
          <div className="ws-layout">
            <form id="company-profile" onSubmit={save} className="grid gap-5 min-w-0" noValidate={false}>
              {SECTIONS.map((sec) => (
                <Panel key={sec.key} title={sec.title} action={<span className="ws-head-meta">{filled(form, sec)} of {sec.fields.length}</span>}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {sec.fields.map(([k, label, o = {}]) => (
                      <label key={k} className={`grid gap-1 ${o.wide ? 'sm:col-span-2' : ''}`}>
                        <span className="text-sm font-medium">{label}{o.required ? <span aria-hidden="true"> *</span> : null}</span>
                        <input
                          className={`ui-input w-full ${o.mono ? 'ui-mono' : ''}`}
                          value={form[k] || ''}
                          onChange={set(k)}
                          placeholder={o.placeholder || ''}
                          required={Boolean(o.required)}
                          spellCheck={o.mono ? false : undefined}
                        />
                      </label>
                    ))}
                  </div>
                </Panel>
              ))}
            </form>

            <aside className="ws-side">
              <Panel title="From Accounting">
                <dl className="grid gap-3">
                  <div>
                    <dt className="ws-stat-note">Name in CLOR</dt>
                    <dd className="text-sm font-medium">{form.name || '—'}</dd>
                  </div>
                  <div>
                    <dt className="ws-stat-note">State</dt>
                    <dd className="text-sm">{form.state || '—'}</dd>
                  </div>
                  <div>
                    <dt className="ws-stat-note">GSTIN</dt>
                    <dd className="text-sm ui-mono">{form.gstin || 'Not registered'}</dd>
                  </div>
                </dl>
                <p className="ws-card-blurb">Changed in Accounting, where tax is worked out.</p>
              </Panel>
              <Panel title="Filled in">
                <div className="ws-meter">
                  <div className="ws-meter-row">
                    <span>Profile</span>
                    <strong>{done} / {total}</strong>
                  </div>
                  <div className="ws-meter-bar" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Profile fields filled in">
                    <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
                  </div>
                </div>
                <ul className="ws-list">
                  {SECTIONS.map((sec) => {
                    const n = filled(form, sec);
                    const complete = n === sec.fields.length;
                    return (
                      <li key={sec.key}>
                        <div className="ws-item">
                          <span className={`ws-tile ws-tile--sm${complete ? '' : ' ws-tile--warn'}`} aria-hidden="true">
                            {complete ? <Check size={14} /> : <ICON.warning size={14} />}
                          </span>
                          <span className="ws-item-text">
                            <span className="ws-item-title">{sec.title}</span>
                            <span className="ws-item-sub">{complete ? 'Complete' : `${sec.fields.length - n} left`}</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
