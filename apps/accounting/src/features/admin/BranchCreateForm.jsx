import React, { useMemo, useState } from 'react';
import { createBranch } from '../../api/admin';
import { notify } from '@ui/components/ui/notify';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';

export function BranchCreateForm({ orgId, onCreated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    branchCode: '',
    branchName: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    country: 'India',
    gstRegistrationType: 'UNREGISTERED',
    gstin: '',
    phone: '',
    email: '',
    contactPerson: '',
    parentBranchId: '',
    shareHeadOfficeSettings: false,
  });

  const onChange = (k) => (e) => {
    const v = e?.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'gstin') {
      const maybeState = getGstStateFromGstin(String(v || '').trim());
      setForm((p) => ({ ...p, gstin: v, state: maybeState ? maybeState : p.state }));
      setError('');
      return;
    }
    setForm((p) => ({ ...p, [k]: v }));
    setError('');
  };

  const stateOptions = useMemo(() => {
    return Object.keys(GST_STATE_BY_CODE || {})
      .sort()
      .map((code) => ({
        code,
        value: String(GST_STATE_BY_CODE[code] || '').trim(),
        label: String(GST_STATE_BY_CODE[code] || '').trim(),
      }))
      .filter((o) => o.value);
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!String(form.state || '').trim()) {
      setError('State is required — pick the branch state.');
      notify.error('State is required — pick the branch state.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        parentBranchId: form.parentBranchId ? form.parentBranchId : null,
        gstin: form.gstin ? form.gstin : null,
        email: form.email ? form.email : null,
        phone: form.phone ? form.phone : null,
        contactPerson: form.contactPerson ? form.contactPerson : null,
      };
      const res = await createBranch(orgId, payload);
      onCreated?.(res.branch);
      notify.success(`Branch "${payload.branchName}" created.`);
      setForm((p) => ({ ...p, branchCode: '', branchName: '' }));
    } catch (err) {
      setError(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="ui-surface border rounded-xl p-5 space-y-4">
      <div className="ui-t-sec">Create Branch</div>

      {error ? <div className="text-sm text-[rgb(var(--neg))]">{error}</div> : null}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 sm:col-span-4">
          <label className="ui-label" htmlFor="branchcreateform-branch-code">Branch Code</label>
          <input id="branchcreateform-branch-code" className="ui-input w-full max-w-40" value={form.branchCode} onChange={onChange('branchCode')} required />
        </div>
        <div className="col-span-12 sm:col-span-8">
          <label className="ui-label" htmlFor="branchcreateform-branch-name">Branch Name</label>
          <input id="branchcreateform-branch-name" className="ui-input w-full" value={form.branchName} onChange={onChange('branchName')} required />
        </div>
      </div>

      <div>
        <label className="ui-label" htmlFor="branchcreateform-address">Address</label>
        <input id="branchcreateform-address" className="ui-input w-full" value={form.addressLine1} onChange={onChange('addressLine1')} required />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="ui-label" htmlFor="branchcreateform-city">City</label>
          <input id="branchcreateform-city" className="ui-input w-full" value={form.city} onChange={onChange('city')} />
        </div>
        <div>
          <PopupSelect
            label="State"
            value={form.state}
            onChange={(v) => {
              setForm((p) => ({ ...p, state: v }));
              setError('');
            }}
            options={stateOptions}
            placeholder="Select state"
      title="Select State"
            maxWidthClass="max-w-2xl"
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="branchcreateform-country">Country</label>
          <input id="branchcreateform-country" className="ui-input w-full" value={form.country} onChange={onChange('country')} required />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="ui-label" htmlFor="branchcreateform-gst-registration">GST Registration</label>
          <select id="branchcreateform-gst-registration" className="ui-select w-full" value={form.gstRegistrationType} onChange={onChange('gstRegistrationType')}>
            <option value="REGULAR">Regular</option>
            <option value="COMPOSITION">Composition</option>
            <option value="UNREGISTERED">Unregistered</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="ui-label" htmlFor="branchcreateform-gstin">GSTIN</label>
          <input id="branchcreateform-gstin" className="ui-input w-full" value={form.gstin} onChange={onChange('gstin')} placeholder="15-char GSTIN" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="ui-label" htmlFor="branchcreateform-phone">Phone</label>
          <input id="branchcreateform-phone" className="ui-input w-full" value={form.phone} onChange={onChange('phone')} />
        </div>
        <div>
          <label className="ui-label" htmlFor="branchcreateform-email">Email</label>
          <input id="branchcreateform-email" className="ui-input w-full" value={form.email} onChange={onChange('email')} />
        </div>
        <div>
          <label className="ui-label" htmlFor="branchcreateform-contact-person">Contact Person</label>
          <input id="branchcreateform-contact-person" className="ui-input w-full" value={form.contactPerson} onChange={onChange('contactPerson')} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.shareHeadOfficeSettings} onChange={onChange('shareHeadOfficeSettings')} />
        Share ledgers and settings of head office
      </label>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50">
          {saving ? 'Saving…' : 'Create Branch'}
        </button>
      </div>
    </form>
  );
}
