import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, Search } from '@ui/components/ui/lineIcons';
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
import { PageHead, WsDrawer } from './wsKit';
import './workspace.css';
import './ws-access.css';

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
    setShowForm(true);
  };

  const openView = (roleId) => {
    setViewRoleId(String(roleId));
    setOpenMenuForRoleId(null);
  };

  const openEdit = (r) => {
    setEditRole(r);
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

  const groups = GROUP_ORDER.map((group) => ({ group, rows: filteredRoles.filter((r) => roleGroup(r) === group) })).filter((g) => g.rows.length);
  const errorNote = error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null;

  /* The role shown on the page: the one picked, else the first in the list. */
  const shownRole = selectedRole || filteredRoles[0] || null;
  const shownPermissions = shownRole
    ? permissionsToSet(normalizeRolePermissions(shownRole.permissions || shownRole._normalizedPermissions))
    : new Set();
  const peopleOf = (r) => Number(r?.assignedUsersCount || 0);

  /* A copy of a role: the create form, filled with the role's permissions. */
  const openDuplicate = (r) => {
    if (!r) return;
    const known = catalogKeys(catalog.modules);
    const held = permissionsToSet(normalizeRolePermissions(r.permissions || r._normalizedPermissions));
    setEditRole(null);
    setForm({
      name: `${r.name} (copy)`,
      description: r.description || '',
      ownDocumentsOnly: Boolean(r.ownDocumentsOnly),
      permissions: new Set([...held].filter((k) => !known.size || known.has(k))),
    });
    setRetired(0);
    setShowForm(true);
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Access', 'Roles']}
          title="Roles"
          description="What each role can do in each app. People can hold different roles in different companies."
          actions={
            <>
              <MoreButton items={[exportMenuItem('Export roles')]} onSelect={exportRoles} />
              <PermissionButton permission="SETTINGS::Roles::CREATE" type="button" onClick={() => openDuplicate(shownRole)} className="ws-btn ws-btn--quiet" disabled={!shownRole}>
                Duplicate role
              </PermissionButton>
              <PermissionButton permission="SETTINGS::Roles::CREATE" type="button" onClick={openCreate} className="ws-btn ws-btn--primary">
                <Plus size={16} aria-hidden="true" /> New role
              </PermissionButton>
            </>
          }
        />

        {!showForm ? errorNote : null}

        <div className="ws-roles-layout">
          <section className="ws-flat" aria-label={shownRole ? `${shownRole.name} permissions` : 'Role permissions'}>
            {loading && !roles.length ? (
              <p className="ws-card-blurb">Loading roles…</p>
            ) : !shownRole ? (
              <p className="ws-card-blurb">{roles.length ? 'No role matches this search.' : 'No roles yet. Create the first one.'}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1" style={{ minWidth: 0 }}>
                    <h2 className="ws-h2">{shownRole.name}</h2>
                    <p className="ws-foot-note">
                      {peopleOf(shownRole)} {peopleOf(shownRole) === 1 ? 'person' : 'people'} · {roleGroup(shownRole)}
                      {String(shownRole.roleType || '') === 'CUSTOM' ? ' · made here' : ''}
                      {shownRole.description ? ` · ${shownRole.description}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => openEdit(shownRole)}>Edit role</button>
                    <button
                      type="button"
                      ref={openMenuForRoleId === shownRole.id ? menuAnchorRef : null}
                      className="ws-btn ws-btn--quiet ws-btn--small"
                      aria-label={`Actions for ${shownRole.name}`}
                      aria-expanded={openMenuForRoleId === shownRole.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuForRoleId((prev) => (prev === shownRole.id ? null : shownRole.id));
                      }}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    {openMenuForRoleId === shownRole.id ? (
                      <Popover anchorRef={menuAnchorRef} onClose={() => setOpenMenuForRoleId(null)} minWidth={160} maxWidth={220}>
                        <button type="button" className="report-menu-item" onClick={() => { setOpenMenuForRoleId(null); openEdit(shownRole); }}>Edit</button>
                        <button type="button" className="report-menu-item" onClick={() => { setOpenMenuForRoleId(null); openDuplicate(shownRole); }}>Duplicate</button>
                        <PermissionButton
                          permission="SETTINGS::Roles::DELETE"
                          type="button"
                          className="report-menu-item"
                          style={{ color: 'rgb(var(--neg))' }}
                          onClick={() => { setOpenMenuForRoleId(null); removeRole(shownRole.id); }}
                        >
                          Delete
                        </PermissionButton>
                      </Popover>
                    ) : null}
                  </div>
                </div>
                {shownRole.ownDocumentsOnly ? <p><span className="ws-pill ws-pill--neutral">Own documents only</span></p> : null}
                <TemplateDrift template={shownRole.template} modules={catalog.modules} />
                {/* The same matrix as Edit, from the server catalogue, read-only. */}
                {catalog.modules.length ? (
                  <fieldset disabled aria-label="Permissions (read only)">
                    <PermissionMatrix key={shownRole.id} modules={catalog.modules} granted={shownPermissions} onToggle={() => {}} onSetMany={() => {}} initiallyOpen={2} />
                  </fieldset>
                ) : (
                  <p className="ws-card-blurb">Loading the permission list…</p>
                )}
              </>
            )}
          </section>

          <aside className="ws-flat" aria-labelledby="ws-roles-list-title">
            <h2 id="ws-roles-list-title" className="ws-h2">Roles</h2>
            <div className="ws-filters" role="search">
              <label className="ws-search" style={{ flex: '1 1 auto' }}>
                <span className="sr-only">Search roles</span>
                <Search size={16} aria-hidden="true" />
                <input className="ui-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search roles" />
              </label>
            </div>
            {groups.map(({ group, rows }) => (
              <section key={group} className="grid gap-1" aria-labelledby={`roles-${group}`}>
                <h3 id={`roles-${group}`} className="ws-kicker" style={{ padding: '8px 12px 0' }}>{group}</h3>
                <ul className="ws-role-list">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="ws-role-pick" aria-current={shownRole?.id === r.id ? 'true' : undefined} onClick={() => openView(r.id)}>
                        <span className="min-w-0 truncate">{r.name}</span>
                        <span className="num" aria-label={`${peopleOf(r)} ${peopleOf(r) === 1 ? 'person' : 'people'}`}>{peopleOf(r)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section className="grid gap-1" aria-labelledby="ws-account-roles">
              <h3 id="ws-account-roles" className="ws-kicker" style={{ padding: '8px 12px 0' }}>Account roles</h3>
              <p className="ws-foot-note" style={{ padding: '0 12px' }}>The level above these, given under Members.</p>
              <ul className="ws-list">
                {ACCOUNT_ROLES.map(([name, what]) => (
                  <li key={name}>
                    <div className="ws-item" style={{ minHeight: 48, padding: '8px 12px' }}>
                      <span className="ws-item-text">
                        <span className="ws-item-title">{name}</span>
                        <span className="ws-item-sub" style={{ whiteSpace: 'normal' }}>{what}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>

      <WsDrawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editRole ? `Edit ${editRole.name}` : 'New role'}
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
