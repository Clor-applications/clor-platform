import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TableSkeleton } from '@ui/components/ui/Primitives';
import { exportRows } from '@ui/components/ListToolbar';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listBranches, listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from '../../api/admin';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import Popover from '@ui/components/ui/Popover';
import { Download, MoreVertical, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import { PermissionButton } from '@ui/permissions/ActionGuard';

export function SettingsWarehouses({ orgId, branchId, company, onWarehousesChanged }) {
  const [warehouses, setWarehouses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openMenuForWarehouseId, setOpenMenuForWarehouseId] = useState(null);
  /** The trigger the open menu hangs from; only one row's menu is open. */
  const menuAnchorRef = useRef(null);
  const [viewWarehouseId, setViewWarehouseId] = useState(null);
  const [editingWarehouseId, setEditingWarehouseId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({
    branchId: branchId ? String(branchId) : '',
    code: '',
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

  const [editForm, setEditForm] = useState({
    branchId: branchId ? String(branchId) : '',
    code: '',
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
  const companyGstEnabled = Boolean(company?.profile?.taxCompliances?.gstEnabled ?? company?.gstEnabled ?? company?.gstin);

  useEffect(() => {
    if (!companyGstEnabled) return;
    setForm((current) => current.gstRegistrationType === 'UNREGISTERED' ? { ...current, gstRegistrationType: 'REGULAR' } : current);
    setEditForm((current) => current.gstRegistrationType === 'UNREGISTERED' ? { ...current, gstRegistrationType: 'REGULAR' } : current);
  }, [companyGstEnabled]);

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

  const branchOptions = useMemo(() => {
    return (Array.isArray(branches) ? branches : [])
      .map((b) => ({
        value: String(b.id),
        label: String(b.branchName || b.name || '').trim() || `Branch ${String(b.id)}`,
        code: b.branchCode ? String(b.branchCode) : undefined,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [branches]);

  const branchLookup = useMemo(() => {
    const map = new Map();
    (Array.isArray(branches) ? branches : []).forEach((b) => map.set(String(b.id), b));
    return map;
  }, [branches]);

  const loadBranches = async () => {
    if (!orgId) return;
    try {
      setError('');
      const res = await listBranches(orgId);
      setBranches(Array.isArray(res.branches) ? res.branches : []);
    } catch (err) {
      setBranches([]);
      setError(err.message || 'Failed to load branches');
    }
  };

  const loadWarehouses = async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const res = await listWarehouses(orgId);
      const all = Array.isArray(res.warehouses) ? res.warehouses : [];
      // Filter by branchId if provided
      const filtered = branchId ? all.filter((w) => String(w.branchId) === String(branchId)) : all;
      setWarehouses(filtered);
    } catch (err) {
      setError(err.message || 'Failed to load warehouses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
    loadWarehouses();
  }, [orgId, branchId]);

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
    setSaving(true);
    setError('');
    try {
      const selectedBranchId = String(form.branchId || '').trim();
      if (!selectedBranchId) {
        setError('Branch is required');
        return;
      }

      const payload = {
        branchId: selectedBranchId,
        code: String(form.code || '').trim().toUpperCase(),
        name: String(form.name || '').trim(),
        addressLine1: String(form.addressLine1 || '').trim() || null,
        addressLine2: String(form.addressLine2 || '').trim() || null,
        city: String(form.city || '').trim() || null,
        state: String(form.state || '').trim() || null,
        country: String(form.country || '').trim() || null,
        gstRegistrationType: companyGstEnabled && form.gstRegistrationType === 'UNREGISTERED' ? 'REGULAR' : String(form.gstRegistrationType || 'UNREGISTERED').trim(),
        gstin: String(form.gstin || '').trim() || null,
        contactPerson: String(form.contactPerson || '').trim() || null,
        phone: String(form.phone || '').trim() || null,
        email: String(form.email || '').trim() || null,
      };

      if (!payload.code) {
        setError('Warehouse code is required');
        return;
      }
      if (!payload.name) {
        setError('Warehouse name is required');
        return;
      }

      if ((companyGstEnabled || payload.gstRegistrationType !== 'UNREGISTERED') && !payload.gstin) {
        setError('GSTIN is mandatory while GST is enabled');
        return;
      }

      const res = await createWarehouse(orgId, payload);
      setWarehouses((prev) => [...prev, res.warehouse]);
      // Saving opens what was saved, the same as a branch and a company.
      if (res?.warehouse?.id) setViewWarehouseId(String(res.warehouse.id));
      if (typeof onWarehousesChanged === 'function') onWarehousesChanged();
      setForm({
        branchId: branchId ? String(branchId) : '',
        code: '',
        name: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        country: 'India',
        gstRegistrationType: companyGstEnabled ? 'REGULAR' : 'UNREGISTERED',
        gstin: '',
        contactPerson: '',
        phone: '',
        email: '',
      });
      setShowForm(false);
    } catch (err) {
      setError(err.message || 'Failed to create warehouse');
    } finally {
      setSaving(false);
    }
  };

  const openView = (warehouseId) => {
    setViewWarehouseId(String(warehouseId));
    setEditingWarehouseId(null);
    setOpenMenuForWarehouseId(null);
  };

  const closeDetails = () => {
    setViewWarehouseId(null);
    setEditingWarehouseId(null);
  };

  const beginEdit = (w) => {
    setEditingWarehouseId(String(w.id));
    setViewWarehouseId(String(w.id));
    setEditForm({
      branchId: String(w.branchId || ''),
      code: String(w.code || ''),
      name: String(w.name || '').trim(),
      addressLine1: String(w.addressLine1 || ''),
      addressLine2: String(w.addressLine2 || ''),
      city: String(w.city || ''),
      state: String(w.state || ''),
      country: String(w.country || 'India'),
      gstRegistrationType: companyGstEnabled && String(w.gstRegistrationType || '') === 'UNREGISTERED' ? 'REGULAR' : String(w.gstRegistrationType || 'UNREGISTERED'),
      gstin: String(w.gstin || ''),
      contactPerson: String(w.contactPerson || ''),
      phone: String(w.phone || ''),
      email: String(w.email || ''),
    });
    setOpenMenuForWarehouseId(null);
    setError('');
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editingWarehouseId) return;
    setEditSaving(true);
    setError('');
    try {
      const payload = {
        branchId: String(editForm.branchId || '').trim(),
        name: String(editForm.name || '').trim(),
        addressLine1: String(editForm.addressLine1 || '').trim() || null,
        addressLine2: String(editForm.addressLine2 || '').trim() || null,
        city: String(editForm.city || '').trim() || null,
        state: String(editForm.state || '').trim() || null,
        country: String(editForm.country || '').trim() || null,
        gstRegistrationType: String(editForm.gstRegistrationType || 'UNREGISTERED').trim(),
        gstin: String(editForm.gstin || '').trim() || null,
        contactPerson: String(editForm.contactPerson || '').trim() || null,
        phone: String(editForm.phone || '').trim() || null,
        email: String(editForm.email || '').trim() || null,
      };

      if (!payload.branchId) throw new Error('Branch is required');
      if (!payload.name) throw new Error('Warehouse name is required');
      if ((companyGstEnabled || payload.gstRegistrationType !== 'UNREGISTERED') && !payload.gstin) {
        throw new Error('GSTIN is mandatory while GST is enabled');
      }

      const res = await updateWarehouse(orgId, editingWarehouseId, payload);
      const updated = res?.warehouse;
      if (updated) {
        setWarehouses((prev) => prev.map((x) => (String(x.id) === String(updated.id) ? updated : x)));
      } else {
        await loadWarehouses();
      }
      if (typeof onWarehousesChanged === 'function') onWarehousesChanged();
      // Back to the view of the record just saved, not out of it entirely.
      setEditingWarehouseId(null);
      setViewWarehouseId(String(editingWarehouseId));
      notify.success(`Warehouse "${payload.name}" saved.`);
    } catch (err) {
      setError(err.message || 'Failed to update warehouse');
    } finally {
      setEditSaving(false);
    }
  };

  const removeWarehouse = async (id) => {
    if (!await confirmDialog({ title: 'Please confirm', message: 'Delete this warehouse?', confirmLabel: 'Yes, continue' })) return;
    try {
      await deleteWarehouse(orgId, id);
      setWarehouses((prev) => prev.filter((w) => w.id !== id));
      if (typeof onWarehousesChanged === 'function') onWarehousesChanged();
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
  };

  const toggleWarehouseStatus = async (warehouse) => {
    setOpenMenuForWarehouseId(null);
    setError('');
    try {
      const res = await updateWarehouse(orgId, warehouse.id, { isActive: warehouse.isActive === false });
      const updated = res?.warehouse;
      if (updated) setWarehouses((prev) => prev.map((item) => String(item.id) === String(updated.id) ? updated : item));
      notify.success(`Warehouse marked ${updated?.isActive === false ? 'inactive' : 'active'}.`);
      onWarehousesChanged?.();
    } catch (err) {
      const message = err.message || 'Failed to update warehouse status';
      setError(message);
      notify.error(message);
    }
  };

  const query = String(search || '').trim().toLowerCase();
  const filteredWarehouses = query
    ? warehouses.filter((w) => {
        const b = branchLookup.get(String(w.branchId || ''));
        const branchName = String((b && (b.branchName || b.name)) || '').toLowerCase();
        const name = String(w?.name || '').toLowerCase();
        const gstin = String(w?.gstin || '').toLowerCase();
        const city = String(w?.city || '').toLowerCase();
        const state = String(w?.state || '').toLowerCase();
        const phone = String(w?.phone || '').toLowerCase();
        const email = String(w?.email || '').toLowerCase();
        return [branchName, name, gstin, city, state, phone, email].some((s) => s.includes(query));
      })
    : warehouses;

  const selectedWarehouse = useMemo(() => {
    if (!viewWarehouseId) return null;
    return warehouses.find((w) => String(w.id) === String(viewWarehouseId)) || null;
  }, [warehouses, viewWarehouseId]);

  return (
    <div className="settings-warehouses settings-branches space-y-3">
      <div className="branch-list-toolbar flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2">
        <div><div className="ui-t-sec">Warehouses</div><div className="ui-caption">{filteredWarehouses.length} {filteredWarehouses.length === 1 ? 'warehouse' : 'warehouses'}</div></div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 ui-muted" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search warehouses"
              className="ui-input w-full bg-[rgb(var(--surface))] ps-8"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              exportRows({
                fileName: 'Warehouses',
                label: 'warehouse(s)',
                columns: [
              { key: 'name', label: 'Warehouse' },
              { key: 'code', label: 'Code' },
              { key: 'branchName', label: 'Branch' },
              { key: 'city', label: 'City' },
                ],
                rows: filteredWarehouses,
              })
            }
            className="ui-btn ui-btn-secondary ui-btn-sm"
          >
            <Download size={14} /> Export
          </button>
          <PermissionButton permission="MASTERS::Company/Branch setup::CREATE" type="button" onClick={() => { setShowForm((value) => !value); closeDetails(); }} className="ui-btn ui-btn-primary ui-btn-sm">
            <Plus size={14} /> Create Warehouse
          </PermissionButton>
        </div>
      </div>

      {error && <div className="text-sm text-[rgb(var(--neg))] bg-[rgb(var(--neg-soft))] border border-[rgb(var(--neg)/0.35)] rounded-lg p-3">{error}</div>}

      {selectedWarehouse || showForm ? <button type="button" className="settings-drawer-backdrop" aria-label="Close warehouse drawer" onClick={() => { setShowForm(false); closeDetails(); }} /> : null}

      {selectedWarehouse ? (
        <div className="settings-side-drawer branch-detail-card space-y-3">
          <div className="settings-drawer-heading flex items-center justify-between">
            <div>
              <div className="ui-t-sec">{editingWarehouseId ? 'Edit Warehouse' : 'Warehouse Details'}</div>
              <div className="ui-caption">{selectedWarehouse.name || ''}</div>
            </div>
            <div className="flex gap-2">
              {editingWarehouseId ? null : (
                <button
                  type="button"
                  onClick={() => beginEdit(selectedWarehouse)}
                  className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken"
                >
                  Edit
                </button>
              )}
              <button type="button" onClick={closeDetails} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                Close
              </button>
            </div>
          </div>

          {editingWarehouseId ? (
            <form onSubmit={saveEdit} className="branch-editor-form space-y-3">
              <div className="branch-editor-section grid grid-cols-12 gap-3">
                <div className="col-span-12 sm:col-span-6">
                  <label className="ui-label">Warehouse Code</label>
                  <input className="ui-input w-full cursor-not-allowed bg-[rgb(var(--surface-sunken))]" value={editForm.code} readOnly aria-readonly="true" title="Warehouse code cannot be changed after creation" />
                </div>
                <div className="col-span-12 sm:col-span-6">
                  <PopupSelect
                    label="Branch *"
                    value={editForm.branchId}
                    onChange={(v) => {
                      setEditForm((p) => ({ ...p, branchId: v }));
                      setError('');
                    }}
                    options={branchOptions}
                    placeholder="Select branch"
                  />
                </div>
                <div className="col-span-12">
                  <label className="ui-label" htmlFor="settingswarehouses-warehouse-name">Warehouse Name *</label>
                  <input id="settingswarehouses-warehouse-name" className="ui-input w-full" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} required />
                </div>
              </div>

              <div className="branch-editor-section grid grid-cols-2 gap-3">
                <div className="branch-editor-section-title col-span-2">Address</div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-address-line-1">Address Line 1</label>
                  <input id="settingswarehouses-address-line-1" className="ui-input w-full" value={editForm.addressLine1} onChange={(e) => setEditForm((p) => ({ ...p, addressLine1: e.target.value }))} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-address-line-2">Address Line 2</label>
                  <input id="settingswarehouses-address-line-2" className="ui-input w-full" value={editForm.addressLine2} onChange={(e) => setEditForm((p) => ({ ...p, addressLine2: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-city">City</label>
                  <input id="settingswarehouses-city" className="ui-input w-full" value={editForm.city} onChange={(e) => setEditForm((p) => ({ ...p, city: e.target.value }))} />
                </div>
                <div>
                  <PopupSelect
                    label="State"
                    value={editForm.state}
                    onChange={(v) => {
                      setEditForm((p) => ({ ...p, state: v }));
                      setError('');
                    }}
                    options={stateOptions}
                    placeholder="Select state"
                  />
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-country">Country</label>
                  <input id="settingswarehouses-country" className="ui-input w-full" value={editForm.country} onChange={(e) => setEditForm((p) => ({ ...p, country: e.target.value }))} />
                </div>
              </div>

              <div className="branch-editor-section grid grid-cols-2 gap-3">
                <div className="branch-editor-section-title col-span-2">GST Details</div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-gst-registration">GST Registration</label>
                  <select id="settingswarehouses-gst-registration" className="ui-select w-full ui-surface" value={editForm.gstRegistrationType} onChange={(e) => setEditForm((p) => ({ ...p, gstRegistrationType: e.target.value }))}>
                    {!companyGstEnabled ? <option value="UNREGISTERED">Unregistered</option> : null}
                    <option value="REGULAR">Regular</option>
                    <option value="COMPOSITION">Composition</option>
                  </select>
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-gstin">GSTIN</label>
                  <input id="settingswarehouses-gstin"
                    className="ui-input w-full"
                    value={editForm.gstin}
                    onChange={(e) => {
                      const next = e.target.value;
                      const maybeState = getGstStateFromGstin(String(next || '').trim());
                      setEditForm((p) => ({ ...p, gstin: next, state: maybeState ? maybeState : p.state }));
                      setError('');
                    }}
                    placeholder="15 characters"
                  />
                </div>
              </div>

              <div className="branch-editor-section grid grid-cols-3 gap-3">
                <div className="branch-editor-section-title col-span-3">Contact</div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-contact-person">Contact Person</label>
                  <input id="settingswarehouses-contact-person" className="ui-input w-full" value={editForm.contactPerson} onChange={(e) => setEditForm((p) => ({ ...p, contactPerson: e.target.value }))} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-phone">Phone</label>
                  <input id="settingswarehouses-phone" className="ui-input w-full" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="settingswarehouses-email">Email</label>
                  <input id="settingswarehouses-email" type="email" className="ui-input w-full" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingWarehouseId(null)} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
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
                <div className="ui-detail-label">Warehouse Code</div>
                <div className="ui-detail-value ui-detail-mono">{selectedWarehouse.code || ''}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Warehouse Name</div>
                <div className="ui-detail-value">{selectedWarehouse.name || ''}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Branch</div>
                <div className="ui-detail-value">
                  {(() => {
                    const b = branchLookup.get(String(selectedWarehouse.branchId || ''));
                    return (b && (b.branchName || b.name)) ? String(b.branchName || b.name) : '—';
                  })()}
                </div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">GST Registration</div>
                <div className="ui-detail-value">{selectedWarehouse.gstRegistrationType || 'UNREGISTERED'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">GSTIN</div>
                <div className="ui-detail-value">{selectedWarehouse.gstin || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Status</div>
                <div className="ui-detail-value">{selectedWarehouse.isActive !== false ? 'Active' : 'Inactive'}</div>
              </div>

              <div className="col-span-12 sm:col-span-6">
                <div className="ui-detail-label">Address</div>
                <div className="ui-detail-value">
                  {[selectedWarehouse.addressLine1, selectedWarehouse.addressLine2].filter(Boolean).join(', ') || '—'}
                </div>
              </div>
              <div className="col-span-12 sm:col-span-6">
                <div className="ui-detail-label">Location</div>
                <div className="ui-detail-value">
                  {[selectedWarehouse.city, selectedWarehouse.state, selectedWarehouse.country].filter(Boolean).join(', ') || '—'}
                </div>
              </div>

              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Contact Person</div>
                <div className="ui-detail-value">{selectedWarehouse.contactPerson || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Phone</div>
                <div className="ui-detail-value">{selectedWarehouse.phone || '—'}</div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <div className="ui-detail-label">Email</div>
                <div className="ui-detail-value">{selectedWarehouse.email || '—'}</div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {showForm && (
        <form onSubmit={onSubmit} className="settings-side-drawer branch-create-form branch-editor-form space-y-3">
          <div className="settings-drawer-heading flex items-center justify-between"><div><div className="ui-t-sec">New Warehouse</div><div className="ui-caption">Create a stock location under a branch</div></div><button type="button" onClick={() => setShowForm(false)} className="ui-btn ui-btn-ghost ui-btn-sm">Close</button></div>

          <div className="branch-editor-section grid grid-cols-12 gap-3">
            <div className="col-span-12 sm:col-span-4">
              <label className="ui-label">Warehouse Code *</label>
              <input className="ui-input w-full ui-mono" value={form.code} onChange={onChange('code')} required maxLength={20} />
            </div>
            <div className="col-span-12 sm:col-span-4">
              <PopupSelect
                label="Branch *"
                value={form.branchId}
                onChange={(v) => {
                  setForm((p) => ({ ...p, branchId: v }));
                  setError('');
                }}
                options={branchOptions}
                placeholder="Select branch"
              />
            </div>
            <div className="col-span-12 sm:col-span-4">
              <label className="ui-label" htmlFor="settingswarehouses-warehouse-name-2">Warehouse Name *</label>
              <input id="settingswarehouses-warehouse-name-2" className="ui-input w-full" value={form.name} onChange={onChange('name')} required />
            </div>
          </div>

          <div className="branch-editor-section grid grid-cols-2 gap-3">
            <div className="branch-editor-section-title col-span-2">Address</div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-address-line-1-2">Address Line 1</label>
              <input id="settingswarehouses-address-line-1-2" className="ui-input w-full" value={form.addressLine1} onChange={onChange('addressLine1')} />
            </div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-address-line-2-2">Address Line 2</label>
              <input id="settingswarehouses-address-line-2-2" className="ui-input w-full" value={form.addressLine2} onChange={onChange('addressLine2')} />
            </div>
          </div>

          <div className="branch-editor-section grid grid-cols-3 gap-3">
            <div className="branch-editor-section-title col-span-3">Location</div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-city-2">City</label>
              <input id="settingswarehouses-city-2" className="ui-input w-full" value={form.city} onChange={onChange('city')} />
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
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-country-2">Country</label>
              <input id="settingswarehouses-country-2" className="ui-input w-full" value={form.country} onChange={onChange('country')} />
            </div>
          </div>

          <div className="branch-editor-section grid grid-cols-2 gap-3">
            <div className="branch-editor-section-title col-span-2">GST Details</div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-gst-registration-2">GST Registration</label>
              <select id="settingswarehouses-gst-registration-2" className="ui-select w-full ui-surface" value={form.gstRegistrationType} onChange={onChange('gstRegistrationType')}>
                {!companyGstEnabled ? <option value="UNREGISTERED">Unregistered</option> : null}
                <option value="REGULAR">Regular</option>
                <option value="COMPOSITION">Composition</option>
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-gstin-2">GSTIN</label>
              <input id="settingswarehouses-gstin-2"
                className="ui-input w-full"
                value={form.gstin}
                onChange={onChange('gstin')}
                placeholder="15 characters"
              />
            </div>
          </div>

          <div className="branch-editor-section grid grid-cols-3 gap-3">
            <div className="branch-editor-section-title col-span-3">Contact</div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-contact-person-2">Contact Person</label>
              <input id="settingswarehouses-contact-person-2" className="ui-input w-full" value={form.contactPerson} onChange={onChange('contactPerson')} />
            </div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-phone-2">Phone</label>
              <input id="settingswarehouses-phone-2" className="ui-input w-full" value={form.phone} onChange={onChange('phone')} />
            </div>
            <div>
              <label className="ui-label" htmlFor="settingswarehouses-email-2">Email</label>
              <input id="settingswarehouses-email-2" type="email" className="ui-input w-full" value={form.email} onChange={onChange('email')} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Warehouse'}
            </button>
          </div>
        </form>
      )}

      <div className="branch-table-wrap ui-surface border rounded-lg overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : warehouses.length === 0 ? (
          <div className="px-6 py-10 text-center ui-muted">No warehouses yet. Click "Create Warehouse" to add one.</div>
        ) : filteredWarehouses.length === 0 ? (
          <div className="px-6 py-10 text-center ui-muted">No warehouses found.</div>
        ) : (
          <table className="branch-table ui-table w-full table-fixed ui-settled">
            <colgroup><col style={{ width: '14%' }} /><col style={{ width: '22%' }} /><col style={{ width: '18%' }} /><col style={{ width: '16%' }} /><col style={{ width: '18%' }} /><col style={{ width: '8%' }} /><col style={{ width: '4%' }} /></colgroup>
            <thead className="ui-sunken border-b">
              <tr>
                <th className="ui-th">Warehouse Code</th>
                <th className="ui-th">Warehouse Name</th>
                <th className="ui-th">Branch</th>
                <th className="ui-th">Location</th>
                <th className="ui-th">GSTN</th>
                <th className="ui-th ui-col-h-center">Status</th>
                <th className="ui-th ui-num">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredWarehouses.map((w) => (
                <tr key={w.id} className="ui-hover-sunken">
                  <td className="ui-col-id px-4 py-3 ui-fg ui-mono">{w.code || ''}</td>
                  <td className="px-4 py-3 font-medium ui-fg">
                    <button type="button" className="text-left hover:underline" onClick={() => openView(w.id)}>{w.name || ''}</button>
                  </td>
                  <td className="ui-col-meta px-4 py-3 ui-fg">
                    {(() => {
                      const b = branchLookup.get(String(w.branchId || ''));
                      return (b && (b.branchName || b.name)) ? String(b.branchName || b.name) : '—';
                    })()}
                  </td>
                  <td className="ui-col-meta px-4 py-3 ui-fg">{w.city || ''}</td>
                  <td className="ui-col-id px-4 py-3 ui-fg">{w.gstin || ''}</td>
                  <td className="ui-col-meta px-4 py-3"><span className={`px-2 py-1 rounded-lg text-xs font-medium ${w.isActive !== false ? 'bg-[rgb(var(--pos-soft))] text-[rgb(var(--pos))]' : 'bg-[rgb(var(--neg-soft))] text-[rgb(var(--neg))]'}`}>{w.isActive !== false ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-3 text-right">
                    <div className="relative inline-block text-left" data-warehouse-actions>
                      <button
                        type="button"
                        ref={openMenuForWarehouseId === w.id ? menuAnchorRef : null}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuForWarehouseId((prev) => (prev === w.id ? null : w.id));
                        }}
                        className="ui-icon-btn"
                        aria-label={`Actions for ${w.name}`}
                      >
                        <MoreVertical size={15} />
                      </button>

                      {openMenuForWarehouseId === w.id ? (
                        <Popover
                          anchorRef={menuAnchorRef}
                          onClose={() => setOpenMenuForWarehouseId(null)}
                          minWidth={176}
                          maxWidth={240}
                        >
                          <button type="button" onClick={() => beginEdit(w)} className="report-menu-item flex items-center gap-2">
                            <Pencil size={14} /> Edit
                          </button>
                          <button type="button" onClick={() => toggleWarehouseStatus(w)} className="report-menu-item flex items-center gap-2">
                            <Power size={14} /> Mark {w.isActive !== false ? 'inactive' : 'active'}
                          </button>
                          <PermissionButton permission="MASTERS::Company/Branch setup::DELETE" type="button" onClick={() => removeWarehouse(w.id)} className="report-menu-item flex items-center gap-2 text-[rgb(var(--neg))] hover:bg-[rgb(var(--neg-soft))]">
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
