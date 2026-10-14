import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search } from 'lucide-react';
import { TableSkeleton } from '@ui/components/ui/Primitives';
import { exportRows } from '@ui/components/ListToolbar';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { confirmDialog } from '@ui/components/ui/notify';
import { listUsers,
  listRoles,
  createUser,
  deleteUser,
  assignUserRole,
  updateUser,
  setUserPrimaryRole,
  changeUserPassword,
  listBranches,
  assignUserBranches,
  getUserBranches,
  getUserCompanies,
  setUserCompanies } from '../../api/admin';
import Modal from '@ui/components/ui/Modal';
import Drawer from '@ui/components/ui/Drawer';
import Popover from '@ui/components/ui/Popover';
import { useFeatures } from '@ui/permissions/useFeatures';
import { rbacErrorMessage } from '@ui/permissions/rbacErrors';
import RoleSelect from './RoleSelect';
import UserAccessPanel from './UserAccessPanel';
import { PermissionButton } from '@ui/permissions/ActionGuard';

const normalizeId = (v) => String(v ?? '').trim();

const getBranchLabel = (b) => {
  if (!b) return '';
  const code = String(b.branchCode || b.code || '').trim();
  const name = String(b.branchName || b.name || '').trim();
  if (code && name) return `${code} - ${name}`;
  return name || code || `Branch ${String(b.id)}`;
};

export function SettingsUsers({ orgId }) {
  const { isEnabled } = useFeatures();
  const branchesEnabled = isEnabled('branches');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [headerHost, setHeaderHost] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openMenuForUserId, setOpenMenuForUserId] = useState(null);
  /** The trigger the open menu hangs from; only one row's menu is open. */
  const menuAnchorRef = useRef(null);
  const [viewUserId, setViewUserId] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({ fullName: '', email: '', roleId: '', isActive: true });
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    mobile: '',
    password: '',
    roleId: '',
  });

  const [createBranchIds, setCreateBranchIds] = useState([]);

  const [companiesModalUser, setCompaniesModalUser] = useState(null);
  const [companiesRows, setCompaniesRows] = useState([]);
  const [companiesChecked, setCompaniesChecked] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesSaving, setCompaniesSaving] = useState(false);

  const [assignBranchesModalOpen, setAssignBranchesModalOpen] = useState(false);
  const [assignBranchesUser, setAssignBranchesUser] = useState(null);
  const [assignBranchesLoading, setAssignBranchesLoading] = useState(false);
  const [assignBranchesSaving, setAssignBranchesSaving] = useState(false);
  const [assignBranchIds, setAssignBranchIds] = useState([]);

  const activeBranchId = String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim();

  const assignableRoles = roles.filter((r) => !r.branchId);

  const branchesSorted = useMemo(() => {
    return (Array.isArray(branches) ? branches : [])
      .slice()
      .sort((a, b) => getBranchLabel(a).localeCompare(getBranchLabel(b)));
  }, [branches]);

  const loadData = async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      let usersErr = null;
      let rolesErr = null;
      let branchesErr = null;

      try {
        const rRes = await listRoles(orgId);
        setRoles(Array.isArray(rRes.roles) ? rRes.roles : []);
      } catch (e) {
        rolesErr = e;
      }

      try {
        const uRes = await listUsers(orgId);
        setUsers(Array.isArray(uRes.users) ? uRes.users : []);
      } catch (e) {
        usersErr = e;
      }

      if (branchesEnabled) {
        try {
          const bRes = await listBranches(orgId);
          setBranches(Array.isArray(bRes.branches) ? bRes.branches : []);
        } catch (e) {
          branchesErr = e;
          setBranches([]);
        }
      } else {
        setBranches([]);
      }

      const msgs = [];
      if (rolesErr) msgs.push(`Roles: ${rolesErr.message || 'Failed to load'}`);
      if (usersErr) msgs.push(`Users: ${usersErr.message || 'Failed to load'}`);
      if (branchesErr) msgs.push(`Branches: ${branchesErr.message || 'Failed to load'}`);
      if (msgs.length) setError(msgs.join(' | '));
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [orgId, branchesEnabled]);

  useEffect(() => {
    setHeaderHost(document.getElementById('settings-users-header-slot'));
  }, []);

  const openCreate = () => {
    // default selection for branch mode
    const firstBranchId = branchesSorted?.[0]?.id != null ? String(branchesSorted[0].id) : '';
    const fallback = activeBranchId || firstBranchId;

    setForm({ fullName: '', email: '', mobile: '', password: '', roleId: '' });
    setCreateBranchIds(fallback ? [normalizeId(fallback)] : []);
    setShowForm(true);
    setError('');
  };

  const closeCreate = () => {
    setShowForm(false);
  };

  const allBranchIds = useMemo(() => {
    return (Array.isArray(branchesSorted) ? branchesSorted : []).map((b) => normalizeId(b?.id)).filter(Boolean);
  }, [branchesSorted]);

  const normalizeBranchIdArray = (ids) => Array.from(new Set((Array.isArray(ids) ? ids : []).map((x) => normalizeId(x)).filter(Boolean)));

  const isAllSelected = (ids) => {
    const set = new Set(normalizeBranchIdArray(ids));
    return allBranchIds.length > 0 && allBranchIds.every((id) => set.has(id));
  };

  const onChange = (k) => (e) => {
    setForm((p) => ({ ...p, [k]: e.target.value }));
    setError('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const selectedBranchIds = normalizeBranchIdArray(createBranchIds);
      const payload = {
        email: form.email,
        username: null,
        fullName: form.fullName,
        mobile: form.mobile,
        password: form.password,
        // attach the new user to the active org, and (if present) to the active branch
        orgIds: [orgId],
        branchIdsByOrg: {
          [orgId]: selectedBranchIds.length ? selectedBranchIds : activeBranchId ? [activeBranchId] : [],
        },
      };

      const res = await createUser(payload);

      if (form.roleId) {
        await assignUserRole(orgId, res.user.id, form.roleId, null);
      }

      setForm({ fullName: '', email: '', mobile: '', password: '', roleId: '' });
      closeCreate();
      await loadData();
    } catch (err) {
      setError(rbacErrorMessage(err, 'Failed to create user'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Which companies this person can work in.
   *
   * Access was granted a company at a time — switch company, invite the same
   * email, pick a role — so the answer to "what can this person see?" could
   * only be found by visiting every company and looking. A CA firm putting ten
   * clients on an intern made ten trips and had no way to check the result.
   */
  const openCompanies = async (u) => {
    if (!u?.id) return;
    setOpenMenuForUserId(null);
    setCompaniesModalUser(u);
    setCompaniesLoading(true);
    setError('');
    try {
      const res = await getUserCompanies(u.id);
      const rows = Array.isArray(res?.companies) ? res.companies : [];
      setCompaniesRows(rows);
      setCompaniesChecked(rows.filter((c) => c.hasAccess).map((c) => String(c.orgId)));
    } catch (e) {
      setCompaniesRows([]);
      setCompaniesChecked([]);
      setError(e?.message || String(e));
    } finally {
      setCompaniesLoading(false);
    }
  };

  const closeCompanies = () => {
    setCompaniesModalUser(null);
    setCompaniesRows([]);
    setCompaniesChecked([]);
    setCompaniesLoading(false);
    setCompaniesSaving(false);
  };

  const saveCompanies = async (e) => {
    e.preventDefault();
    if (!companiesModalUser?.id) return;
    setCompaniesSaving(true);
    setError('');
    try {
      await setUserCompanies(companiesModalUser.id, companiesChecked);
      closeCompanies();
    } catch (err) {
      setError(rbacErrorMessage(err, 'Failed to save company access'));
    } finally {
      setCompaniesSaving(false);
    }
  };

  const openAssignBranches = async (u) => {
    if (!u?.id) return;
    setOpenMenuForUserId(null);
    setAssignBranchesUser(u);
    setAssignBranchesModalOpen(true);
    setAssignBranchesLoading(true);
    setAssignBranchesSaving(false);
    setError('');

    try {
      const res = await getUserBranches(orgId, u.id);
      const current = Array.isArray(res?.branchIds) ? res.branchIds.map((x) => normalizeId(x)).filter(Boolean) : [];
      setAssignBranchIds(current);
    } catch (e) {
      // If we can't read existing assignments, still allow setting new ones.
      const firstBranchId = branchesSorted?.[0]?.id != null ? String(branchesSorted[0].id) : '';
      const fallback = activeBranchId || firstBranchId;
      setAssignBranchIds(fallback ? [normalizeId(fallback)] : []);
      setError(e?.message || String(e));
    } finally {
      setAssignBranchesLoading(false);
    }
  };

  const closeAssignBranches = async () => {
    setAssignBranchesModalOpen(false);
    setAssignBranchesUser(null);
    setAssignBranchesLoading(false);
    setAssignBranchesSaving(false);
    setAssignBranchIds([]);
  };

  const saveAssignBranches = async (e) => {
    e.preventDefault();
    if (!assignBranchesUser?.id) return;

    setAssignBranchesSaving(true);
    setError('');
    try {
      const branchIds = normalizeBranchIdArray(assignBranchIds);
      if (branchIds.length === 0) {
        setError('Please select at least one branch');
        return;
      }
      await assignUserBranches(orgId, assignBranchesUser.id, branchIds);
      closeAssignBranches();
    } catch (err) {
      setError(err?.message || 'Failed to assign branches');
    } finally {
      setAssignBranchesSaving(false);
    }
  };

  const removeUser = async (id) => {
    if (!await confirmDialog({ title: 'Please confirm', message: 'Remove this user?', confirmLabel: 'Yes, continue' })) return;
    try {
      await deleteUser(orgId, id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      setError(rbacErrorMessage(err, 'Failed to remove user'));
    }
  };

  const toggleUserActive = async (user) => {
    setOpenMenuForUserId(null);
    setError('');
    try {
      const nextActive = user.isActive === false;
      await updateUser(orgId, user.id, { isActive: nextActive });
      setUsers((rows) => rows.map((row) => (row.id === user.id ? { ...row, isActive: nextActive } : row)));
    } catch (err) {
      setError(err?.message || `Failed to ${user.isActive === false ? 'activate' : 'deactivate'} user`);
    }
  };

  const openView = (userId) => {
    setViewUserId(String(userId));
    setOpenMenuForUserId(null);
  };

  const closeView = () => {
    setViewUserId(null);
  };

  const beginEdit = (u) => {
    setEditingUserId(u.id);
    setEditForm({
      fullName: u.fullName || u.name || '',
      email: u.email || '',
      roleId: u.roleId || '',
      isActive: u.isActive !== false,
    });
    setOpenMenuForUserId(null);
    setError('');
  };

  const cancelEdit = () => {
    setEditingUserId(null);
    setEditForm({ fullName: '', email: '', roleId: '', isActive: true });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editingUserId) return;

    setEditSaving(true);
    setError('');
    try {
      await updateUser(orgId, editingUserId, {
        fullName: editForm.fullName,
        email: editForm.email,
        isActive: Boolean(editForm.isActive),
      });
      await setUserPrimaryRole(orgId, editingUserId, editForm.roleId || null);
      await loadData();
      cancelEdit();
    } catch (err) {
      setError(rbacErrorMessage(err, 'Failed to update user'));
    } finally {
      setEditSaving(false);
    }
  };

  const doChangePassword = async (u) => {
    setOpenMenuForUserId(null);
    const pwd = window.prompt(`Enter a new password for ${u.fullName || u.name || u.email}`);
    if (pwd === null) return; // cancelled
    if (String(pwd).trim().length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    try {
      await changeUserPassword(orgId, u.id, String(pwd));
    } catch (err) {
      setError(err.message || 'Failed to change password');
    }
  };

  const getRoleName = (roleId) => roles.find((r) => r.id === roleId)?.name || '—';

  const query = String(search || '').trim().toLowerCase();
  const filteredUsers = query
    ? users.filter((u) => {
        const name = String(u?.fullName || u?.name || '').toLowerCase();
        const email = String(u?.email || '').toLowerCase();
        const role = String(getRoleName(u?.roleId) || '').toLowerCase();
        return name.includes(query) || email.includes(query) || role.includes(query);
      })
    : users;

  const selectedUser = viewUserId ? users.find((u) => String(u.id) === String(viewUserId)) || null : null;

  const usersHeader = (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 px-3 py-1.5">
      <h2 className="ui-t-page">Users</h2>
      <label className="relative block w-full sm:w-72">
        <Search size={15} className="ui-subtle absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users"
          aria-label="Search users"
          className="ui-input ui-ctl-compact w-full ps-9 ui-surface"
        />
      </label>
      <MoreButton
        items={[{ key: 'export', label: 'Export users' }]}
        onSelect={() => exportRows({
          fileName: 'Users',
          label: 'user(s)',
          columns: [
            { key: 'fullName', label: 'Name' },
            { key: 'code', label: 'User ID' },
            { key: 'email', label: 'Email' },
            { key: 'username', label: 'Username' },
            { key: 'status', label: 'Status', value: (r) => (r.isActive === false ? 'Inactive' : 'Active') },
          ],
          rows: filteredUsers,
        })}
      />
      <PermissionButton permission="SETTINGS::Users::CREATE" type="button" onClick={openCreate} className="ui-btn ui-btn-primary">
        <Plus size={16} aria-hidden="true" /> Create User
      </PermissionButton>
    </div>
  );

  return (
    <div className="users-settings-page space-y-2">
      {headerHost ? createPortal(usersHeader, headerHost) : usersHeader}

      {error && <div className="text-sm text-[rgb(var(--neg))] bg-[rgb(var(--neg-soft))] border border-[rgb(var(--neg)/0.35)] rounded-lg p-3">{error}</div>}

      {selectedUser ? (
        <div className="ui-surface border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="ui-t-sec">User Details</div>
              <div className="text-xs ui-muted">{selectedUser.fullName || selectedUser.name || selectedUser.email || ''}</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => beginEdit(selectedUser)}
                className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken"
              >
                Edit
              </button>
              <button type="button" onClick={closeView} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                Close
              </button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-4 text-sm">
            <div className="col-span-12 sm:col-span-4">
              <div className="ui-detail-label">Name</div>
              <div className="ui-detail-value">{selectedUser.fullName || selectedUser.name || '—'}</div>
            </div>
            <div className="col-span-12 sm:col-span-4">
              <div className="ui-detail-label">Email</div>
              <div className="ui-detail-value">{selectedUser.email || '—'}</div>
            </div>
            <div className="col-span-12 sm:col-span-4">
              <div className="ui-detail-label">Role</div>
              <div className="ui-detail-value">{getRoleName(selectedUser.roleId)}</div>
            </div>

            <div className="col-span-12 sm:col-span-4">
              <div className="ui-detail-label">Status</div>
              <div className="ui-detail-value">{selectedUser.isActive !== false ? 'Active' : 'Inactive'}</div>
            </div>
            <div className="col-span-12 sm:col-span-8">
              <div className="ui-detail-label">User ID</div>
              <div className="ui-detail-value ui-detail-mono">{selectedUser.code || '—'}</div>
            </div>
          </div>
          <section aria-label="What this person can do" className="pt-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
            <div className="ui-t-sec mb-2">What they can do</div>
            <UserAccessPanel key={selectedUser.id} orgId={orgId} userId={selectedUser.id} />
          </section>
        </div>
      ) : null}

      <Drawer
        open={showForm}
        onClose={closeCreate}
        title="Create User"
        widthClass="w-[min(38rem,92vw)]"
        actions={(
          <>
            <button type="button" onClick={closeCreate} className="ui-btn ui-btn-secondary">Cancel</button>
            <button type="submit" form="create-user-form" disabled={saving} className="ui-btn ui-btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      >
        <form id="create-user-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="ui-label" htmlFor="settingsusers-full-name">Name *</label>
            <input id="settingsusers-full-name" className="ui-input w-full" value={form.fullName} onChange={onChange('fullName')} required autoFocus />
          </div>
          <div className="sm:col-span-2">
            <label className="ui-label" htmlFor="settingsusers-email">Email *</label>
            <input id="settingsusers-email" type="email" className="ui-input w-full" value={form.email} onChange={onChange('email')} required />
          </div>
          <div>
            <label className="ui-label" htmlFor="settingsusers-mobile">Mobile</label>
            <input id="settingsusers-mobile" type="tel" className="ui-input w-full" value={form.mobile} onChange={onChange('mobile')} />
          </div>
          <div>
            <label className="ui-label" htmlFor="settingsusers-temp-password">Temporary Password *</label>
            <input id="settingsusers-temp-password" type="password" minLength={8} className="ui-input w-full" value={form.password} onChange={onChange('password')} required />
          </div>
          <div className="sm:col-span-2">
            <label className="ui-label" htmlFor="settingsusers-role">Role</label>
            <select id="settingsusers-role" className="ui-select w-full ui-surface" value={form.roleId} onChange={onChange('roleId')}>
              <option value="">— No role —</option>
              {assignableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </div>
        </form>
      </Drawer>

      {companiesModalUser ? (
        <Modal
          onClose={closeCompanies}
          title={`Companies: ${companiesModalUser.fullName || companiesModalUser.name || companiesModalUser.email}`}
          maxWidthClass="max-w-2xl"
        >
          <form onSubmit={saveCompanies} className="space-y-4">
            <p className="text-sm ui-muted">
              Every company in this account. Unticking one takes the access away, and the role that came with it.
            </p>

            {companiesLoading ? <div className="text-sm ui-muted">Loading…</div> : null}

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-72 overflow-y-auto divide-y">
                {companiesRows.length === 0 && !companiesLoading ? (
                  <div className="px-4 py-3 text-sm ui-muted">No companies in this account yet.</div>
                ) : null}
                {companiesRows.map((c) => {
                  const id = String(c.orgId);
                  const on = companiesChecked.includes(id);
                  return (
                    <label key={id} className="flex items-center gap-3 px-4 py-3 ui-hover-sunken cursor-pointer">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={on}
                        onChange={(e) =>
                          setCompaniesChecked((prev) =>
                            e.target.checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)
                          )
                        }
                      />
                      <div className="min-w-0">
                        <div className="font-medium ui-fg truncate">{c.name}</div>
                        <div className="ui-caption ui-muted">
                          {c.role?.name ? `Role: ${c.role.name}` : on ? 'No role set for this company yet' : 'No access'}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeCompanies} className="ui-btn ui-btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={companiesSaving} className="ui-btn ui-btn-primary">
                {companiesSaving ? 'Saving…' : 'Save access'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {branchesEnabled && assignBranchesModalOpen ? (
        <Modal
          onClose={closeAssignBranches}
          title={`Assign Branches${assignBranchesUser?.fullName || assignBranchesUser?.name ? `: ${assignBranchesUser.fullName || assignBranchesUser.name}` : ''}`}
          maxWidthClass="max-w-3xl"
        >
          <form onSubmit={saveAssignBranches} className="space-y-4">
            {assignBranchesLoading ? <div className="text-sm ui-muted">Loading…</div> : null}

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-56 overflow-y-auto divide-y">
                <label className="flex items-center gap-3 px-4 py-3 ui-hover-sunken cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAllSelected(assignBranchIds)}
                    onChange={(e) => {
                      const wantAll = Boolean(e.target.checked);
                      setAssignBranchIds(wantAll ? allBranchIds : []);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div>
                    <div className="font-medium ui-fg">All branches</div>
                    <div className="text-xs ui-muted">Give access to every branch</div>
                  </div>
                </label>

                {branchesSorted.length === 0 ? (
                  <div className="px-4 py-10 text-center ui-muted">No branches</div>
                ) : (
                  branchesSorted.map((b) => {
                    const id = normalizeId(b?.id);
                    const checked = normalizeBranchIdArray(assignBranchIds).includes(id);
                    return (
                      <label key={id} className="flex items-center gap-3 px-4 py-3 ui-hover-sunken cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const want = Boolean(e.target.checked);
                            setAssignBranchIds((prev) => {
                              const cur = new Set(normalizeBranchIdArray(prev));
                              if (want) cur.add(id);
                              else cur.delete(id);
                              return Array.from(cur);
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="ui-fg">{getBranchLabel(b) || `Branch ${id}`}</div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeAssignBranches} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                Cancel
              </button>
              <button
                type="submit"
                disabled={assignBranchesSaving || assignBranchesLoading}
                className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50"
              >
                {assignBranchesSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editingUserId ? (
        <form onSubmit={saveEdit} className="ui-surface border rounded-xl p-5 space-y-4">
          <div className="ui-t-sec">Edit User</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-label" htmlFor="settingsusers-full-name-2">Full Name *</label>
              <input id="settingsusers-full-name-2"
                className="ui-input w-full"
                value={editForm.fullName}
                onChange={(e) => setEditForm((p) => ({ ...p, fullName: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="settingsusers-email-2">Email *</label>
              <input id="settingsusers-email-2"
                type="email"
                className="ui-input w-full"
                value={editForm.email}
                onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-label" htmlFor="settingsusers-role-2">Role</label>
              <RoleSelect
                id="settingsusers-role-2"
                roles={assignableRoles}
                value={editForm.roleId}
                onChange={(roleId) => setEditForm((p) => ({ ...p, roleId }))}
              />
            </div>
            <div>
              <label className="ui-label" htmlFor="settingsusers-status">Status</label>
              <select id="settingsusers-status"
                className="ui-select w-full ui-surface"
                value={editForm.isActive ? 'active' : 'inactive'}
                onChange={(e) => setEditForm((p) => ({ ...p, isActive: e.target.value === 'active' }))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancelEdit} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="px-4 py-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50"
            >
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="ui-surface border rounded-xl overflow-hidden users-list-card">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : users.length === 0 ? (
          <div className="px-6 py-10 text-center ui-muted">No users yet. Click "Create User" to add one.</div>
        ) : filteredUsers.length === 0 ? (
          <div className="px-6 py-10 text-center ui-muted">No users found.</div>
        ) : (
          <table className="ui-table w-full ui-settled users-settings-table">
            <thead className="ui-sunken border-b">
              <tr>
                <th className="ui-th">Name</th>
                <th className="ui-th">User ID</th>
                <th className="ui-th">Email</th>
                <th className="ui-th">Role</th>
                <th className="ui-th ui-col-h-center">Status</th>
                <th className="ui-th ui-num">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="ui-hover-sunken">
                  <td className="font-medium ui-fg">
                    <button type="button" className="text-left hover:underline" onClick={() => openView(u.id)}>
                      {u.fullName || u.name}
                    </button>
                  </td>
                  <td className="ui-col-meta ui-fg font-mono text-xs whitespace-nowrap">{u.code || '—'}</td>
                  <td className="ui-col-entity ui-fg">{u.email}</td>
                  <td className="ui-col-meta ui-fg">{getRoleName(u.roleId)}</td>
                  <td className="ui-col-meta">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${u.isActive !== false ? 'bg-[rgb(var(--pos-soft))] text-[rgb(var(--pos))]' : 'bg-[rgb(var(--neg-soft))] text-[rgb(var(--neg))]'}`}>
                      {u.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="relative inline-block text-left" data-user-actions>
                      <button
                        type="button"
                        ref={openMenuForUserId === u.id ? menuAnchorRef : null}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuForUserId((prev) => (prev === u.id ? null : u.id));
                        }}
                        className="px-2 py-1 rounded-lg border ui-surface ui-hover-sunken"
                        aria-label="User actions"
                      >
                        ⋯
                      </button>

                      {openMenuForUserId === u.id ? (
                        <Popover
                          anchorRef={menuAnchorRef}
                          onClose={() => setOpenMenuForUserId(null)}
                          minWidth={200}
                          maxWidth={260}
                        >
                          <button
                            type="button"
                            onClick={() => beginEdit(u)}
                            className="w-full text-left px-3 py-2 text-sm ui-hover-sunken"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleUserActive(u)}
                            className="w-full text-left px-3 py-2 text-sm ui-hover-sunken"
                          >
                            {u.isActive === false ? 'Activate' : 'Deactivate'}
                          </button>
                          {/* Company access (platform memberships), branch access
                              and password reset: their dialogs are still here,
                              so they keep a way in. */}
                          <button
                            type="button"
                            onClick={() => openCompanies(u)}
                            className="w-full text-left px-3 py-2 text-sm ui-hover-sunken"
                          >
                            Companies
                          </button>
                          {branchesEnabled ? <button
                            type="button"
                            onClick={() => openAssignBranches(u)}
                            className="w-full text-left px-3 py-2 text-sm ui-hover-sunken"
                          >
                            Assign Branches
                          </button> : null}
                          <button
                            type="button"
                            onClick={() => doChangePassword(u)}
                            className="w-full text-left px-3 py-2 text-sm ui-hover-sunken"
                          >
                            Change Password
                          </button>
                          <PermissionButton permission="SETTINGS::Users::DELETE"
                            type="button"
                            onClick={() => removeUser(u.id)}
                            className="w-full text-left px-3 py-2 text-sm text-[rgb(var(--neg))] hover:bg-[rgb(var(--neg-soft))]"
                          >
                            Delete
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
