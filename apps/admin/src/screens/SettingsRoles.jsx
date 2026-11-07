import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { confirmDialog } from '@ui/components/ui/notify';
import { listRoles, createRole, updateRole, deleteRole } from '@platform/admin/admin';
import Popover from '@ui/components/ui/Popover';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { getPermissionCatalog } from '@ui/api/permissions';
import { rbacErrorMessage } from '@ui/permissions/rbacErrors';
import TemplateDrift from './TemplateDrift';
import PermissionMatrix from './PermissionMatrix';
import { catalogKeys, permissionLabel } from './permissionKeys';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { ICON, PageHead, Panel, Stat, WsDrawer } from './wsKit';
import './workspace.css';

function permKey(p) {
  const module = String(p?.module || '').trim();
  const subModule = String(p?.subModule || '').trim();
  const action = String(p?.action || '').trim();
  return `${module}::${subModule}::${action}`;
}

/*
 * W-5.1: the role catalogue grouped by what a role opens — company
 * administration first, then each app, then roles that reach several apps —
 * from the role's own permissions (the same module-to-app mapping the server
 * enforces, middleware/rbac.ts). Account roles (owner, administrator, billing
 * admin, member) are the account's, shown above the company's roles.
 */
const ACCOUNTING_MODULES = new Set(['SALES', 'PURCHASE', 'INVENTORY', 'ACCOUNTING', 'CASHBANK', 'EXPENSES', 'MASTERS']);
const APP_OF_MODULE = (m) => (ACCOUNTING_MODULES.has(m) ? 'Accounting' : m === 'PAYROLL' ? 'Payroll' : m === 'PEOPLE' || m === 'ATTENDANCE' ? 'People and Attendance' : null);
const GROUP_ORDER = ['Company administration', 'Accounting', 'Payroll', 'People and Attendance', 'Across apps', 'Settings and reports only'];
export function roleGroup(role) {
  if (String(role?.roleType || '') === 'ADMIN') return 'Company administration';
  const apps = new Set((role?._normalizedPermissions || []).filter((p) => p.allowed !== false).map((p) => APP_OF_MODULE(String(p.module || ''))).filter(Boolean));
  if (apps.size === 1) return [...apps][0];
  return apps.size > 1 ? 'Across apps' : 'Settings and reports only';
}
export const ACCOUNT_ROLES = [
  ['Owner', 'Runs the account. No business data by itself.'],
  ['Administrator', 'Adds companies and invites people.'],
  ['Billing admin', 'Sees the account, its plan and billing.'],
  ['Member', 'Access comes from company roles.'],
];

function normalizeRolePermissions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x) return null;
      // Backend shape: RolePermission include { permission: { module, subModule, action }, allowed }
      if (typeof x === 'object' && x.permission) {
        return {
          module: x.permission.module,
          subModule: x.permission.subModule ?? null,
          action: x.permission.action,
          allowed: x.allowed !== false,
        };
      }
      // Alternate acceptable shape
      if (typeof x === 'object' && x.module && x.action) {
        return {
          module: x.module,
          subModule: x.subModule ?? null,
          action: x.action,
          allowed: x.allowed !== false,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function permissionsToSet(perms) {
  const s = new Set();
  for (const p of perms || []) {
    if (p && p.allowed !== false) s.add(permKey(p));
  }
  return s;
}

export function SettingsRoles({ orgId }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', ownDocumentsOnly: false, permissions: new Set() });
  /** The server's permission catalogue: the only list the form may offer. */
  const [catalog, setCatalog] = useState({ modules: [], presets: [] });
  /** Grants the role holds that the catalogue has since retired; dropped on save. */
  const [retired, setRetired] = useState(0);
  const [search, setSearch] = useState('');
  const [openMenuForRoleId, setOpenMenuForRoleId] = useState(null);
  /** The trigger the open menu hangs from; only one row's menu is open. */
  const menuAnchorRef = useRef(null);
  const [viewRoleId, setViewRoleId] = useState(null);

  const loadRoles = async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const [res, cat] = await Promise.all([listRoles(orgId), getPermissionCatalog().catch(() => null)]);
      const modules = cat?.modules || catalog.modules;
      if (cat) setCatalog(cat);
      const next = (Array.isArray(res.roles) ? res.roles : []).map((r) => {
        const normalized = normalizeRolePermissions(r.permissions);
        return {
          ...r,
          _normalizedPermissions: normalized,
          _permissionLabels: normalized.filter((p) => p.allowed !== false).map((p) => permissionLabel(modules, permKey(p))),
        };
      });
      setRoles(next);
    } catch (err) {
      setError(err.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, [orgId]);

  const openCreate = () => {
    setEditRole(null);
    setForm({ name: '', description: '', ownDocumentsOnly: false, permissions: new Set() });
    setRetired(0);
    setViewRoleId(null);
    setShowForm(true);
  };

  const openView = (roleId) => {
    setViewRoleId(String(roleId));
    setOpenMenuForRoleId(null);
  };

  const closeView = () => {
    setViewRoleId(null);
  };

  const openEdit = (r) => {
    setEditRole(r);
    setViewRoleId(null);
    const normalized = normalizeRolePermissions(r.permissions || r._normalizedPermissions);
    const held = permissionsToSet(normalized);
    // Keep only what the catalogue still offers. Older roles can hold keys from
    // the list this screen used to keep; they never granted anything.
    const known = catalogKeys(catalog.modules);
    const kept = new Set([...held].filter((k) => known.has(k)));
    setRetired(held.size - kept.size);
    setForm({
      name: r.name,
      description: r.description || '',
      ownDocumentsOnly: Boolean(r.ownDocumentsOnly),
      permissions: kept,
    });
    setShowForm(true);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: String(form.name || '').trim(),
        description: String(form.description || '').trim() || null,
        ownDocumentsOnly: Boolean(form.ownDocumentsOnly),
        // Catalogue wire keys, which the server accepts as they are.
        permissions: Array.from(form.permissions),
      };
      if (editRole) {
        const res = await updateRole(orgId, editRole.id, payload);
        const normalized = normalizeRolePermissions(res.role?.permissions);
        const nextRole = {
          ...res.role,
          _normalizedPermissions: normalized,
          _permissionLabels: normalized.filter((p) => p.allowed !== false).map((p) => permissionLabel(catalog.modules, permKey(p))),
        };
        setRoles((prev) => prev.map((r) => (r.id === editRole.id ? nextRole : r)));
      } else {
        const res = await createRole(orgId, payload);
        const normalized = normalizeRolePermissions(res.role?.permissions);
        const nextRole = {
          ...res.role,
          assignedUsersCount: res.role?.assignedUsersCount ?? 0,
          _normalizedPermissions: normalized,
          _permissionLabels: normalized.filter((p) => p.allowed !== false).map((p) => permissionLabel(catalog.modules, permKey(p))),
        };
        setRoles((prev) => [...prev, nextRole]);
      }
      setShowForm(false);
    } catch (err) {
      const perm = err?.data?.permission;
      const permHint = perm?.module && perm?.action ? ` (missing: ${perm.module}${perm.subModule ? ` / ${perm.subModule}` : ''} / ${perm.action})` : '';
      setError(err?.data?.code ? rbacErrorMessage(err) : (err.message || 'Failed to save role') + permHint);
    } finally {
      setSaving(false);
    }
  };

  const removeRole = async (id) => {
    if (!await confirmDialog({ title: 'Please confirm', message: 'Delete this role?', confirmLabel: 'Yes, continue' })) return;
    try {
      await deleteRole(orgId, id);
      setRoles((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(rbacErrorMessage(err, 'Failed to delete role'));
    }
  };

  const query = String(search || '').trim().toLowerCase();
  const filteredRoles = query
    ? roles.filter((r) => {
        const name = String(r?.name || '').toLowerCase();
        const desc = String(r?.description || '').toLowerCase();
        return name.includes(query) || desc.includes(query);
      })
    : roles;

  const selectedRole = useMemo(() => {
    if (!viewRoleId) return null;
    return roles.find((r) => String(r.id) === String(viewRoleId)) || null;
  }, [roles, viewRoleId]);
  const viewedPermissions = selectedRole
    ? permissionsToSet(normalizeRolePermissions(selectedRole.permissions || selectedRole._normalizedPermissions))
    : new Set();

  const exportRoles = (key) => {
    const format = exportFormatFromKey(key);
    if (!format) return;
    runListExport({
      format,
      title: 'Roles',
      fileName: 'Roles',
      label: 'role(s)',
      columns: [
        { key: 'name', label: 'Role' },
        { key: 'description', label: 'Description' },
        { key: 'group', label: 'Opens', value: (r) => roleGroup(r) },
        { key: 'assignedUsersCount', label: 'People', value: (r) => Number(r.assignedUsersCount || 0) },
      ],
      rows: filteredRoles,
    });
  };

  const assigned = roles.reduce((n, r) => n + Number(r.assignedUsersCount || 0), 0);
  const unused = roles.filter((r) => !Number(r.assignedUsersCount || 0)).length;
  const custom = roles.filter((r) => String(r.roleType || '') === 'CUSTOM').length;
  const groups = GROUP_ORDER.map((group) => ({ group, rows: filteredRoles.filter((r) => roleGroup(r) === group) })).filter((g) => g.rows.length);
  const errorNote = error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Access', 'Roles']}
          title="Roles"
          actions={
            <>
              <MoreButton items={[exportMenuItem('Export roles')]} onSelect={exportRoles} />
              <PermissionButton permission="SETTINGS::Roles::CREATE" type="button" onClick={openCreate} className="ws-btn ws-btn--primary">
                <Plus size={16} aria-hidden="true" /> Create role
              </PermissionButton>
            </>
          }
        />

        {roles.length ? (
          <div className="ws-stats">
            <Stat icon={ICON.secure} label="Roles" value={roles.length} note={custom ? `${custom} made here` : 'All from the standard set'} />
            <Stat icon={ICON.people} label="Assignments" value={assigned} note="People holding a role, counted per role" />
            <Stat icon={ICON.warning} tone={unused ? 'warn' : null} label="Unused" value={unused} note={unused ? 'Held by nobody' : 'Every role is in use'} />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 items-center" role="search">
          <label className="relative flex-1 min-w-[14rem]" style={{ maxWidth: 420 }}>
            <span className="sr-only">Search roles</span>
            <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
            <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or description" />
          </label>
          <span className="ws-head-meta">{filteredRoles.length} {filteredRoles.length === 1 ? 'role' : 'roles'}</span>
        </div>

        {!showForm && !selectedRole ? errorNote : null}

        <div className="ws-layout">
          <div className="grid gap-6 min-w-0">
            {loading && !roles.length ? (
              <p className="ws-card-blurb">Loading roles…</p>
            ) : groups.length === 0 ? (
              <div className="ws-setup">
                <p className="ws-card-blurb">{roles.length ? 'No role matches this search.' : 'No roles yet. Create the first one.'}</p>
              </div>
            ) : (
              groups.map(({ group, rows }) => (
                <section key={group} className="grid gap-2" aria-labelledby={`roles-${group}`}>
                  <h2 id={`roles-${group}`} className="ws-panel-title">{group} <span className="ws-head-meta">· {rows.length}</span></h2>
                  <div className="ws-table-wrap">
                    <table className="ws-table">
                      <thead>
                        <tr>
                          <th style={{ width: '28%' }}>Role</th>
                          <th>What it is for</th>
                          <th className="num" style={{ width: 90 }}>People</th>
                          <th style={{ width: 56 }}><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <button type="button" className="text-left" onClick={() => openView(r.id)}>
                                <strong style={{ fontWeight: 600 }}>{r.name}</strong>
                              </button>
                            </td>
                            <td style={{ whiteSpace: 'normal', color: 'rgb(var(--ws-muted))' }}>{r.description || `${r._permissionLabels?.length || 0} permissions`}</td>
                            <td className="num">{Number(r.assignedUsersCount || 0)}</td>
                            <td className="num">
                              <button
                                type="button"
                                ref={openMenuForRoleId === r.id ? menuAnchorRef : null}
                                className="ws-btn ws-btn--quiet ws-btn--small"
                                aria-label={`Actions for ${r.name}`}
                                aria-expanded={openMenuForRoleId === r.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuForRoleId((prev) => (prev === r.id ? null : r.id));
                                }}
                              >
                                <MoreHorizontal size={16} aria-hidden="true" />
                              </button>
                              {openMenuForRoleId === r.id ? (
                                <Popover anchorRef={menuAnchorRef} onClose={() => setOpenMenuForRoleId(null)} minWidth={160} maxWidth={220}>
                                  <button type="button" className="report-menu-item" onClick={() => openView(r.id)}>View</button>
                                  <button type="button" className="report-menu-item" onClick={() => { setOpenMenuForRoleId(null); openEdit(r); }}>Edit</button>
                                  <PermissionButton
                                    permission="SETTINGS::Roles::DELETE"
                                    type="button"
                                    className="report-menu-item"
                                    style={{ color: 'rgb(var(--neg))' }}
                                    onClick={() => { setOpenMenuForRoleId(null); removeRole(r.id); }}
                                  >
                                    Delete
                                  </PermissionButton>
                                </Popover>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
            )}
          </div>

          <aside className="ws-side">
            <Panel title="Account roles">
              <p className="ws-card-blurb" style={{ marginTop: -6 }}>The level above these, given under Members.</p>
              <ul className="ws-list">
                {ACCOUNT_ROLES.map(([name, what]) => (
                  <li key={name}>
                    <div className="ws-item">
                      <span className="ws-item-text">
                        <span className="ws-item-title">{name}</span>
                        <span className="ws-item-sub" style={{ whiteSpace: 'normal' }}>{what}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </aside>
        </div>
      </div>

      <WsDrawer
        open={Boolean(selectedRole)}
        onClose={closeView}
        title={selectedRole?.name || 'Role'}
        description={selectedRole ? `${roleGroup(selectedRole)} · ${Number(selectedRole.assignedUsersCount || 0)} ${Number(selectedRole.assignedUsersCount || 0) === 1 ? 'person' : 'people'}` : ''}
        actions={selectedRole ? (
          <>
            <button type="button" onClick={closeView} className="ws-btn ws-btn--quiet">Close</button>
            <button type="button" onClick={() => { closeView(); openEdit(selectedRole); }} className="ws-btn ws-btn--primary">Edit role</button>
          </>
        ) : null}
      >
        {selectedRole ? (
          <div className="grid gap-4">
            {selectedRole.description ? <p className="ws-card-blurb">{selectedRole.description}</p> : null}
            {selectedRole.ownDocumentsOnly ? <p className="text-sm"><span className="ws-pill">Own documents only</span></p> : null}
            <TemplateDrift template={selectedRole.template} modules={catalog.modules} />
            {/* The same matrix as Edit, from the server catalogue, read-only. */}
            <fieldset disabled aria-label="Permissions (read only)">
              <PermissionMatrix modules={catalog.modules} granted={viewedPermissions} onToggle={() => {}} onSetMany={() => {}} initiallyOpen={1} />
            </fieldset>
          </div>
        ) : null}
      </WsDrawer>

      <WsDrawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editRole ? `Edit ${editRole.name}` : 'Create role'}
        actions={(
          <>
            <button type="button" onClick={() => setShowForm(false)} className="ws-btn ws-btn--quiet">Cancel</button>
            <button type="submit" form="role-settings-form" disabled={saving} className="ws-btn ws-btn--primary">
              {saving ? 'Saving…' : editRole ? 'Save role' : 'Create role'}
            </button>
          </>
        )}
      >
        <form id="role-settings-form" onSubmit={onSubmit} className="grid gap-4">
          {errorNote}
          <label className="grid gap-1" htmlFor="settingsroles-role-name">
            <span className="text-sm font-medium">Role name <span aria-hidden="true">*</span></span>
            <input id="settingsroles-role-name" className="ui-input w-full" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </label>
          <label className="grid gap-1" htmlFor="settingsroles-role-description">
            <span className="text-sm font-medium">Description</span>
            <input
              id="settingsroles-role-description"
              className="ui-input w-full"
              maxLength={300}
              placeholder="What people with this role do, in one line"
              value={form.description || ''}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
            <span className="ui-caption">Shown when picking a role for someone.</span>
          </label>
          <label className="flex items-start gap-2 text-sm" htmlFor="settingsroles-own-docs">
            <input
              id="settingsroles-own-docs"
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(form.ownDocumentsOnly)}
              onChange={(e) => setForm((p) => ({ ...p, ownDocumentsOnly: e.target.checked }))}
            />
            <span>
              Own documents only
              <span className="block ui-caption">Only documents they created.</span>
            </span>
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Permissions</span>
            {retired > 0 ? (
              <p className="ui-caption" role="status">
                {retired} old permission{retired === 1 ? '' : 's'} on this role no longer exist and will be removed when you save. They never granted anything.
              </p>
            ) : null}
            {catalog.modules.length ? (
              <PermissionMatrix
                key={editRole?.id || 'new'}
                modules={catalog.modules}
                granted={form.permissions}
                initiallyOpen={1}
                onToggle={(k) =>
                  setForm((prev) => {
                    const next = new Set(prev.permissions);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return { ...prev, permissions: next };
                  })
                }
                onSetMany={(keys, on) =>
                  setForm((prev) => {
                    const next = new Set(prev.permissions);
                    for (const k of keys) {
                      if (on) next.add(k);
                      else next.delete(k);
                    }
                    return { ...prev, permissions: next };
                  })
                }
              />
            ) : (
              <p className="ws-card-blurb">Loading the permission list…</p>
            )}
          </div>
        </form>
      </WsDrawer>
    </div>
  );
}
