import React, { useState } from 'react';
import { createUser } from '../../api/admin';

export function UserCreateForm({ onCreated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '',
    username: '',
    fullName: '',
    password: '',
    orgIds: [],
    branchIdsByOrg: {},
  });

  const onChange = (k) => (e) => {
    setForm((p) => ({ ...p, [k]: e.target.value }));
    setError('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        email: form.email,
        username: form.username ? form.username : null,
        fullName: form.fullName,
        password: form.password,
        // Assign memberships later via separate UI (recommended)
        orgIds: form.orgIds,
        branchIdsByOrg: form.branchIdsByOrg,
      };
      const res = await createUser(payload);
      onCreated?.(res.user);
      setForm((p) => ({ ...p, email: '', username: '', fullName: '', password: '' }));
    } catch (err) {
      setError(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="ui-surface border rounded-xl p-5 space-y-4">
      <div className="ui-t-sec">Create User</div>
      {error ? <div className="text-sm text-[rgb(var(--neg))]">{error}</div> : null}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="ui-label" htmlFor="usercreateform-email-user-id">Email (User ID)</label>
          <input id="usercreateform-email-user-id" className="ui-input w-full" value={form.email} onChange={onChange('email')} required />
        </div>
        <div>
          <label className="ui-label" htmlFor="usercreateform-username-optional">Username (optional)</label>
          <input id="usercreateform-username-optional" className="ui-input w-full" value={form.username} onChange={onChange('username')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="ui-label" htmlFor="usercreateform-full-name">Full Name</label>
          <input id="usercreateform-full-name" className="ui-input w-full" value={form.fullName} onChange={onChange('fullName')} required />
        </div>
        <div>
          <label className="ui-label" htmlFor="usercreateform-password">Password</label>
          <input id="usercreateform-password" type="password" className="ui-input w-full" value={form.password} onChange={onChange('password')} required />
        </div>
      </div>

      <div className="text-xs ui-muted">
        Assign orgs/branches/roles using dedicated screens (recommended), so UI stays simple and permissions are server-enforced.
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50">
          {saving ? 'Saving…' : 'Create User'}
        </button>
      </div>
    </form>
  );
}
