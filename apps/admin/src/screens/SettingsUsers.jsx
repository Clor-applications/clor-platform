import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, Search } from 'lucide-react';

import { MoreButton } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { confirmDialog } from '@ui/components/ui/notify';
import {
  listUsers,
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
  setUserCompanies,
  getLeaving,
  markUserLeft,
  reactivateUser,
} from '@platform/admin/admin';
import Popover from '@ui/components/ui/Popover';
import { useFeatures } from '@ui/permissions/useFeatures';
import { rbacErrorMessage } from '@ui/permissions/rbacErrors';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { selectedBranchId } from '@platform/context';
import RoleSelect from './RoleSelect';
import UserAccessPanel from './UserAccessPanel';
import { ICON, PageHead, Stat, WsDrawer } from './wsKit';
import './workspace.css';

/**
 * Workspace → Access → Users (redesign W-R6).
 *
 * The logins of this company: who they are, the role each holds here, and
 * whether they may sign in. Every act opens in one side drawer — details,
 * edit, the companies a person works in, their branches, a new password —
 * so the list stays where it is. Every call and permission check is the one
 * the screen always used; the server decides and its refusal is shown as is.
 */
const normalizeId = (v) => String(v ?? '').trim();
const uniqueIds = (ids) => Array.from(new Set((Array.isArray(ids) ? ids : []).map(normalizeId).filter(Boolean)));

const branchLabel = (b) => {
  if (!b) return '';
  const code = String(b.branchCode || b.code || '').trim();
  const name = String(b.branchName || b.name || '').trim();
  if (code && name) return `${code} - ${name}`;
  return name || code || `Branch ${String(b.id)}`;
};
const nameOf = (u) => u?.fullName || u?.name || u?.email || '';

/** Users that match the search and the status filter. */
export function filterUsers(users, { q = '', status = '' }, roleName = () => '') {
  const needle = q.trim().toLowerCase();
  return users.filter((u) => {
    if (status === 'active' && u.isActive === false) return false;
    if (status === 'inactive' && u.isActive !== false) return false;
    if (!needle) return true;
    return [nameOf(u), u.email, u.code, roleName(u.roleId)].some((s) => String(s || '').toLowerCase().includes(needle));
  });
}

const EMPTY_FORM = { fullName: '', email: '', mobile: '', password: '', roleId: '' };

const LEFT_REASON = { RESIGNED: 'Resigned', TERMINATED: 'Employment ended', ROLE_CHANGED: 'Moved to a role without access', CONTRACT_ENDED: 'Contract ended', RETIRED: 'Retired', OTHER: 'Other' };
const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
/** "Resigned · last day 31 Oct 2026". */
const leftLine = (left) => [LEFT_REASON[left?.reason] || 'Left', left?.lastWorkingDay ? `last day ${shortDate(left.lastWorkingDay)}` : ''].filter(Boolean).join(' · ');
const statusPill = (u) =>
  u.left ? <span className="ws-pill ws-pill--off">Left</span> : u.isActive !== false ? <span className="ws-pill ws-pill--ok">Active</span> : <span className="ws-pill ws-pill--off">Inactive</span>;

export function SettingsUsers({ orgId }) {
  const { isEnabled } = useFeatures();
  const branchesEnabled = isEnabled('branches');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [menuFor, setMenuFor] = useState(null);
  const menuAnchorRef = useRef(null);

  /* The drawer: { kind: 'create' | 'view' | 'edit' | 'companies' | 'branches' | 'password', user } */
  const [panel, setPanel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createBranchIds, setCreateBranchIds] = useState([]);
  const [editForm, setEditForm] = useState({ fullName: '', email: '', roleId: '', isActive: true });
  const [companyRows, setCompanyRows] = useState([]);
  const [companyChecked, setCompanyChecked] = useState([]);
  const [branchIds, setBranchIds] = useState([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [password, setPassword] = useState('');
  /* Mark as left (services/leavers.ts on the server). */
  const [leave, setLeave] = useState(null);

  const activeBranchId = String(selectedBranchId() || '').trim();
  const assignableRoles = roles.filter((r) => !r.branchId);
  const branchesSorted = useMemo(() => (Array.isArray(branches) ? branches : []).slice().sort((a, b) => branchLabel(a).localeCompare(branchLabel(b))), [branches]);
  const allBranchIds = useMemo(() => branchesSorted.map((b) => normalizeId(b?.id)).filter(Boolean), [branchesSorted]);
  const roleName = (roleId) => roles.find((r) => r.id === roleId)?.name || '';
  const defaultBranch = () => activeBranchId || (branchesSorted[0]?.id != null ? String(branchesSorted[0].id) : '');

  const loadData = async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    const msgs = [];
    try {
      const r = await listRoles(orgId);
      setRoles(Array.isArray(r.roles) ? r.roles : []);
    } catch (e) {
      msgs.push(`Roles: ${e.message || 'Failed to load'}`);
    }
    try {
      const u = await listUsers(orgId);
      setUsers(Array.isArray(u.users) ? u.users : []);
    } catch (e) {
      msgs.push(`Users: ${e.message || 'Failed to load'}`);
    }
    if (branchesEnabled) {
      try {
        const b = await listBranches(orgId);
        setBranches(Array.isArray(b.branches) ? b.branches : []);
      } catch (e) {
        setBranches([]);
        msgs.push(`Branches: ${e.message || 'Failed to load'}`);
      }
    } else {
      setBranches([]);
    }
    if (msgs.length) setError(msgs.join(' | '));
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [orgId, branchesEnabled]);

  const open = (kind, user = null) => {
    setMenuFor(null);
    setError('');
    setPanel({ kind, user });
  };
  const close = () => {
    setPanel(null);
    setBusy(false);
    setPanelLoading(false);
    setPassword('');
  };

  const openCreate = () => {
    const first = defaultBranch();
    setForm(EMPTY_FORM);
    setCreateBranchIds(first ? [normalizeId(first)] : []);
    open('create');
  };

  const openEdit = (u) => {
    setEditForm({ fullName: u.fullName || u.name || '', email: u.email || '', roleId: u.roleId || '', isActive: u.isActive !== false });
    open('edit', u);
  };

  /**
   * Which companies this person can work in, all on one list: access was
   * granted a company at a time, so the answer to "what can this person see?"
   * meant visiting every company. Unticking one takes the access away.
   */
  const openCompanies = async (u) => {
    open('companies', u);
    setPanelLoading(true);
    try {
      const res = await getUserCompanies(u.id);
      const rows = Array.isArray(res?.companies) ? res.companies : [];
      setCompanyRows(rows);
      setCompanyChecked(rows.filter((c) => c.hasAccess).map((c) => String(c.orgId)));
    } catch (e) {
      setCompanyRows([]);
      setCompanyChecked([]);
      setError(e?.message || String(e));
    } finally {
      setPanelLoading(false);
    }
  };

  const openBranches = async (u) => {
    open('branches', u);
    setPanelLoading(true);
    try {
      const res = await getUserBranches(orgId, u.id);
      setBranchIds(Array.isArray(res?.branchIds) ? uniqueIds(res.branchIds) : []);
    } catch (e) {
      /* Could not read what they have: still allow setting it. */
      const first = defaultBranch();
      setBranchIds(first ? [normalizeId(first)] : []);
      setError(e?.message || String(e));
    } finally {
      setPanelLoading(false);
    }
  };

  const act = async (fn, fallback) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (err) {
      setError(rbacErrorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = (e) => {
    e.preventDefault();
    act(async () => {
      const picked = uniqueIds(createBranchIds);
      const res = await createUser({
        email: form.email,
        username: null,
        fullName: form.fullName,
        mobile: form.mobile,
        password: form.password,
        /* The new login joins this company, and its branch when one is open. */
        orgIds: [orgId],
        branchIdsByOrg: { [orgId]: picked.length ? picked : activeBranchId ? [activeBranchId] : [] },
      });
      if (form.roleId) await assignUserRole(orgId, res.user.id, form.roleId, null);
      close();
      await loadData();
    }, 'Failed to create user');
  };

  const submitEdit = (e) => {
    e.preventDefault();
    const id = panel?.user?.id;
    if (!id) return;
    act(async () => {
      await updateUser(orgId, id, { fullName: editForm.fullName, email: editForm.email, isActive: Boolean(editForm.isActive) });
      await setUserPrimaryRole(orgId, id, editForm.roleId || null);
      close();
      await loadData();
    }, 'Failed to update user');
  };

  const submitCompanies = (e) => {
    e.preventDefault();
    act(async () => {
      await setUserCompanies(panel.user.id, companyChecked);
      close();
    }, 'Failed to save company access');
  };

  const submitBranches = (e) => {
    e.preventDefault();
    const ids = uniqueIds(branchIds);
    if (!ids.length) {
      setError('Choose at least one branch.');
      return;
    }
    act(async () => {
      await assignUserBranches(orgId, panel.user.id, ids);
      close();
    }, 'Failed to assign branches');
  };

  const submitPassword = (e) => {
    e.preventDefault();
    if (password.trim().length < 8) {
      setError('The password needs at least 8 characters.');
      return;
    }
    act(async () => {
      await changeUserPassword(orgId, panel.user.id, password);
      close();
    }, 'Failed to change password');
  };

  /* Leaving is not a switch: it asks why and when, and who takes over what was waiting on them. */
  const openLeave = async (u) => {
    open('leave', u);
    setLeave({ reason: '', lastWorkingDay: new Date().toISOString().slice(0, 10), note: '', handoverUserId: '', releaseEmail: false, reasons: [], pending: null });
    try {
      const info = await getLeaving(orgId, u.id);
      setLeave((l) => (l ? { ...l, reasons: info.reasons || [], pending: info.pending || null } : l));
    } catch (err) {
      setError(rbacErrorMessage(err, 'Could not load what was waiting on them'));
    }
  };
  const submitLeave = (e) => {
    e.preventDefault();
    const u = panel?.user;
    if (!u || !leave) return;
    act(async () => {
      await markUserLeft(orgId, u.id, {
        reason: leave.reason,
        lastWorkingDay: leave.lastWorkingDay,
        note: leave.note || null,
        handoverUserId: leave.handoverUserId || null,
        releaseEmail: leave.releaseEmail,
      });
      setUsers((rows) => rows.map((r) => (r.id === u.id ? { ...r, isActive: false, left: { reason: leave.reason, lastWorkingDay: leave.lastWorkingDay, note: leave.note || null } } : r)));
      close();
    }, 'Could not mark them as left');
  };
  const bringBack = async (u) => {
    setMenuFor(null);
    setError('');
    if (!(await confirmDialog({ title: `Reactivate ${nameOf(u)}?`, message: 'They can sign in again with their roles as they were. This takes a seat on your plan.', confirmLabel: 'Reactivate' }))) return;
    try {
      const out = await reactivateUser(orgId, u.id);
      setUsers((rows) => rows.map((r) => (r.id === u.id ? { ...r, isActive: true, left: null } : r)));
      if (panel?.user?.id === u.id) setPanel((p) => (p ? { ...p, user: { ...p.user, isActive: true, left: null } } : p));
      if (out?.emailRestored === false) setError('Reactivated. Their old email address now belongs to someone else: give them a new one under Edit.');
    } catch (err) {
      setError(rbacErrorMessage(err, 'Could not reactivate'));
    }
  };

  const remove = async (u) => {
    setMenuFor(null);
    if (!(await confirmDialog({ title: `Remove ${nameOf(u)}?`, message: 'They lose this company and every role in it.', confirmLabel: 'Remove' }))) return;
    try {
      await deleteUser(orgId, u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      if (panel?.user?.id === u.id) close();
    } catch (err) {
      setError(rbacErrorMessage(err, 'Failed to remove user'));
    }
  };

  const rows = filterUsers(users, filters, roleName);
  const active = users.filter((u) => u.isActive !== false).length;
  const noRole = users.filter((u) => !u.roleId).length;
  const exportUsers = (key) => {
    const format = exportFormatFromKey(key);
    if (!format) return;
    runListExport({
      format,
      title: 'Users',
      fileName: 'Users',
      label: 'user(s)',
      columns: [
        { key: 'fullName', label: 'Name' },
        { key: 'code', label: 'User ID' },
        { key: 'email', label: 'Email' },
        { key: 'username', label: 'Username' },
        { key: 'role', label: 'Role', value: (r) => roleName(r.roleId) },
        { key: 'status', label: 'Status', value: (r) => (r.left ? `Left: ${leftLine(r.left)}` : r.isActive === false ? 'Inactive' : 'Active') },
      ],
      rows,
    });
  };

  const errorNote = error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null;
  const u = panel?.user;
  const quiet = (label, onClick, extra = {}) => (
    <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={onClick} {...extra}>{label}</button>
  );
  const checkRow = (key, checked, onToggle, title, sub) => (
    <li key={key}>
      <label className="ws-item" style={{ cursor: 'pointer' }}>
        <input type="checkbox" className="ui-checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <span className="ws-item-text">
          <span className="ws-item-title">{title}</span>
          {sub ? <span className="ws-item-sub">{sub}</span> : null}
        </span>
      </label>
    </li>
  );
  const footer = (formId, label) => (
    <>
      <button type="button" className="ws-btn ws-btn--quiet" onClick={close}>Cancel</button>
      <button type="submit" form={formId} className="ws-btn ws-btn--primary" disabled={busy || panelLoading}>{busy ? 'Saving…' : label}</button>
    </>
  );

  let drawer = { title: '', description: '', actions: null, body: null };
  if (panel?.kind === 'create') {
    drawer = {
      title: 'Add user',
      description: 'They sign in with this email and the temporary password.',
      actions: footer('ws-user-create', 'Add user'),
      body: (
        <form id="ws-user-create" onSubmit={submitCreate} className="grid gap-4 sm:grid-cols-2">
          {errorNote ? <div className="sm:col-span-2">{errorNote}</div> : null}
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Name <span aria-hidden="true">*</span></span>
            <input className="ui-input w-full" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} required autoComplete="name" />
          </label>
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Email <span aria-hidden="true">*</span></span>
            <input type="email" className="ui-input w-full" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required autoComplete="off" spellCheck={false} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Mobile</span>
            <input type="tel" inputMode="tel" className="ui-input w-full" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Temporary password <span aria-hidden="true">*</span></span>
            <input type="password" minLength={8} className="ui-input w-full" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required autoComplete="new-password" />
            <span className="ui-caption">At least 8 characters.</span>
          </label>
          <div className="grid gap-1 sm:col-span-2">
            <label className="text-sm font-medium" htmlFor="ws-user-role">Role</label>
            <RoleSelect id="ws-user-role" roles={assignableRoles} value={form.roleId} onChange={(roleId) => setForm((f) => ({ ...f, roleId }))} />
          </div>
        </form>
      ),
    };
  } else if (panel?.kind === 'view' && u) {
    drawer = {
      title: nameOf(u),
      description: u.email || '',
      actions: null,
      body: (
        <div className="grid gap-5">
          {errorNote}
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="ws-stat-note">Role</dt><dd className="text-sm font-medium">{roleName(u.roleId) || 'No role'}</dd></div>
            <div><dt className="ws-stat-note">Status</dt><dd>{statusPill(u)}</dd></div>
            {u.left ? (
              <div className="sm:col-span-2"><dt className="ws-stat-note">Left</dt><dd className="text-sm">{leftLine(u.left)}{u.left.note ? ` — ${u.left.note}` : ''}</dd></div>
            ) : null}
            <div><dt className="ws-stat-note">User ID</dt><dd className="text-sm ui-mono">{u.code || '—'}</dd></div>
            <div><dt className="ws-stat-note">Username</dt><dd className="text-sm">{u.username || '—'}</dd></div>
          </dl>
          <div className="ws-actions">
            {quiet('Edit', () => openEdit(u))}
            {quiet('Companies', () => openCompanies(u))}
            {branchesEnabled ? quiet('Branches', () => openBranches(u)) : null}
            {quiet('Set a password', () => open('password', u))}
            {u.isActive === false ? quiet('Reactivate', () => bringBack(u)) : quiet('Mark as left', () => openLeave(u))}
          </div>
          <section aria-labelledby="ws-user-can" className="grid gap-2" style={{ borderTop: '1px solid rgb(var(--ws-line))', paddingTop: 16 }}>
            <h3 id="ws-user-can" className="ws-panel-title">What they can do</h3>
            <UserAccessPanel key={u.id} orgId={orgId} userId={u.id} />
          </section>
        </div>
      ),
    };
  } else if (panel?.kind === 'edit' && u) {
    drawer = {
      title: `Edit ${nameOf(u)}`,
      description: '',
      actions: footer('ws-user-edit', 'Save changes'),
      body: (
        <form id="ws-user-edit" onSubmit={submitEdit} className="grid gap-4 sm:grid-cols-2">
          {errorNote ? <div className="sm:col-span-2">{errorNote}</div> : null}
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Name <span aria-hidden="true">*</span></span>
            <input className="ui-input w-full" value={editForm.fullName} onChange={(e) => setEditForm((p) => ({ ...p, fullName: e.target.value }))} required />
          </label>
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Email <span aria-hidden="true">*</span></span>
            <input type="email" className="ui-input w-full" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} required spellCheck={false} />
          </label>
          <div className="grid gap-1">
            <label className="text-sm font-medium" htmlFor="ws-user-edit-role">Role</label>
            <RoleSelect id="ws-user-edit-role" roles={assignableRoles} value={editForm.roleId} onChange={(roleId) => setEditForm((p) => ({ ...p, roleId }))} />
          </div>
          <label className="grid gap-1 content-start">
            <span className="text-sm font-medium">Status</span>
            <select className="ui-select w-full" value={editForm.isActive ? 'active' : 'inactive'} onChange={(e) => setEditForm((p) => ({ ...p, isActive: e.target.value === 'active' }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </form>
      ),
    };
  } else if (panel?.kind === 'companies' && u) {
    drawer = {
      title: `Companies: ${nameOf(u)}`,
      description: 'Unticking a company removes their access and role there.',
      actions: footer('ws-user-companies', 'Save access'),
      body: (
        <form id="ws-user-companies" onSubmit={submitCompanies} className="grid gap-3">
          {errorNote}
          {panelLoading ? <p className="ws-card-blurb">Loading companies…</p> : null}
          {!panelLoading && companyRows.length === 0 ? <p className="ws-card-blurb">No companies in this account yet.</p> : null}
          <ul className="ws-list">
            {companyRows.map((c) => {
              const id = String(c.orgId);
              const on = companyChecked.includes(id);
              return checkRow(id, on, (want) => setCompanyChecked((prev) => (want ? uniqueIds([...prev, id]) : prev.filter((x) => x !== id))), c.name, c.role?.name ? `Role: ${c.role.name}` : on ? 'No role set for this company yet' : 'No access');
            })}
          </ul>
        </form>
      ),
    };
  } else if (panel?.kind === 'branches' && u) {
    const picked = new Set(uniqueIds(branchIds));
    const all = allBranchIds.length > 0 && allBranchIds.every((id) => picked.has(id));
    drawer = {
      title: `Branches: ${nameOf(u)}`,
      description: '',
      actions: footer('ws-user-branches', 'Save branches'),
      body: (
        <form id="ws-user-branches" onSubmit={submitBranches} className="grid gap-3">
          {errorNote}
          {panelLoading ? <p className="ws-card-blurb">Loading branches…</p> : null}
          <ul className="ws-list">
            {checkRow('__all', all, (want) => setBranchIds(want ? allBranchIds : []), 'All branches', 'Access to every branch')}
            {branchesSorted.map((b) => {
              const id = normalizeId(b?.id);
              return checkRow(id, picked.has(id), (want) => setBranchIds((prev) => {
                const next = new Set(uniqueIds(prev));
                if (want) next.add(id);
                else next.delete(id);
                return [...next];
              }), branchLabel(b));
            })}
          </ul>
          {!panelLoading && branchesSorted.length === 0 ? <p className="ws-card-blurb">No branches yet. Add them under Company → Branches.</p> : null}
        </form>
      ),
    };
  } else if (panel?.kind === 'leave' && u && leave) {
    const p = leave.pending;
    const waiting = p ? p.approvals + p.deskRequests + p.exceptions : 0;
    const successors = users.filter((x) => x.id !== u.id && x.isActive !== false);
    drawer = {
      title: `${nameOf(u)} has left`,
      description: 'They stop signing in at once. Their name stays on everything they did, and their seat is free for someone new.',
      actions: footer('ws-user-leave', 'Mark as left'),
      body: (
        <form id="ws-user-leave" onSubmit={submitLeave} className="grid gap-4">
          {errorNote}
          <label className="grid gap-1">
            <span className="text-sm font-medium">Why they left</span>
            <select className="ui-select w-full" required value={leave.reason} onChange={(e) => setLeave((l) => ({ ...l, reason: e.target.value }))}>
              <option value="">Choose a reason</option>
              {leave.reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Last working day</span>
            <input type="date" className="ui-input w-full" required value={leave.lastWorkingDay} onChange={(e) => setLeave((l) => ({ ...l, lastWorkingDay: e.target.value }))} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Note <span className="ui-caption">· optional</span></span>
            <textarea className="ui-input w-full" rows={2} maxLength={1000} value={leave.note} onChange={(e) => setLeave((l) => ({ ...l, note: e.target.value }))} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Hand over their work to</span>
            <select className="ui-select w-full" value={leave.handoverUserId} onChange={(e) => setLeave((l) => ({ ...l, handoverUserId: e.target.value }))}>
              <option value="">Nobody</option>
              {successors.map((x) => <option key={x.id} value={x.id}>{nameOf(x)}</option>)}
            </select>
            <span className="ui-caption">
              {p == null ? 'Checking what is waiting on them…' : waiting ? `Waiting on them: ${p.approvals} approvals, ${p.deskRequests} HR requests, ${p.exceptions} attendance exceptions.` : 'Nothing is waiting on them.'}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={leave.releaseEmail} onChange={(e) => setLeave((l) => ({ ...l, releaseEmail: e.target.checked }))} />
            <span className="text-sm">Free their email address for the next person <span className="ui-caption">(for a shared address like accounts@)</span></span>
          </label>
        </form>
      ),
    };
  } else if (panel?.kind === 'password' && u) {
    drawer = {
      title: `New password for ${nameOf(u)}`,
      description: 'Not sent anywhere. Tell them yourself.',
      actions: footer('ws-user-password', 'Set password'),
      body: (
        <form id="ws-user-password" onSubmit={submitPassword} className="grid gap-3">
          {errorNote}
          <label className="grid gap-1">
            <span className="text-sm font-medium">New password</span>
            <input type="password" minLength={8} className="ui-input w-full" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
            <span className="ui-caption">At least 8 characters.</span>
          </label>
        </form>
      ),
    };
  }

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Access', 'Users']}
          title="Users"
          actions={
            <>
              <MoreButton items={[exportMenuItem('Export users')]} onSelect={exportUsers} />
              <PermissionButton permission="SETTINGS::Users::CREATE" type="button" onClick={openCreate} className="ws-btn ws-btn--primary">
                <Plus size={16} aria-hidden="true" /> Add user
              </PermissionButton>
            </>
          }
        />

        {users.length ? (
          <div className="ws-stats">
            <Stat icon={ICON.people} label="Users" value={users.length} note={`${active} can sign in`} />
            <Stat icon={ICON.person} tone={users.length - active ? 'warn' : null} label="Inactive" value={users.length - active} note={users.length - active ? 'Kept, but cannot sign in' : 'Nobody is switched off'} onOpen={users.length - active ? () => setFilters((f) => ({ ...f, status: f.status === 'inactive' ? '' : 'inactive' })) : undefined} />
            <Stat icon={ICON.secure} tone={noRole ? 'warn' : null} label="Without a role" value={noRole} note={noRole ? 'They can sign in but open nothing' : 'Everyone has a role'} />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 items-center" role="search">
          <label className="relative flex-1 min-w-[14rem]" style={{ maxWidth: 420 }}>
            <span className="sr-only">Search users</span>
            <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
            <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Search name, email, user ID or role" />
          </label>
          <select className="ui-select" aria-label="Status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} style={{ width: 'auto' }}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <span className="ws-head-meta">{rows.length} {rows.length === 1 ? 'user' : 'users'}</span>
        </div>

        {error && !panel ? errorNote : null}

        {loading && !users.length ? (
          <p className="ws-card-blurb">Loading users…</p>
        ) : rows.length === 0 ? (
          <div className="ws-setup">
            <p className="ws-card-blurb">{users.length ? 'No user matches this search.' : 'No users yet. Add the first one.'}</p>
          </div>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Users of this company</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User ID</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className="inline-flex items-center gap-2 text-left" onClick={() => open('view', row)}>
                        <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.person size={14} /></span>
                        <strong style={{ fontWeight: 600 }}>{nameOf(row)}</strong>
                      </button>
                    </td>
                    <td className="ui-mono" style={{ fontSize: '0.8125rem' }}>{row.code || '—'}</td>
                    <td>{row.email}</td>
                    <td>{roleName(row.roleId) ? <span className="ws-pill ws-pill--role">{roleName(row.roleId)}</span> : <span className="ws-head-meta">No role</span>}</td>
                    <td>{statusPill(row)}</td>
                    <td className="num">
                      <button
                        type="button"
                        ref={menuFor === row.id ? menuAnchorRef : null}
                        className="ws-btn ws-btn--quiet ws-btn--small"
                        aria-label={`Actions for ${nameOf(row)}`}
                        aria-expanded={menuFor === row.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor((prev) => (prev === row.id ? null : row.id));
                        }}
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </button>
                      {menuFor === row.id ? (
                        <Popover anchorRef={menuAnchorRef} onClose={() => setMenuFor(null)} minWidth={200} maxWidth={260}>
                          <button type="button" className="report-menu-item" onClick={() => open('view', row)}>Details</button>
                          <button type="button" className="report-menu-item" onClick={() => openEdit(row)}>Edit</button>
                          {row.isActive === false ? (
                            <button type="button" className="report-menu-item" onClick={() => bringBack(row)}>Reactivate</button>
                          ) : (
                            <button type="button" className="report-menu-item" onClick={() => openLeave(row)}>Mark as left</button>
                          )}
                          <button type="button" className="report-menu-item" onClick={() => openCompanies(row)}>Companies</button>
                          {branchesEnabled ? <button type="button" className="report-menu-item" onClick={() => openBranches(row)}>Branches</button> : null}
                          <button type="button" className="report-menu-item" onClick={() => open('password', row)}>Set a password</button>
                          <PermissionButton permission="SETTINGS::Users::DELETE" type="button" className="report-menu-item" style={{ color: 'rgb(var(--neg))' }} onClick={() => remove(row)}>
                            Remove
                          </PermissionButton>
                        </Popover>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WsDrawer open={Boolean(panel)} onClose={close} title={drawer.title} description={drawer.description} actions={drawer.actions} widthClass="w-[min(38rem,92vw)]">
        {drawer.body}
      </WsDrawer>
    </div>
  );
}
