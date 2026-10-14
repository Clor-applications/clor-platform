import React, { useMemo, useEffect, useRef, useState } from 'react';
import { TableSkeleton } from '@ui/components/ui/Primitives';
import { exportRows } from '@ui/components/ListToolbar';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listBranches, createBranch, updateBranch, deleteBranch } from '../../api/admin';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import Popover from '@ui/components/ui/Popover';
import { Download, MoreVertical, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import { PermissionButton } from '@ui/permissions/ActionGuard';

export function SettingsBranches({ orgId, company, onBranchesChanged }) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openMenuForBranchId, setOpenMenuForBranchId] = useState(null);
  /** The trigger the open menu hangs from; only one row's menu is open. */
  const menuAnchorRef = useRef(null);
  const [viewBranchId, setViewBranchId] = useState(null);
  const [editingBranchId, setEditingBranchId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({
    branchCode: '',
    branchName: '',
    addressLine1: '',
    city: '',
    state: '',
    country: 'India',
    gstRegistrationType: 'UNREGISTERED',
    gstin: '',
  });

  const [editForm, setEditForm] = useState({
    branchCode: '',
    branchName: '',
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

  const companyDefaults = useMemo(() => {
    const profile = company?.profile?.companySettings || {};
    return {
      branchName: 'Head Office',
      addressLine1: company?.address || profile.regAddress1 || '',
      addressLine2: profile.regAddress2 || '',
      city: company?.city || profile.regCity || '',
      state: company?.state || profile.regStateName || '',
      country: company?.country || profile.regCountry || 'India',
      gstin: company?.gstin || profile.gstin || '',
      gstRegistrationType: (company?.gstin || profile.gstin) ? 'REGULAR' : 'UNREGISTERED',
      phone: profile.phone || '',
      email: profile.officialEmail || '',
    };
  }, [company]);
  const companyGstEnabled = Boolean(company?.profile?.taxCompliances?.gstEnabled ?? company?.gstEnabled ?? company?.gstin);

  useEffect(() => {
    if (!companyGstEnabled) return;
    setForm((current) => current.gstRegistrationType === 'UNREGISTERED' ? { ...current, gstRegistrationType: 'REGULAR' } : current);
    setEditForm((current) => current.gstRegistrationType === 'UNREGISTERED' ? { ...current, gstRegistrationType: 'REGULAR' } : current);
  }, [companyGstEnabled]);

  const loadBranches = async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const res = await listBranches(orgId);
      let rows = Array.isArray(res.branches) ? res.branches : [];
      const headOffice = rows.find((branch) => String(branch.branchCode || '').trim().toUpperCase() === 'HO');
      if (headOffice) {
        const fill = Object.fromEntries(Object.entries(companyDefaults).filter(([key, value]) => value && !String(headOffice[key] || '').trim()));
        if (Object.keys(fill).length) {
          const synced = await updateBranch(orgId, headOffice.id, fill);
          if (synced?.branch) rows = rows.map((branch) => String(branch.id) === String(headOffice.id) ? synced.branch : branch);
        }
      }
      setBranches(rows);
    } catch (err) {
      setError(err.message || 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, [orgId, companyDefaults]);

  const onChange = (k) => (e) => {
    const next = e.target.value;
    if (k === 'gstin') {
      const maybeState = getGstStateFromGstin(String(next || '').trim());
      setForm((p) => ({ ...p, gstin: next, state: maybeState ? maybeState : p.state }));
      setError('');
      return;
    }
    setForm((p) => ({ ...p, [k]: next }));
    setError('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!String(form.state || '').trim()) {
      setError('State is required — pick the branch state.');
      notify.error('State is required — pick the branch state.');
      return;
    }
    if (companyGstEnabled && !String(form.gstin || '').trim()) {
      setError('GSTIN is mandatory while GST is enabled.');
      notify.error('GSTIN is mandatory while GST is enabled.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        gstRegistrationType: companyGstEnabled && form.gstRegistrationType === 'UNREGISTERED' ? 'REGULAR' : form.gstRegistrationType,
        gstin: form.gstin || null,
      };
      const res = await createBranch(orgId, payload);
      setBranches((prev) => [...prev, res.branch]);
      /*
       * Saving opens what was saved. A create used to drop you back on the
       * list with a toast, so the only way to check what had actually been
       * stored was to find the row again and open it — and with several
       * branches that is a search through a list you have just added to.
       */
      if (res?.branch?.id) setViewBranchId(String(res.branch.id));
      setForm({ branchCode: '', branchName: '', addressLine1: '', city: '', state: '', country: 'India', gstRegistrationType: companyGstEnabled ? 'REGULAR' : 'UNREGISTERED', gstin: '' });
      setShowForm(false);
      notify.success(`Branch "${res.branch?.branchName || payload.branchName}" created.`);
      onBranchesChanged?.();
    } catch (err) {
      setError(err.message || 'Failed to create branch');
      notify.error(err.message || 'Failed to create branch');
    } finally {
      setSaving(false);
    }
  };

  const removeBranch = async (id) => {
    if (!await confirmDialog({ title: 'Delete branch?', message: 'The branch can be deleted only when it has no associated transactions.', confirmLabel: 'Delete branch' })) return;
    try {
      await deleteBranch(orgId, id);
      setBranches((prev) => prev.filter((b) => b.id !== id));
      if (String(viewBranchId) === String(id)) closeView();
      notify.success('Branch deleted.');
      onBranchesChanged?.();
    } catch (err) {
      const message = err.message || 'Failed to delete branch';
      setError(message);
      notify.error(message);
    }
  };

  const toggleBranchStatus = async (branch) => {
    setOpenMenuForBranchId(null);
    setError('');
    try {
      const res = await updateBranch(orgId, branch.id, { isActive: branch.isActive === false });
      const updated = res?.branch;
      if (updated) setBranches((prev) => prev.map((item) => String(item.id) === String(updated.id) ? updated : item));
      notify.success(`Branch marked ${updated?.isActive === false ? 'inactive' : 'active'}.`);
      onBranchesChanged?.();
    } catch (err) {
      const message = err.message || 'Failed to update branch status';
      setError(message);
      notify.error(message);
    }
  };

  const openView = (id) => {
    setViewBranchId(String(id));
    setEditingBranchId(null);
    setOpenMenuForBranchId(null);
  };

  const closeView = () => {
    setViewBranchId(null);
    setEditingBranchId(null);
  };

  const beginEdit = (b) => {
    setViewBranchId(String(b.id));
    setEditingBranchId(String(b.id));
    setEditForm({
      branchCode: String(b.branchCode || ''),
      branchName: String(b.branchName || ''),
      addressLine1: String(b.addressLine1 || ''),
      addressLine2: String(b.addressLine2 || ''),
      city: String(b.city || ''),
      state: String(b.state || ''),
      country: String(b.country || 'India'),
      gstRegistrationType: companyGstEnabled && String(b.gstRegistrationType || '') === 'UNREGISTERED' ? 'REGULAR' : String(b.gstRegistrationType || 'UNREGISTERED'),
      gstin: String(b.gstin || ''),
      contactPerson: String(b.contactPerson || ''),
      phone: String(b.phone || ''),
      email: String(b.email || ''),
    });
    setOpenMenuForBranchId(null);
    setError('');
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editingBranchId) return;
    setEditSaving(true);
    setError('');
    try {
      const payload = {
        branchCode: String(editForm.branchCode || '').trim(),
        branchName: String(editForm.branchName || '').trim(),
        addressLine1: String(editForm.addressLine1 || '').trim(),
        addressLine2: String(editForm.addressLine2 || '').trim() || null,
        city: String(editForm.city || '').trim() || null,
        state: String(editForm.state || '').trim(),
        country: String(editForm.country || '').trim() || 'India',
        gstRegistrationType: String(editForm.gstRegistrationType || 'UNREGISTERED').trim(),
        gstin: String(editForm.gstin || '').trim() || null,
        contactPerson: String(editForm.contactPerson || '').trim() || null,
        phone: String(editForm.phone || '').trim() || null,
        email: String(editForm.email || '').trim() || null,
      };

      if (!payload.branchCode) throw new Error('Branch code is required');
      if (!payload.branchName) throw new Error('Branch name is required');
      if (!payload.addressLine1) throw new Error('Address is required');
      if (!payload.state) throw new Error('State is required');
      if ((companyGstEnabled || payload.gstRegistrationType !== 'UNREGISTERED') && !payload.gstin) {
        throw new Error('GSTIN is mandatory while GST is enabled');
      }

      const res = await updateBranch(orgId, editingBranchId, payload);
      const updated = res?.branch;
      if (updated) {
        setBranches((prev) => prev.map((x) => (String(x.id) === String(updated.id) ? updated : x)));
      } else {
        await loadBranches();
      }
      // Back to the view of the record just saved, not out of it entirely.
      setEditingBranchId(null);
      setViewBranchId(String(editingBranchId));
      notify.success(`Branch "${payload.branchName}" saved.`);
    } catch (err) {
      setError(err.message || 'Failed to update branch');
    } finally {
      setEditSaving(false);
    }
  };

  const query = String(search || '').trim().toLowerCase();
  const filteredBranches = query
    ? branches.filter((b) => {
        const code = String(b?.branchCode || '').toLowerCase();
        const name = String(b?.branchName || '').toLowerCase();
        const city = String(b?.city || '').toLowerCase();
        const state = String(b?.state || '').toLowerCase();
        const addr = String(b?.addressLine1 || '').toLowerCase();
        const gstin = String(b?.gstin || '').toLowerCase();
        const phone = String(b?.phone || '').toLowerCase();
        const email = String(b?.email || '').toLowerCase();
        return [code, name, city, state, addr, gstin, phone, email].some((s) => s.includes(query));
      })
    : branches;

  const selectedBranch = viewBranchId ? branches.find((b) => String(b.id) === String(viewBranchId)) || null : null;

  return (
    <div className="settings-branches space-y-3">
      <div className="branch-list-toolbar flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2">
        <div>
          <div className="ui-t-sec">Branches</div>
          <div className="ui-caption">{filteredBranches.length} {filteredBranches.length === 1 ? 'branch' : 'branches'}</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 ui-muted" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search branches"
              className="ui-input w-full bg-[rgb(var(--surface))] ps-8"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              exportRows({
                fileName: 'Branches',
                label: 'branch(es)',
                columns: [
              { key: 'branchCode', label: 'Code' },
              { key: 'branchName', label: 'Branch' },
              { key: 'city', label: 'City' },
              { key: 'state', label: 'State' },
              { key: 'gstin', label: 'GSTIN' },
                ],
                rows: filteredBranches,
              })
            }
            className="ui-btn ui-btn-secondary ui-btn-sm"
          >
            <Download size={14} aria-hidden="true" /> Export
          </button>
          <PermissionButton
            permission="MASTERS::Company/Branch setup::CREATE"
            type="button"
            onClick={() => { setShowForm((value) => !value); closeView(); }}
            className="ui-btn ui-btn-primary ui-btn-sm"
          >
            <Plus size={14} aria-hidden="true" /> Create Branch
          </PermissionButton>
        </div>
      </div>

      {error && <div className="text-sm text-[rgb(var(--neg))] bg-[rgb(var(--neg-soft))] border border-[rgb(var(--neg)/0.35)] rounded-lg p-3">{error}</div>}

      {selectedBranch || showForm ? <button type="button" className="settings-drawer-backdrop" aria-label="Close branch drawer" onClick={() => { setShowForm(false); closeView(); }} /> : null}

      {selectedBranch ? (
        <div className="settings-side-drawer branch-detail-card space-y-3">
          <div className="settings-drawer-heading flex items-center justify-between">
            <div>
              <div className="ui-t-sec">{editingBranchId ? 'Edit Branch' : 'Branch Details'}</div>
              <div className="ui-caption">{selectedBranch.branchName || selectedBranch.branchCode || ''}</div>
            </div>
            <div className="flex gap-2">
              {editingBranchId ? null : (
                <button
                  type="button"
                  onClick={() => beginEdit(selectedBranch)}
                  className="ui-btn ui-btn-secondary ui-btn-sm"
                >
                  <Pencil size={14} aria-hidden="true" /> Edit
                </button>
              )}
              <button type="button" onClick={closeView} className="ui-btn ui-btn-ghost ui-btn-sm">
                Close
              </button>
            </div>
          </div>

          {editingBranchId ? (
            <form onSubmit={saveEdit} className="branch-editor-form space-y-3">
              <div className="branch-editor-section grid grid-cols-12 gap-3">
                <div className="col-span-12 sm:col-span-4">
                  <label className="ui-label" htmlFor="settingsbranches-branch-code">Branch Code *</label>
                  <input id="settingsbranches-branch-code" className="ui-input w-full max-w-40 cursor-not-allowed bg-[rgb(var(--surface-sunken))]" value={editForm.branchCode} readOnly aria-readonly="true" title="Branch code cannot be changed after creation" />
                </div>
                <div className="col-span-12 sm:col-span-8">
                  <label className="ui-label" htmlFor="settingsbranches-branch-name">Branch Name *</label>
                  <input id="settingsbranches-branch-name" className="ui-input w-full" value={editForm.branchName} onChange={(e) => setEditForm((p) => ({ ...p, branchName: e.target.value }))} required />
                </div>
              </div>

              <div className="branch-editor-section space-y-3">
              <div className="branch-editor-section-title">Address</div>
              <div>
                <label className="ui-label" htmlFor="settingsbranches-address">Address *</label>
                <input id="settingsbranches-address" className="ui-input w-full" value={editForm.addressLine1} onChange={(e) => setEditForm((p) => ({ ...p, addressLine1: e.target.value }))} required />
              </div>

              <div>
                <label className="ui-label" htmlFor="settingsbranches-address-line-2">Address Line 2</label>
                <input id="settingsbranches-address-line-2" className="ui-input w-full" value={editForm.addressLine2} onChange={(e) => setEditForm((p) => ({ ...p, addressLine2: e.target.value }))} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="ui-label" htmlFor="settingsbranches-city">City</label>
                  <input id="settingsbranches-city" className="ui-input w-full" value={editForm.city} onChange={(e) => setEditForm((p) => ({ ...p, city: e.target.value }))} />
                </div>
                <div>
                  <PopupSelect
                    label="State *"
                    value={editForm.state}
                    onChange={(v) => {
                      setEditForm((p) => ({ ...p, state: v }));
                      setError('');
                    }}
                    options={stateOptions}
                    placeholder="Select state"
      title="Select State"
                    maxWidthClass="max-w-2xl"
                  />
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingsbranches-country">Country</label>
                  <input id="settingsbranches-country" className="ui-input w-full" value={editForm.country} onChange={(e) => setEditForm((p) => ({ ...p, country: e.target.value }))} />
                </div>
              </div>
              </div>

              <div className="branch-editor-section grid grid-cols-2 gap-3">
                <div className="branch-editor-section-title col-span-2">GST Details</div>
                <div>
                  <label className="ui-label" htmlFor="settingsbranches-gst-registration">GST Registration</label>
                  <select id="settingsbranches-gst-registration" className="ui-select w-full ui-surface" value={editForm.gstRegistrationType} onChange={(e) => setEditForm((p) => ({ ...p, gstRegistrationType: e.target.value }))}>
                    <option value="REGULAR">Regular</option>
                    <option value="COMPOSITION">Composition</option>
                    {!companyGstEnabled ? <option value="UNREGISTERED">Unregistered</option> : null}
                  </select>
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingsbranches-gstin">GSTIN</label>
                  <input id="settingsbranches-gstin"
                    className="ui-input w-full"
                    value={editForm.gstin}
                    onChange={(e) => {
                      const next = e.target.value;
                      const maybeState = getGstStateFromGstin(String(next || '').trim());
                      setEditForm((p) => ({ ...p, gstin: next, state: maybeState ? maybeState : p.state }));
                      setError('');
                    }}
                    placeholder="15-char GSTIN"
                  />
                </div>
              </div>

              <div className="branch-editor-section grid grid-cols-3 gap-3">
                <div className="branch-editor-section-title col-span-3">Contact</div>
                <div>
                  <label className="ui-label" htmlFor="settingsbranches-contact-person">Contact Person</label>
                  <input id="settingsbranches-contact-person" className="ui-input w-full" value={editForm.contactPerson} onChange={(e) => setEditForm((p) => ({ ...p, contactPerson: e.target.value }))} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingsbranches-phone">Phone</label>
                  <input id="settingsbranches-phone" className="ui-input w-full" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingsbranches-email">Email</label>
                  <input id="settingsbranches-email" type="email" className="ui-input w-full" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingBranchId(null)} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                  Cancel
                </button>
                <button type="submit" disabled={editSaving} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50">
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-12 gap-4 text-sm">
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Branch Code</div>
                <div className="ui-detail-value ui-detail-mono">{selectedBranch.branchCode || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-8">
                <div className="ui-detail-label">Branch Name</div>
                <div className="ui-detail-value">{selectedBranch.branchName || '—'}</div>
              </div>

              <div className="col-span-12 sm:col-span-6">
                <div className="ui-detail-label">Address</div>
                <div className="ui-detail-value">{[selectedBranch.addressLine1, selectedBranch.addressLine2].filter(Boolean).join(', ') || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-6">
                <div className="ui-detail-label">Location</div>
                <div className="ui-detail-value">{[selectedBranch.city, selectedBranch.state, selectedBranch.country].filter(Boolean).join(', ') || '—'}</div>
              </div>

              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">GST Registration</div>
                <div className="ui-detail-value">{selectedBranch.gstRegistrationType || 'UNREGISTERED'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">GSTIN</div>
                <div className="ui-detail-value ui-detail-mono">{selectedBranch.gstin || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Status</div>
                <div className="ui-detail-value">{selectedBranch.isActive !== false ? 'Active' : 'Inactive'}</div>
              </div>

              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Contact Person</div>
                <div className="ui-detail-value">{selectedBranch.contactPerson || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Phone</div>
                <div className="ui-detail-value">{selectedBranch.phone || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Email</div>
                <div className="ui-detail-value">{selectedBranch.email || '—'}</div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {showForm && (
        <form onSubmit={onSubmit} className="settings-side-drawer branch-create-form branch-editor-form space-y-3">
          <div className="settings-drawer-heading flex items-center justify-between"><div><div className="ui-t-sec">New Branch</div><div className="ui-caption">Create a business branch and GST location</div></div><button type="button" onClick={() => setShowForm(false)} className="ui-btn ui-btn-ghost ui-btn-sm">Close</button></div>
          <div className="branch-editor-section grid grid-cols-12 gap-3">
            <div className="col-span-12 sm:col-span-4">
              <label className="ui-label" htmlFor="settingsbranches-branch-code-2">Branch Code *</label>
              <input id="settingsbranches-branch-code-2" className="ui-input w-full max-w-40" value={form.branchCode} onChange={onChange('branchCode')} required />
            </div>
            <div className="col-span-12 sm:col-span-8">
              <label className="ui-label" htmlFor="settingsbranches-branch-name-2">Branch Name *</label>
              <input id="settingsbranches-branch-name-2" className="ui-input w-full" value={form.branchName} onChange={onChange('branchName')} required />
            </div>
          </div>
          <div className="branch-editor-section grid grid-cols-2 gap-3">
           <div className="branch-editor-section-title col-span-2">Address</div>
           <div>
            <label className="ui-label" htmlFor="settingsbranches-address-2">Address *</label>
            <input id="settingsbranches-address-2" className="ui-input w-full" value={form.addressLine1} onChange={onChange('addressLine1')} required />
           </div>
           <div>
            <label className="ui-label" htmlFor="settingsbranches-address-line-2-2">Address Line 2</label>
            <input id="settingsbranches-address-line-2-2" className="ui-input w-full" value={form.addressLine2 || ''} onChange={onChange('addressLine2')} />
           </div>
          </div>
          <div className="branch-editor-section grid grid-cols-3 gap-3">
            <div className="branch-editor-section-title col-span-3">Location</div>
            <div>
              <label className="ui-label" htmlFor="settingsbranches-city-2">City</label>
              <input id="settingsbranches-city-2" className="ui-input w-full" value={form.city} onChange={onChange('city')} />
            </div>
            <div>
              <PopupSelect
                label="State *"
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
              <label className="ui-label" htmlFor="settingsbranches-country-2">Country</label>
              <input id="settingsbranches-country-2" className="ui-input w-full" value={form.country} onChange={onChange('country')} />
            </div>
          </div>
          <div className="branch-editor-section grid grid-cols-2 gap-3">
            <div className="branch-editor-section-title col-span-2">GST Details</div>
            <div>
              <label className="ui-label" htmlFor="settingsbranches-gst-registration-2">GST Registration</label>
              <select id="settingsbranches-gst-registration-2" className="ui-select w-full ui-surface" value={form.gstRegistrationType} onChange={onChange('gstRegistrationType')}>
                <option value="REGULAR">Regular</option>
                <option value="COMPOSITION">Composition</option>
                {!companyGstEnabled ? <option value="UNREGISTERED">Unregistered</option> : null}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="settingsbranches-gstin-2">GSTIN</label>
              <input id="settingsbranches-gstin-2" className="ui-input w-full" value={form.gstin} onChange={onChange('gstin')} placeholder="15-char GSTIN" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Branch'}
            </button>
          </div>
        </form>
      )}

      <div className="branch-table-wrap ui-surface border rounded-lg overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={4} />
        ) : branches.length === 0 ? (
          <div className="px-6 py-10 text-center ui-muted">No branches yet. Click "Create Branch" to add one.</div>
        ) : filteredBranches.length === 0 ? (
          <div className="px-6 py-10 text-center ui-muted">No branches found.</div>
        ) : (
          <table className="branch-table ui-table w-full table-fixed ui-settled">
            <colgroup><col style={{ width: '15%' }} /><col style={{ width: '25%' }} /><col style={{ width: '18%' }} /><col style={{ width: '24%' }} /><col style={{ width: '12%' }} /><col style={{ width: '6%' }} /></colgroup>
            <thead className="ui-sunken border-b">
              <tr>
                <th className="ui-th">Branch Code</th>
                <th className="ui-th">Branch Name</th>
                <th className="ui-th">Location</th>
                <th className="ui-th">GSTN</th>
                <th className="ui-th ui-col-h-center">Status</th>
                <th className="ui-th ui-num">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredBranches.map((b) => (
                <tr key={b.id} className="ui-hover-sunken">
                  <td className="px-4 py-3 ui-fg ui-mono">
                    <button type="button" className="text-left hover:underline" onClick={() => openView(b.id)}>
                      {b.branchCode || ''}
                    </button>
                  </td>
                  <td className="px-4 py-3 ui-fg font-medium"><button type="button" className="text-left hover:underline" onClick={() => openView(b.id)}>{b.branchName || ''}</button></td>
                  <td className="ui-col-meta px-4 py-3 ui-fg">{b.city || ''}</td>
                  <td className="ui-col-id px-4 py-3 ui-fg font-mono">{b.gstin || ''}</td>
                  <td className="ui-col-meta px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${b.isActive !== false ? 'bg-[rgb(var(--pos-soft))] text-[rgb(var(--pos))]' : 'bg-[rgb(var(--neg-soft))] text-[rgb(var(--neg))]'}`}>
                      {b.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="relative inline-block text-left" data-branch-actions>
                      <button
                        type="button"
                        ref={openMenuForBranchId === b.id ? menuAnchorRef : null}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuForBranchId((prev) => (prev === b.id ? null : b.id));
                        }}
                        className="ui-icon-btn"
                        aria-label={`Actions for ${b.branchName || b.branchCode}`}
                      >
                        <MoreVertical size={15} aria-hidden="true" />
                      </button>

                      {openMenuForBranchId === b.id ? (
                        <Popover
                          anchorRef={menuAnchorRef}
                          onClose={() => setOpenMenuForBranchId(null)}
                          minWidth={176}
                          maxWidth={240}
                        >
                          <button type="button" onClick={() => beginEdit(b)} className="report-menu-item flex items-center gap-2">
                            <Pencil size={14} /> Edit
                          </button>
                          <button type="button" onClick={() => toggleBranchStatus(b)} className="report-menu-item flex items-center gap-2">
                            <Power size={14} /> Mark {b.isActive !== false ? 'inactive' : 'active'}
                          </button>
                          <PermissionButton permission="MASTERS::Company/Branch setup::DELETE" type="button" onClick={() => removeBranch(b.id)} className="report-menu-item flex items-center gap-2 text-[rgb(var(--neg))] hover:bg-[rgb(var(--neg-soft))]">
                            <Trash2 size={14} /> Delete
                          </PermissionButton>
                        </Popover>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
