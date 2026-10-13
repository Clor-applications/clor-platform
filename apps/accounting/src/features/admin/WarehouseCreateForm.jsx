import React, { useState } from 'react';
import { createWarehouse } from '../../api/admin';

export function WarehouseCreateForm({ orgId, branches = [], onCreated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    branchId: '',
    name: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    country: 'India',
    gstRegistrationType: 'UNREGISTERED',
    gstin: '',
    contactPerson: '',
    phone: '',
    email: '',
  });

  const onChange = (k) => (e) => {
    const v = e?.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((p) => ({ ...p, [k]: v }));
    setError('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        gstin: form.gstin ? form.gstin : null,
        contactPerson: form.contactPerson ? form.contactPerson : null,
        phone: form.phone ? form.phone : null,
        email: form.email ? form.email : null,
        state: form.state || null,
        city: form.city || null,
        addressLine1: form.addressLine1 || null,
        addressLine2: form.addressLine2 || null,
        country: form.country || null,
      };
      const res = await createWarehouse(orgId, payload);
      onCreated?.(res.warehouse);
      setForm((p) => ({ ...p, name: '', gstin: '' }));
    } catch (err) {
      setError(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="ui-surface border rounded-xl p-5 space-y-4">
      <div className="ui-t-sec">Create Warehouse</div>
      {error ? <div className="text-sm text-[rgb(var(--neg))]">{error}</div> : null}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-branch">Branch</label>
          <select id="warehousecreateform-branch" className="ui-select w-full" value={form.branchId} onChange={onChange('branchId')} required>
            <option value="">Select branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.branchName || b.name || b.code || 'Branch'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-warehouse-name">Warehouse Name</label>
          <input id="warehousecreateform-warehouse-name" className="ui-input w-full" value={form.name} onChange={onChange('name')} required />
        </div>
      </div>

      <div>
        <label className="ui-label" htmlFor="warehousecreateform-address">Address</label>
        <input id="warehousecreateform-address" className="ui-input w-full" value={form.addressLine1} onChange={onChange('addressLine1')} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-city">City</label>
          <input id="warehousecreateform-city" className="ui-input w-full" value={form.city} onChange={onChange('city')} />
        </div>
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-state">State</label>
          <input id="warehousecreateform-state" className="ui-input w-full" value={form.state} onChange={onChange('state')} />
        </div>
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-country">Country</label>
          <input id="warehousecreateform-country" className="ui-input w-full" value={form.country} onChange={onChange('country')} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-gst-registration">GST Registration</label>
          <select id="warehousecreateform-gst-registration" className="ui-select w-full" value={form.gstRegistrationType} onChange={onChange('gstRegistrationType')}>
            <option value="REGULAR">Regular</option>
            <option value="COMPOSITION">Composition</option>
            <option value="UNREGISTERED">Unregistered</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="ui-label" htmlFor="warehousecreateform-gstin">GSTIN</label>
          <input id="warehousecreateform-gstin" className="ui-input w-full" value={form.gstin} onChange={onChange('gstin')} placeholder="15-char GSTIN" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-phone">Phone</label>
          <input id="warehousecreateform-phone" className="ui-input w-full" value={form.phone} onChange={onChange('phone')} />
        </div>
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-email">Email</label>
          <input id="warehousecreateform-email" className="ui-input w-full" value={form.email} onChange={onChange('email')} />
        </div>
        <div>
          <label className="ui-label" htmlFor="warehousecreateform-contact-person">Contact Person</label>
          <input id="warehousecreateform-contact-person" className="ui-input w-full" value={form.contactPerson} onChange={onChange('contactPerson')} />
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50">
          {saving ? 'Saving…' : 'Create Warehouse'}
        </button>
      </div>
    </form>
  );
}
